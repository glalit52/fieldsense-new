// Check history, season review, fertiliser plan, alerts and PDF: engines on a real (trimmed) Ludhiana report,
// routes through fastify.inject with accounts off. No network: reports are put in the cache directly.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fieldsense-feat-"));
Object.assign(process.env, { DATA_DIR: dir, MONGO_URI: "", WEB_DIST: path.join(dir, "no-web"), ALERTS_ENABLED: "false" });
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/report-ludhiana.json", import.meta.url), "utf8"));
const report = (generatedAt = fixture.generatedAt) => ({ ...structuredClone(fixture), generatedAt });

let app: FastifyInstance;
let reports: typeof import("../src/lib/reports.ts");
before(async () => {
  const { buildApp } = await import("../src/app.ts");
  reports = await import("../src/lib/reports.ts");
  app = await buildApp({ logger: false });
});
after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("crop names from the journal match the library, including Hindi names", async () => {
  const { matchCrop } = await import("../src/engine/review.ts");
  const ids = ["Wheat", "gehun", "paddy", "Basmati rice", "Durum wheat", "green pea", "arhar", "aloo", "Corn"].map((t) => matchCrop(t)?.id);
  assert.deepEqual(ids, ["wheat", "wheat", "rice", "rice", "durum", "field_pea", "pigeon_pea", "potato", "maize"]);
  assert.equal(matchCrop("dragon fruit"), undefined);
  assert.equal(matchCrop(""), undefined);
});

test("season review separates the weather from the management", async () => {
  const { reviewSeasons } = await import("../src/engine/review.ts");
  const a = (id: string, date: string, type: string, crop: string, yieldTPerHa: number | null = null, extra = {}) =>
    ({ id, date, type, crop, product: "", quantity: null, unit: "", cost: null, yieldTPerHa, notes: "", ...extra }) as any;
  const seasons = reviewSeasons(report(), [
    a("1", "2023-11-10", "sowing", "Wheat"),
    a("2", "2024-04-15", "harvest", "Wheat", 3.1),
    a("3", "2024-10-20", "harvest", "paddy", 6.5),
    a("4", "2024-05-01", "harvest", "dragon fruit", 9),
  ]);
  assert.equal(seasons.length, 3);
  const wheat = seasons.find((s) => s.cropId === "wheat")!;
  // The model simulated the 2023 sowing (a dry, hot season) and the harvest fell short of even that.
  assert.ok(wheat.modelled! > 0 && wheat.modelled! < wheat.typical!);
  assert.equal(wheat.verdict, "below");
  assert.ok(wheat.reasons.some((r) => /hard season/.test(r)));
  assert.ok(wheat.reasons.some((r) => /No fertiliser is recorded/.test(r)));
  assert.equal(wheat.inputs.sowingDate, "2023-11-10");
  const rice = seasons.find((s) => s.cropId === "rice")!;
  assert.equal(rice.verdict, "above");
  const unknown = seasons.find((s) => s.cropId === null)!;
  assert.equal(unknown.verdict, "no model");
  assert.equal(seasons[0].harvestDate, "2024-10-20"); // newest first
});

test("fertiliser plan: balance, lab classes, legume starter and product split", async () => {
  const { nutrientPlan, nextSowingDate } = await import("../src/engine/nutrients.ts");
  const { cropById } = await import("../src/engine/crops.ts");
  const base = { organicCarbonPct: 0.5, ph: 7.9, sowingDate: "2026-11-01" };
  const wheat = nutrientPlan({ ...base, crop: cropById("wheat")!, targetYield: 5, p: 8, k: 120 });
  // (25 kg/t × 5 t − (10 + 25 × 0.5)) / 0.5 ≈ 205 kg N; P low → 1.5 × removal + 20; K medium → 0.4 × uptake.
  assert.equal(wheat.nutrients.n, 205);
  assert.equal(wheat.nutrients.p2o5, 95);
  assert.equal(wheat.nutrients.k2o, 60);
  assert.equal(wheat.basis.pClass, "low");
  assert.equal(wheat.applications.length, 3);
  assert.equal(wheat.applications[0].date, "2026-11-01");
  const nApplied = wheat.applications.reduce((s, x) => s + x.n, 0);
  assert.ok(Math.abs(nApplied - 205) <= 6, `N across doses ${nApplied}`);
  const product = (name: string) => wheat.products.find((p) => p.name.startsWith(name))!.kgPerHa;
  assert.ok(Math.abs(product("DAP") * 0.18 + product("Urea") * 0.46 - 205) < 8);
  assert.ok(wheat.notes.some((n) => /zinc/i.test(n))); // alkaline soil

  const rich = nutrientPlan({ ...base, crop: cropById("wheat")!, targetYield: 5, p: 60, k: 400 });
  assert.equal(rich.nutrients.p2o5, 0);
  assert.equal(rich.nutrients.k2o, 0);
  assert.ok(!rich.products.some((p) => p.name === "DAP"));

  const gram = nutrientPlan({ ...base, crop: cropById("chickpea")!, targetYield: 2 });
  assert.equal(gram.nutrients.n, 20);
  assert.equal(gram.applications.length, 1);
  assert.ok(gram.notes.some((n) => /fixes its own nitrogen/.test(n)));

  assert.equal(nextSowingDate(304, new Date("2026-03-01T00:00:00Z")), "2026-11-01");
  assert.equal(nextSowingDate(30, new Date("2026-03-01T00:00:00Z")), "2027-01-31");
});

