import type { FastifyInstance, FastifyRequest } from "fastify";
import { authEnabled } from "../config.ts";
import { requireAuth } from "../lib/auth.ts";
import { badRequest, parseLocation, parseSoilTest, str } from "../lib/validate.ts";
import { mongoFieldStore, sqliteFieldStore, type FieldPatch } from "../stores/fields.ts";

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
  const owner = (req: FastifyRequest) => (accounts ? String(req.user!._id) : "local");
  const opts = accounts ? { preHandler: requireAuth } : {};
  type P = { Params: { id: string; testId: string } };

  app.get("/api/fields", opts, async (req) => store.list(owner(req)));

  app.get<P>("/api/fields/:id", opts, async (req) => store.get(owner(req), req.params.id));

  app.post("/api/fields", opts, async (req, reply) => {
    const b: any = req.body ?? {};
    const field = await store.create(owner(req), {
      ...parseLocation(b), name: str(b.name, 120) || "Unnamed field", notes: str(b.notes, 4000), summary: summary(b.summary),
    });
    return reply.code(201).send(field);
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
    return { ok: true };
  });

  app.post<P>("/api/fields/:id/tests", opts, async (req, reply) =>
    reply.code(201).send(await store.addTest(owner(req), req.params.id, parseSoilTest(req.body))));

  app.delete<P>("/api/fields/:id/tests/:testId", opts, async (req) => store.removeTest(owner(req), req.params.id, req.params.testId));
}
