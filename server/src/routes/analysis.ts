import { randomUUID } from "node:crypto";
import zlib from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { agrisMode, ask } from "../agris.ts";
import { authEnabled, config, integrationStatus } from "../config.ts";
import { CROPS } from "../engine/crops.ts";
import { cachedReport, landHealth, type Report } from "../engine/report.ts";
import { cached, DAY, getCache, getDbStats, putCache } from "../lib/cache.ts";
import type { Ring } from "../lib/geo.ts";
import { isMongoConnected } from "../lib/mongoose.ts";
import { badRequest, num, parseInput, parseLocation, parseRing } from "../lib/validate.ts";
import * as gee from "../providers/gee.ts";
import { search } from "../providers/geocode.ts";
import { ndviPngCdse, s2SeriesCdse, s2SeriesKeyless, searchScenes } from "../providers/sentinel.ts";

/** Reports are kept a day so Agris follow-ups survive restarts and redeploys. */
const REPORT_TTL = DAY;
const storeReport = (r: Report) => {
  const id = randomUUID();
  putCache(`report-id:${id}`, r, REPORT_TTL);
  return id;
};
const loadReport = (id: string) => (/^[0-9a-f-]{36}$/.test(id) ? getCache<Report>(`report-id:${id}`) : undefined);

/**
 * Takes over the response for a long-lived stream. Headers already set on the reply (CORS, security) are kept.
 * With `gzip`, each write is flushed so the client still sees lines as they are produced.
 */
function openStream(req: FastifyRequest, reply: FastifyReply, contentType: string, gzip: boolean) {
  const gz = gzip && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? "")) ? zlib.createGzip() : null;
  reply.hijack();
  const kept = Object.entries(reply.getHeaders()).filter((e): e is [string, string | number | string[]] => e[1] != null);
  reply.raw.writeHead(200, {
    ...Object.fromEntries(kept), "content-type": contentType, "cache-control": "no-cache", "x-accel-buffering": "no",
    ...(gz && { "content-encoding": "gzip", vary: "accept-encoding" }),
  });
  gz?.pipe(reply.raw);
  return {
    write(s: string) {
      if (gz) { gz.write(s); gz.flush(); } else reply.raw.write(s);
    },
    end: () => (gz ? gz.end() : reply.raw.end()),
  };
}

function squareAround(lat: number, lon: number, m: number): Ring {
  const dy = m / 110_540, dx = m / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy]];
}

