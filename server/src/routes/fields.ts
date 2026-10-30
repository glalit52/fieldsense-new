import type { FastifyInstance, FastifyRequest } from "fastify";
import { authEnabled } from "../config.ts";
import { reviewSeasons } from "../engine/review.ts";
import { requireAuth } from "../lib/auth.ts";
import { fieldSummary, requireReport, storeReport } from "../lib/reports.ts";
import { reportPdf, sendPdf } from "../lib/reportPdf.ts";
import { badRequest, parseActivity, parseLocation, parseSoilTest, str } from "../lib/validate.ts";
import { removeFieldAlerts } from "../services/alerts.ts";
import { mongoCheckStore, sqliteCheckStore } from "../stores/checks.ts";
import { mongoFieldStore, sqliteFieldStore, type FieldInput, type FieldPatch } from "../stores/fields.ts";

const MAX_IMPORT = 200;

/** Field summaries are small headline numbers; cap them so the store can't be used as a blob store. */
function summary(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw badRequest("summary must be an object");
  if (JSON.stringify(v).length > 20_000) throw badRequest("summary is too large");
  return v as Record<string, unknown>;
}

/**
 * Saved fields. With accounts enabled (MONGO_URI) every route needs a signed-in user and only sees that
 * user's fields. Without accounts, fields live in local SQLite and are shared by everyone using the server.
 */
export async function fieldRoutes(app: FastifyInstance) {
  const accounts = authEnabled();
  const store = accounts ? mongoFieldStore : sqliteFieldStore;
  const checks = accounts ? mongoCheckStore : sqliteCheckStore;
  const owner = (req: FastifyRequest) => (accounts ? String(req.user!._id) : "local");
  const opts = accounts ? { preHandler: requireAuth } : {};
  type P = { Params: { id: string; testId: string; activityId: string; checkId: string } };
  const fieldInput = (b: any): FieldInput => ({
    ...parseLocation(b), name: str(b?.name, 120) || "Unnamed field", notes: str(b?.notes, 4000), summary: summary(b?.summary),
  });

  app.get("/api/fields", opts, async (req) => store.list(owner(req)));

  app.get<P>("/api/fields/:id", opts, async (req) => store.get(owner(req), req.params.id));

  app.post("/api/fields", opts, async (req, reply) => {
    return reply.code(201).send(await store.create(owner(req), fieldInput(req.body)));
  });

  /** Bulk import (CSV/GeoJSON parsed in the browser). Everything is validated before anything is written. */
  app.post("/api/fields/import", opts, async (req, reply) => {
    const list = (req.body as any)?.fields;
    if (!Array.isArray(list) || !list.length || list.length > MAX_IMPORT) throw badRequest(`fields must be an array of 1–${MAX_IMPORT} fields`);
    const inputs = list.map((b: any, i: number) => {
      try { return fieldInput(b); } catch (e: any) { throw badRequest(`Row ${i + 1}: ${e.message}`); }
    });
    const created = [];
    for (const f of inputs) created.push(await store.create(owner(req), f));
    return reply.code(201).send({ created: created.length, fields: created });
  });

  app.put<P>("/api/fields/:id", opts, async (req) => {
    const b: any = req.body ?? {};
    const patch: FieldPatch = {};
    if (b.name != null) patch.name = str(b.name, 120) || "Unnamed field";
    if (b.notes != null) patch.notes = str(b.notes, 4000);
    if (b.summary !== undefined) patch.summary = summary(b.summary);
    return store.update(owner(req), req.params.id, patch);
  });

  app.delete<P>("/api/fields/:id", opts, async (req) => {
    await store.remove(owner(req), req.params.id);
    await checks.removeField(owner(req), req.params.id);
    removeFieldAlerts(req.params.id);
    return { ok: true };
  });

  app.post<P>("/api/fields/:id/tests", opts, async (req, reply) =>
    reply.code(201).send(await store.addTest(owner(req), req.params.id, parseSoilTest(req.body))));

  app.delete<P>("/api/fields/:id/tests/:testId", opts, async (req) => store.removeTest(owner(req), req.params.id, req.params.testId));

  app.post<P>("/api/fields/:id/activities", opts, async (req, reply) =>
    reply.code(201).send(await store.addActivity(owner(req), req.params.id, parseActivity(req.body))));

  app.delete<P>("/api/fields/:id/activities/:activityId", opts, async (req) =>
    store.removeActivity(owner(req), req.params.id, req.params.activityId));

  // ---------- Check history: every check of a saved field is archived with its full report ----------

  /** Archives a finished check (by its reportId) and makes its numbers the field's current summary. */
  app.post<P>("/api/fields/:id/checks", opts, async (req, reply) => {
    const report = requireReport((req.body as any)?.reportId);
    await store.get(owner(req), req.params.id);
    const check = await checks.add(owner(req), req.params.id, report);
    const field = await store.update(owner(req), req.params.id, { summary: fieldSummary(report) });
    return reply.code(201).send({ check, field });
  });

  app.get<P>("/api/fields/:id/checks", opts, async (req) => {
    await store.get(owner(req), req.params.id);
    return checks.list(owner(req), req.params.id);
  });

  /** A past check's full report, with a fresh reportId so Agris, PDF and the fertiliser plan work on it. */
  app.get<P>("/api/fields/:id/checks/:checkId", opts, async (req) => {
    await store.get(owner(req), req.params.id);
    const { check, report } = await checks.get(owner(req), req.params.id, req.params.checkId);
    return { check, report, reportId: storeReport(report) };
  });

  app.delete<P>("/api/fields/:id/checks/:checkId", opts, async (req) => {
    await store.get(owner(req), req.params.id);
    await checks.remove(owner(req), req.params.id, req.params.checkId);
    return { ok: true };
  });

  /** Harvests in the journal against the model's attainable yield, using the field's latest archived check. */
  app.get<P>("/api/fields/:id/review", opts, async (req) => {
    const field = await store.get(owner(req), req.params.id);
    const [latest] = await checks.list(owner(req), req.params.id);
    if (!latest) return { checkedAt: null, seasons: [], message: "Check this field once (open it and run the check) so there is a model to compare harvests with." };
    const { report } = await checks.get(owner(req), req.params.id, latest.id);
    return { checkedAt: latest.checkedAt, seasons: reviewSeasons(report, field.activities) };
  });

  /** PDF of the latest (or a given) archived check, with the field's check history. */
  app.get<P & { Querystring: { check?: string } }>("/api/fields/:id/report.pdf", opts, async (req, reply) => {
    const field = await store.get(owner(req), req.params.id);
    const history = await checks.list(owner(req), req.params.id);
    const id = req.query.check ?? history[0]?.id;
    if (!id) throw badRequest("This field has no archived check yet. Open it and run the check first.");
    const { report } = await checks.get(owner(req), req.params.id, id);
    return sendPdf(reply, reportPdf(report, { fieldName: field.name, history }), `${field.name}-${report.generatedAt.slice(0, 10)}`);
  });
}
