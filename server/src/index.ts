import fs from "node:fs";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fstatic from "@fastify/static";
import { agrisMode, ask } from "./agris.ts";
import { config, integrationStatus } from "./config.ts";
import { CROPS } from "./engine/crops.ts";
import { cachedReport, landHealth, type Report, type ReportInput } from "./engine/report.ts";
import { cached, DAY, db, closeDb, getDbStats } from "./lib/cache.ts";
import { centroid, type Ring } from "./lib/geo.ts";
import { pool } from "./lib/http.ts";
import * as gee from "./providers/gee.ts";
import { search } from "./providers/geocode.ts";
import { ndviPngCdse, s2SeriesCdse, s2SeriesKeyless, searchScenes } from "./providers/sentinel.ts";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 2_000_000, trustProxy: true });
await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

// ---------- validation helpers ----------
class BadRequest extends Error {}
function num(v: unknown, name: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequest(`${name} must be a number between ${min} and ${max}`);
  return n;
}
function parseRing(p: unknown): Ring | undefined {
  if (p == null) return undefined;
  if (!Array.isArray(p) || p.length < 3 || p.length > 500) throw new BadRequest("polygon must be 3–500 [lon, lat] pairs");
  const ring = p.map((pt: any) => [num(pt?.[0], "polygon lon", -180, 180), num(pt?.[1], "polygon lat", -90, 90)] as [number, number]);
  return ring;
}
function parseInput(b: any): ReportInput {
  const polygon = parseRing(b?.polygon);
  const [clon, clat] = polygon ? centroid(polygon) : [b?.lon, b?.lat];
  const lab = b?.lab ? {
    ph: b.lab.ph != null && b.lab.ph !== "" ? num(b.lab.ph, "lab pH", 3, 10.5) : undefined,
    organicCarbon: b.lab.organicCarbon != null && b.lab.organicCarbon !== "" ? num(b.lab.organicCarbon, "organic carbon %", 0, 30) : undefined,
    clay: b.lab.clay != null && b.lab.clay !== "" ? num(b.lab.clay, "clay %", 0, 100) : undefined,
  } : undefined;
  return {
    lat: num(clat, "lat", -60, 75), lon: num(clon, "lon", -180, 180), polygon,
    lab: lab && Object.values(lab).some((v) => v != null) ? lab : undefined,
    cropId: typeof b?.cropId === "string" && CROPS.some((c) => c.id === b.cropId) ? b.cropId : undefined,
    limeTargetPh: b?.limeTargetPh != null ? num(b.limeTargetPh, "limeTargetPh", 5, 7.5) : undefined,
    limeDepthCm: b?.limeDepthCm != null ? num(b.limeDepthCm, "limeDepthCm", 5, 40) : undefined,
  };
}
app.setErrorHandler((err: any, _req, reply) => {
  if (err instanceof BadRequest) return reply.code(400).send({ error: err.message });
  if ((err as any).statusCode === 429) return reply.code(429).send({ error: "Too many requests" });
  app.log.error(err);
  reply.code(502).send({ error: err.message });
});

// ---------- report store (for Agris follow-ups) ----------
const reports = new Map<string, Report>();
function storeReport(r: Report) {
  const id = randomUUID();
  reports.set(id, r);
  if (reports.size > 300) reports.delete(reports.keys().next().value!);
  return id;
}

// ---------- routes ----------
app.get("/api/health", async () => ({
  ok: true,
  status: "healthy",
  service: "FieldSense",
  contact: config.contactEmail,
  uptime: Math.round(process.uptime()),
  timestamp: new Date().toISOString(),
  database: getDbStats(),
  integrations: integrationStatus(),
  agris: agrisMode(),
  crops: CROPS.length,
}));
app.get("/api/contact", async () => ({
  email: config.contactEmail,
  organization: "SenseGrass",
  support: `mailto:${config.contactEmail}`,
}));
app.get("/api/crops", async () => CROPS);
app.get("/api/geocode", async (req) => {
  const q = String((req.query as any).q ?? "").trim();
  if (q.length < 2) throw new BadRequest("q is required");
  return search(q);
});

