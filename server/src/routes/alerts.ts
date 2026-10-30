import type { FastifyInstance, FastifyRequest } from "fastify";
import { authEnabled, integrationStatus } from "../config.ts";
import { requireAuth } from "../lib/auth.ts";
import { badRequest } from "../lib/validate.ts";
import { User } from "../models/User.ts";
import { listAlerts, markRead, scanFields } from "../services/alerts.ts";

/** Weather and spray alerts for the signed-in user's saved fields (or the local workspace's). */
export async function alertRoutes(app: FastifyInstance) {
  const accounts = authEnabled();
  const opts = accounts ? { preHandler: requireAuth } : {};
  const owner = (req: FastifyRequest) => (accounts ? String(req.user!._id) : "local");
  const email = (req: FastifyRequest) => ({
    available: accounts && integrationStatus().alertEmails,
    enabled: accounts ? Boolean(req.user!.alertEmails) : false,
  });

  app.get("/api/alerts", opts, async (req) => ({ ...listAlerts(owner(req)), email: email(req) }));

  app.post("/api/alerts/read", opts, async (req) => {
    const ids = (req.body as any)?.ids;
    if (ids != null && !Array.isArray(ids)) throw badRequest("ids must be an array");
    markRead(owner(req), ids?.map(String));
    return { ok: true };
  });

  /** Re-scans the user's fields now instead of waiting for the daily run. */
  app.post("/api/alerts/refresh", { ...opts, config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (req) => {
    const run = await scanFields({ owner: owner(req), force: true, log: req.log });
    return { ...run, ...listAlerts(owner(req)), email: email(req) };
  });

  app.put("/api/alerts/settings", opts, async (req) => {
    if (!accounts) throw badRequest("Alert emails need accounts (MONGO_URI) on this server");
    const on = (req.body as any)?.email;
    if (typeof on !== "boolean") throw badRequest("email must be true or false");
    await User.updateOne({ _id: req.user!._id }, { $set: { alertEmails: on } });
    req.user!.alertEmails = on;
    return { email: email(req) };
  });
}