test("forecast days become dated alerts, one per kind and day", async () => {
  const { alertsFromDays } = await import("../src/services/alerts.ts");
  const day = (date: string, o: Record<string, unknown> = {}) => ({
    date, tmax: 28, tmin: 12, rain: 0, rainProb: 0, et0: 4, windMax: 10, gust: 20, weatherCode: 0, frost: "none", heat: false,
    sprayHours: 0, sprayWindows: [], leafWetHours: 0, diseaseRisk: "low", smithPeriod: false, workable: true, past: false, ...o,
  }) as any;
  const alerts = alertsFromDays([
    day("2026-10-28", { past: true, frost: "hard" }),
    day("2026-10-29", { frost: "hard", tmin: -4 }),
    day("2026-10-30", { rain: 60, gust: 75 }),
    day("2026-10-31", { sprayHours: 4, sprayWindows: [{ from: "07:00", to: "11:00", quality: "good" }] }),
    day("2026-11-01", { smithPeriod: true, diseaseRisk: "high", sprayWindows: [{ from: "08:00", to: "09:00", quality: "good" }] }),
    day("2026-11-02", { diseaseRisk: "high" }),
    day("2026-11-03", { diseaseRisk: "high" }),
  ]);
  // Blight days aren't double-counted as disease; disease and spray are one alert each for the week.
  assert.deepEqual(alerts.map((a) => `${a.kind}@${a.day}`), ["frost_hard@2026-10-29", "heavy_rain@2026-10-30", "gusts@2026-10-30", "blight@2026-11-01", "disease@2026-11-02", "spray@2026-10-31"]);
  assert.equal(alerts.find((a) => a.kind === "disease")!.value, 2);
  assert.equal(alerts.find((a) => a.kind === "heavy_rain")!.level, "danger");
  assert.deepEqual(alerts.find((a) => a.kind === "spray")!.detail, { from: "07:00", to: "11:00" });
});

test("report PDF is a well-formed multi-page document", async () => {
  const { reportPdf } = await import("../src/lib/reportPdf.ts");
  const pdf = reportPdf(report(), { fieldName: "Test (field) \\ with “quotes” and ≥ symbols" });
  const s = pdf.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  const pages = (s.match(/\/Type \/Page /g) ?? []).length;
  assert.ok(pages >= 2, `pages ${pages}`);
  // Every xref offset points at its object.
  const xref = Number(s.match(/startxref\n(\d+)/)![1]);
  assert.ok(s.slice(xref).startsWith("xref"));
  const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.ok(s.includes(`Page ${pages} of ${pages}`));
  // A sparse report (sources failed) still renders.
  assert.ok(reportPdf({ generatedAt: fixture.generatedAt, location: { lat: 1, lon: 2 }, headline: "x", crops: [], risks: [] }).length > 1000);
});