export async function analysisRoutes(app: FastifyInstance) {
  /** Always 200 while the process serves requests: an outage of an optional dependency shows in the body, not as a failed deploy. */
  app.get("/api/health", { config: { rateLimit: false } }, async () => ({
    ok: true,
    status: "healthy",
    service: "FieldSense",
    version: config.version,
    environment: config.environment,
    contact: config.contactEmail,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: getDbStats(),
    accounts: { enabled: authEnabled(), connected: authEnabled() && isMongoConnected() },
    integrations: integrationStatus(),
    agris: agrisMode(),
    crops: CROPS.length,
  }));

  /** Readiness: 503 while a required dependency is down. Use for uptime monitors; the platform health check stays on /api/health. */
  app.get("/api/ready", { config: { rateLimit: false } }, async (_req, reply) => {
    const sqlite = getDbStats().status === "connected";
    const mongo = !authEnabled() || isMongoConnected();
    return reply.code(sqlite && mongo ? 200 : 503).send({ ready: sqlite && mongo, sqlite, accounts: mongo });
  });

  app.get("/api/contact", async () => ({ email: config.contactEmail, organization: "SenseGrass", support: `mailto:${config.contactEmail}` }));

  app.get("/api/crops", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=3600");
    return CROPS;
  });

  app.get("/api/geocode", async (req) => {
    const q = String((req.query as any).q ?? "").trim().slice(0, 200);
    if (q.length < 2) throw badRequest("q is required");
    return search(q);
  });

  /** Streams NDJSON: progress lines, then the full report (or an error). */
  app.post("/api/report", async (req, reply) => {
    const input = parseInput(req.body);
    const out = openStream(req, reply, "application/x-ndjson", true);
    const send = (o: unknown) => out.write(JSON.stringify(o) + "\n");
    try {
      const report = await cachedReport(input, (stage) => send({ type: "progress", stage }));
      send({ type: "report", reportId: storeReport(report), report });
    } catch (e) {
      req.log.error({ err: e }, "report failed");
      send({ type: "error", error: e instanceof Error ? e.message : String(e) });
    }
    out.end();
  });

  app.post("/api/land", async (req) => {
    const { lat, lon, polygon } = parseLocation(req.body);
    return landHealth(lat, lon, polygon);
  });

  /** Sentinel-2 vegetation indices for the field. Earth Engine → Sentinel Hub → keyless AWS COG reads. */
  app.post("/api/satellite", async (req) => {
    const b: any = req.body ?? {};
    const { lat, lon, polygon } = parseLocation(b);
    const ring: Ring = polygon ?? [[lon, lat]];
    const days = num(b.days ?? 365, "days", 30, 3000);
    const from = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
    const errors: string[] = [];
    let series: any[] | null = null, source = "";
    if (gee.geeEnabled()) {
      try { series = await gee.geeS2Series(ring, lat, lon, from); source = "Sentinel-2 SR via Google Earth Engine"; } catch (e: any) { errors.push(`Earth Engine: ${e.message}`); }
    }
    if (!series && config.cdse.clientId) {
      try { series = await s2SeriesCdse(polygon ?? squareAround(lat, lon, 40), from); source = "Sentinel-2 L2A via Copernicus Data Space (Sentinel Hub)"; } catch (e: any) { errors.push(`Sentinel Hub: ${e.message}`); }
    }
    if (!series) {
      try { series = await s2SeriesKeyless(ring, Math.min(days, 400), 28); source = "Sentinel-2 L2A COGs on AWS Open Data (Element 84 Earth Search)"; } catch (e: any) { errors.push(`AWS COG: ${e.message}`); }
    }
    const scenes = await cached(`scenes:${lat.toFixed(3)},${lon.toFixed(3)}:${new Date().toISOString().slice(0, 10)}`, DAY / 4, async () =>
      (await searchScenes(ring, 120, 80, 40)).map((it: any) => ({
        id: it.id, date: it.properties.datetime, cloud: it.properties["eo:cloud_cover"], thumbnail: it.assets.thumbnail?.href, platform: it.properties.platform,
      }))).catch((e) => { errors.push(`STAC: ${e.message}`); return []; });
    let tiles: string | null = null;
    if (gee.geeEnabled()) tiles = await gee.geeNdviTiles(lat, lon).then((t) => t.url).catch(() => null);
    return { source, series: series ?? [], scenes, tiles, ndviImage: Boolean(config.cdse.clientId), errors };
  });

  app.post("/api/satellite/ndvi.png", async (req, reply) => {
    const b: any = req.body ?? {};
    const ring = parseRing(b.polygon) ?? squareAround(num(b.lat, "lat", -60, 75), num(b.lon, "lon", -180, 180), 400);
    const { png, bbox } = await ndviPngCdse(ring);
    reply.header("content-type", "image/png").header("x-bbox", bbox.join(",")).header("access-control-expose-headers", "x-bbox");
    return reply.send(png);
  });

  /** Agris chat — Server-Sent Events. */
  app.post("/api/agris", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b: any = req.body ?? {};
    const report = loadReport(String(b.reportId ?? ""));
    if (!report) throw badRequest("This report has expired. Run the field check again to keep chatting.");
    const question = String(b.question ?? "").trim().slice(0, 2000);
    if (!question) throw badRequest("question is required");
    const out = openStream(req, reply, "text/event-stream", false);
    try {
      for await (const ev of ask(report, question, typeof b.conversationId === "string" ? b.conversationId : undefined)) out.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch (e) {
      req.log.error({ err: e }, "agris failed");
      out.write(`data: ${JSON.stringify({ type: "text", text: "Sorry, the assistant failed to answer. Please try again." })}\n\n`);
    }
    out.end();
  });
}