/** Streams NDJSON: progress lines, then the full report (or an error). */
app.post("/api/report", async (req, reply) => {
  const input = parseInput(req.body);
  reply.raw.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache", "access-control-allow-origin": "*" });
  const send = (o: unknown) => reply.raw.write(JSON.stringify(o) + "\n");
  try {
    const report = await cachedReport(input, (stage) => send({ type: "progress", stage }));
    send({ type: "report", reportId: storeReport(report), report });
  } catch (e) {
    send({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
  reply.raw.end();
  return reply;
});

app.post("/api/land", async (req) => {
  const b: any = req.body ?? {};
  const polygon = parseRing(b.polygon);
  const [lon, lat] = polygon ? centroid(polygon) : [num(b.lon, "lon", -180, 180), num(b.lat, "lat", -60, 75)];
  return landHealth(lat, lon, polygon);
});

/** Sentinel-2 vegetation indices for the field. Earth Engine → Sentinel Hub → keyless AWS COG reads. */
app.post("/api/satellite", async (req) => {
  const b: any = req.body ?? {};
  const polygon = parseRing(b.polygon);
  const lat = polygon ? centroid(polygon)[1] : num(b.lat, "lat", -60, 75);
  const lon = polygon ? centroid(polygon)[0] : num(b.lon, "lon", -180, 180);
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

function squareAround(lat: number, lon: number, m: number): Ring {
  const dy = m / 110_540, dx = m / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy]];
}

app.post("/api/satellite/ndvi.png", async (req, reply) => {
  const b: any = req.body ?? {};
  const ring = parseRing(b.polygon) ?? squareAround(num(b.lat, "lat", -60, 75), num(b.lon, "lon", -180, 180), 400);
  const { png, bbox } = await ndviPngCdse(ring);
  reply.header("content-type", "image/png").header("x-bbox", bbox.join(",")).header("access-control-expose-headers", "x-bbox");
  return reply.send(png);
});

/** Agris chat — Server-Sent Events. */
app.post("/api/agris", async (req, reply) => {
  const b: any = req.body ?? {};
  const report = reports.get(String(b.reportId ?? ""));
  if (!report) throw new BadRequest("Unknown reportId — run a field check first");
  const question = String(b.question ?? "").trim().slice(0, 2000);
  if (!question) throw new BadRequest("question is required");
  reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
  for await (const ev of ask(report, question, b.conversationId)) reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
  reply.raw.end();
  return reply;
});

// ---------- saved fields & lab tests ----------
const fieldRow = (r: any) => r && ({ ...r, polygon: r.polygon ? JSON.parse(r.polygon) : null, summary: r.summary ? JSON.parse(r.summary) : null });
app.get("/api/fields", async () => {
  const rows = db.prepare("SELECT * FROM fields ORDER BY updated DESC").all();
  const tests = db.prepare("SELECT * FROM soil_tests ORDER BY date DESC").all() as any[];
  return rows.map((r: any) => ({ ...fieldRow(r), tests: tests.filter((t) => t.field_id === r.id) }));
});
app.post("/api/fields", async (req) => {
  const b: any = req.body ?? {};
  const polygon = parseRing(b.polygon);
  const [lon, lat] = polygon ? centroid(polygon) : [num(b.lon, "lon", -180, 180), num(b.lat, "lat", -60, 75)];
  const id = randomUUID(), now = Date.now();
  db.prepare("INSERT INTO fields (id, name, lat, lon, polygon, notes, created, updated, summary) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, String(b.name || "Unnamed field").slice(0, 120), lat, lon, polygon ? JSON.stringify(polygon) : null, String(b.notes ?? "").slice(0, 4000), now, now, b.summary ? JSON.stringify(b.summary) : null);
  return fieldRow(db.prepare("SELECT * FROM fields WHERE id = ?").get(id));
});
app.put("/api/fields/:id", async (req) => {
  const { id } = req.params as any; const b: any = req.body ?? {};
  const cur: any = db.prepare("SELECT * FROM fields WHERE id = ?").get(id);
  if (!cur) throw new BadRequest("No such field");
  db.prepare("UPDATE fields SET name = ?, notes = ?, summary = ?, updated = ? WHERE id = ?")
    .run(b.name ? String(b.name).slice(0, 120) : cur.name, b.notes != null ? String(b.notes).slice(0, 4000) : cur.notes, b.summary ? JSON.stringify(b.summary) : cur.summary, Date.now(), id);
  return fieldRow(db.prepare("SELECT * FROM fields WHERE id = ?").get(id));
});
app.delete("/api/fields/:id", async (req) => {
  const { id } = req.params as any;
  db.prepare("DELETE FROM soil_tests WHERE field_id = ?").run(id);
  db.prepare("DELETE FROM fields WHERE id = ?").run(id);
  return { ok: true };
});
app.post("/api/fields/:id/tests", async (req) => {
  const { id } = req.params as any; const b: any = req.body ?? {};
  if (!db.prepare("SELECT id FROM fields WHERE id = ?").get(id)) throw new BadRequest("No such field");
  const opt = (v: any, n: string, lo: number, hi: number) => (v == null || v === "" ? null : num(v, n, lo, hi));
  db.prepare("INSERT INTO soil_tests (field_id, date, ph, organic_carbon, clay, p, k, notes) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, String(b.date || new Date().toISOString().slice(0, 10)), opt(b.ph, "pH", 3, 10.5), opt(b.organicCarbon, "organic carbon", 0, 30), opt(b.clay, "clay", 0, 100), opt(b.p, "P", 0, 1000), opt(b.k, "K", 0, 5000), String(b.notes ?? "").slice(0, 1000));
  return { ok: true };
});

// ---------- batch API for organisations ----------
const apiKeys = (process.env.API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
app.post("/api/v1/batch", async (req) => {
  if (apiKeys.length && !apiKeys.includes(String(req.headers["x-api-key"] ?? ""))) throw Object.assign(new Error("Invalid API key"), { statusCode: 401 });
  const pts = (req.body as any)?.fields;
  if (!Array.isArray(pts) || !pts.length || pts.length > 100) throw new BadRequest("fields must be an array of 1–100 {id, lat, lon, polygon?}");
  const inputs = pts.map((p: any) => ({ id: String(p.id ?? ""), input: parseInput(p) }));
  const results = await pool(inputs, 3, async ({ id, input }) => {
    try {
      const r = await cachedReport(input);
      return { id, ok: true, headline: r.headline, summary: r.summary, lime: { call: r.lime.call, rateTPerHa: r.lime.rateTPerHa },
        topCrops: r.crops.slice(0, 5).map((c: any) => ({ id: c.id, score: c.score, yield: c.yieldTPerHa })), risks: r.risks.map((x: any) => ({ id: x.id, level: x.level })),
        landHealth: r.land && { verdict: r.land.verdict, changePct: r.land.changePct } };
    } catch (e: any) { return { id, ok: false, error: e.message }; }
  });
  return { results };
});

// ---------- static frontend ----------
if (fs.existsSync(config.webDist)) {
  await app.register(fstatic, { root: config.webDist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api") ? reply.code(404).send({ error: "Not found" }) : reply.sendFile("index.html")));
}

await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`FieldSense API on :${config.port} — Agris: ${agrisMode()} — Contact: ${config.contactEmail}`);

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await app.close();
    closeDb();
    app.log.info("Server and database closed cleanly.");
    process.exit(0);
  } catch (err) {
    app.log.error(err, "Error during shutdown");
    process.exit(1);
  }
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