test("archiving checks: history, dedupe, reopen, review, PDF and cleanup", async () => {
  const created = await app.inject({ method: "POST", url: "/api/fields", payload: { name: "North block", lat: 30.9, lon: 75.85 } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;

  const expired = await app.inject({ method: "POST", url: `/api/fields/${id}/checks`, payload: { reportId: "00000000-0000-0000-0000-000000000000" } });
  assert.equal(expired.statusCode, 400);
  assert.match(expired.json().error, /expired/);

  const first = reports.storeReport(report("2025-10-01T08:00:00.000Z"));
  const second = reports.storeReport(report("2026-10-01T08:00:00.000Z"));
  const a1 = await app.inject({ method: "POST", url: `/api/fields/${id}/checks`, payload: { reportId: first } });
  assert.equal(a1.statusCode, 201, a1.body);
  assert.equal(a1.json().field.summary.checkedAt, "2025-10-01T08:00:00.000Z");
  await app.inject({ method: "POST", url: `/api/fields/${id}/checks`, payload: { reportId: second } });
  const again = await app.inject({ method: "POST", url: `/api/fields/${id}/checks`, payload: { reportId: second } });
  assert.equal(again.statusCode, 201);

  const list = (await app.inject(`/api/fields/${id}/checks`)).json();
  assert.equal(list.length, 2, "archiving the same report twice keeps one check");
  assert.equal(list[0].checkedAt, "2026-10-01T08:00:00.000Z");
  assert.equal(list[0].topCrops[0].id, fixture.crops[0].id);
  assert.equal(list[0].report, undefined, "the list doesn't carry full reports");

  const opened = (await app.inject(`/api/fields/${id}/checks/${list[1].id}`)).json();
  assert.equal(opened.report.generatedAt, "2025-10-01T08:00:00.000Z");
  assert.deepEqual(opened.report.crops, fixture.crops);
  assert.match(opened.reportId, /^[0-9a-f-]{36}$/);
  assert.equal((await app.inject(`/api/fields/${id}/checks/999999`)).statusCode, 404);

  await app.inject({ method: "POST", url: `/api/fields/${id}/activities`, payload: { date: "2024-04-15", type: "harvest", crop: "Wheat", yieldTPerHa: 3.1 } });
  const review = (await app.inject(`/api/fields/${id}/review`)).json();
  assert.equal(review.checkedAt, "2026-10-01T08:00:00.000Z");
  assert.equal(review.seasons[0].cropId, "wheat");

  const pdf = await app.inject(`/api/fields/${id}/report.pdf`);
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers["content-type"], "application/pdf");
  assert.match(String(pdf.headers["content-disposition"]), /attachment; filename="fieldsense-North-block-2026-10-01\.pdf"/);
  assert.ok(pdf.rawPayload.subarray(0, 8).toString() === "%PDF-1.4");

  assert.equal((await app.inject({ method: "DELETE", url: `/api/fields/${id}/checks/${list[1].id}` })).statusCode, 200);
  assert.equal((await app.inject(`/api/fields/${id}/checks`)).json().length, 1);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/fields/${id}` })).statusCode, 200);
  assert.equal((await app.inject(`/api/fields/${id}/checks`)).statusCode, 404);
  const { db } = await import("../src/lib/cache.ts");
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM field_checks WHERE field_id = ?").get(id) as any).c, 0);
});

test("history keeps the newest checks per field", async () => {
  const { MAX_CHECKS_PER_FIELD } = await import("../src/stores/checks.ts");
  const id = (await app.inject({ method: "POST", url: "/api/fields", payload: { name: "Busy", lat: 30.9, lon: 75.85 } })).json().id;
  for (let i = 0; i < MAX_CHECKS_PER_FIELD + 3; i++) {
    const rid = reports.storeReport(report(new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
    await app.inject({ method: "POST", url: `/api/fields/${id}/checks`, payload: { reportId: rid } });
  }
  const list = (await app.inject(`/api/fields/${id}/checks`)).json();
  assert.equal(list.length, MAX_CHECKS_PER_FIELD);
  assert.equal(list.at(-1).checkedAt, new Date(Date.UTC(2026, 0, 4)).toISOString());
});

test("fertiliser plan and report PDF endpoints work from a reportId", async () => {
  const rid = reports.storeReport(report());
  const plan = await app.inject({ method: "POST", url: "/api/nutrients", payload: { reportId: rid, cropId: "wheat", p: 8, k: 120 } });
  assert.equal(plan.statusCode, 200, plan.body);
  const p = plan.json();
  assert.equal(p.crop.id, "wheat");
  assert.equal(p.targetYield, Math.round(fixture.crops.find((c: any) => c.id === "wheat").yieldTPerHa.median * 10) / 10);
  assert.ok(p.nutrients.n > 50 && p.nutrients.n < 250);
  const tooHigh = await app.inject({ method: "POST", url: "/api/nutrients", payload: { reportId: rid, cropId: "wheat", targetYield: 99 } });
  assert.equal(tooHigh.statusCode, 400);
  const fallback = (await app.inject({ method: "POST", url: "/api/nutrients", payload: { reportId: rid, cropId: "not-a-crop" } })).json();
  assert.equal(fallback.crop.id, fixture.crops.find((c: any) => c.group !== "Forage").id);

  const pdf = await app.inject({ method: "POST", url: "/api/report.pdf", payload: { reportId: rid, fieldName: "Ghar wala khet" } });
  assert.equal(pdf.statusCode, 200);
  assert.match(String(pdf.headers["content-disposition"]), /fieldsense-Ghar-wala-khet\.pdf/);
  assert.equal((await app.inject({ method: "POST", url: "/api/report.pdf", payload: { reportId: "nope" } })).statusCode, 400);
});

test("alerts inbox: list, mark read, settings need accounts", async () => {
  const { db } = await import("../src/lib/cache.ts");
  const today = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO alerts (owner, field_id, field_name, kind, level, day, value, created) VALUES ('local','f1','Field 1','heat','warn',?,41,?)").run(today, Date.now());
  db.prepare("INSERT INTO alerts (owner, field_id, field_name, kind, level, day, value, created) VALUES ('someone-else','f2','Theirs','heat','warn',?,41,?)").run(today, Date.now());
  const res = (await app.inject("/api/alerts")).json();
  assert.equal(res.alerts.length, 1, "only this owner's alerts");
  assert.equal(res.unread, 1);
  assert.deepEqual(res.email, { available: false, enabled: false });
  assert.equal(res.alerts[0].kind, "heat");
  await app.inject({ method: "POST", url: "/api/alerts/read", payload: {} });
  assert.equal((await app.inject("/api/alerts")).json().unread, 0);
  const settings = await app.inject({ method: "PUT", url: "/api/alerts/settings", payload: { email: true } });
  assert.equal(settings.statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/alerts/read", payload: { ids: "x" } })).statusCode, 400);
});
