import fs from "node:fs";
import Fastify, { type FastifyServerOptions } from "fastify";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fstatic from "@fastify/static";
import { config } from "./config.ts";
import { adminRoutes } from "./routes/admin.ts";
import { analysisRoutes } from "./routes/analysis.ts";
import { authRoutes } from "./routes/auth.ts";
import { batchRoutes } from "./routes/batch.ts";
import { fieldRoutes } from "./routes/fields.ts";

export async function buildApp(opts: { logger?: FastifyServerOptions["logger"] } = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 2_000_000,
    trustProxy: true, // Railway's edge sets X-Forwarded-For; rate limits must key on the real client
  });

  await app.register(cors, config.corsOrigins.length ? { origin: config.corsOrigins, credentials: true } : { origin: false });
  await app.register(cookie);
  await app.register(compress, { threshold: 1024 });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header("x-frame-options", "SAMEORIGIN");
    if (config.production) reply.header("strict-transport-security", "max-age=15552000; includeSubDomains");
  });

  app.setErrorHandler((err: any, req, reply) => {
    let status: number = err.statusCode ?? 502; // uncaught errors are almost always a failed upstream data source
    let message: string = err.message;
    if (err.name === "ValidationError") { status = 400; message = Object.values<any>(err.errors ?? {})[0]?.message ?? message; }
    if (err.name === "CastError") { status = 404; message = "Not found"; }
    if (/^Mongo/.test(err.name ?? "")) { status = 503; message = "Database temporarily unavailable"; }
    if (status >= 500) req.log.error({ err }, "request failed");
    reply.code(status).send({ error: status === 429 ? "Too many requests, please slow down" : message });
  });

  await app.register(analysisRoutes);
  await app.register(authRoutes);
  await app.register(fieldRoutes);
  await app.register(batchRoutes);
  await app.register(adminRoutes);

  // ---------- the built web app ----------
  const hasWeb = fs.existsSync(config.webDist);
  if (hasWeb) {
    await app.register(fstatic, {
      root: config.webDist,
      wildcard: false,
      setHeaders(reply, file) {
        // Vite fingerprints everything under assets/, so those never change; index.html must always revalidate.
        reply.header("cache-control", file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || !hasWeb || req.method !== "GET") return reply.code(404).send({ error: "Not found" });
    return reply.header("cache-control", "no-cache").sendFile("index.html");
  });

  return app;
}
