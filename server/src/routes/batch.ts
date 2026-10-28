import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.ts";
import { cachedReport } from "../engine/report.ts";
import { pool } from "../lib/http.ts";
import { badRequest, HttpError, parseInput } from "../lib/validate.ts";

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function requireApiKey(req: FastifyRequest) {
  if (!config.apiKeys.length) return;
  const key = String(req.headers["x-api-key"] ?? "");
  if (!config.apiKeys.some((k) => safeEqual(k, key))) throw new HttpError(401, "Invalid API key");
}

/** Batch API for organisations: summaries for up to 100 fields per call. */
export async function batchRoutes(app: FastifyInstance) {
  app.post("/api/v1/batch", { preHandler: requireApiKey, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const pts = (req.body as any)?.fields;
    if (!Array.isArray(pts) || !pts.length || pts.length > 100) throw badRequest("fields must be an array of 1–100 {id, lat, lon, polygon?}");
    const inputs = pts.map((p: any, i: number) => {
      try { return { id: String(p?.id ?? i), input: parseInput(p) }; } catch (e: any) { throw badRequest(`fields[${i}]: ${e.message}`); }
    });
    const results = await pool(inputs, 3, async ({ id, input }) => {
      try {
        const r = await cachedReport(input);
        return {
          id, ok: true, headline: r.headline, summary: r.summary, lime: { call: r.lime.call, rateTPerHa: r.lime.rateTPerHa },
          topCrops: r.crops.slice(0, 5).map((c: any) => ({ id: c.id, score: c.score, yield: c.yieldTPerHa })), risks: r.risks.map((x: any) => ({ id: x.id, level: x.level })),
          landHealth: r.land && { verdict: r.land.verdict, changePct: r.land.changePct },
        };
      } catch (e: any) { return { id, ok: false, error: e.message }; }
    });
    return { results };
  });
}
