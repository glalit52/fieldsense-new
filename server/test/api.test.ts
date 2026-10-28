// HTTP-level tests with fastify.inject: no network, no MongoDB (accounts off), SQLite in a temp dir.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fieldsense-test-"));
Object.assign(process.env, { DATA_DIR: dir, API_KEYS: "k1,k2", MONGO_URI: "", WEB_DIST: path.join(dir, "no-web") });

let app: FastifyInstance;
before(async () => {
  const { buildApp } = await import("../src/app.ts");
  app = await buildApp({ logger: false });
});
after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const square = [[142.155, -36.627], [142.165, -36.627], [142.165, -36.634], [142.155, -36.634]];

test("health reports accounts off and persistent storage", async () => {
  const res = await app.inject("/api/health");
  assert.equal(res.statusCode, 200);
  const h = res.json();
  assert.equal(h.ok, true);
  assert.deepEqual(h.accounts, { enabled: false, connected: false });
  assert.equal(h.database.persistent, true);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("bad input is a 400 with a message, unknown API routes are JSON 404s", async () => {
  const bad = await app.inject({ method: "POST", url: "/api/report", payload: { lat: 200, lon: 0 } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /lat must be/);
  const missing = await app.inject("/api/nope");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error, "Not found");
});

test("auth routes say accounts are disabled", async () => {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: {} });
  assert.equal(res.statusCode, 404);
  assert.match(res.json().error, /not enabled/);
});

test("batch API rejects a wrong key with 401, not 502", async () => {
  const none = await app.inject({ method: "POST", url: "/api/v1/batch", payload: { fields: [] } });
  assert.equal(none.statusCode, 401);
  const badBody = await app.inject({ method: "POST", url: "/api/v1/batch", headers: { "x-api-key": "k2" }, payload: { fields: [] } });
  assert.equal(badBody.statusCode, 400);
});

test("agris with an unknown report asks for a re-run", async () => {
  const res = await app.inject({ method: "POST", url: "/api/agris", payload: { reportId: "x", question: "hi" } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /expired/);
});

test("saved fields: create, rename, lab tests, delete", async () => {
  const created = await app.inject({ method: "POST", url: "/api/fields", payload: { name: "  North paddock ", polygon: square, summary: { soilPh: 5.4 } } });
  assert.equal(created.statusCode, 201);
  const f = created.json();
  assert.equal(f.name, "North paddock");
  assert.equal(f.polygon.length, 4);
  assert.ok(Math.abs(f.lat - -36.6305) < 0.001);

  const renamed = await app.inject({ method: "PUT", url: `/api/fields/${f.id}`, payload: { name: "South", notes: "limed 2025" } });
  assert.equal(renamed.json().name, "South");
  assert.equal(renamed.json().summary.soilPh, 5.4, "summary kept when not sent");

  assert.equal((await app.inject({ method: "POST", url: `/api/fields/${f.id}/tests`, payload: { date: "2026-01-01" } })).statusCode, 400, "empty test rejected");
  await app.inject({ method: "POST", url: `/api/fields/${f.id}/tests`, payload: { date: "2025-03-01", ph: "5.1" } });
  const withTests = (await app.inject({ method: "POST", url: `/api/fields/${f.id}/tests`, payload: { date: "2026-03-01", ph: 6.2, organicCarbon: 1.4 } })).json();
  assert.deepEqual(withTests.tests.map((t: any) => t.ph), [6.2, 5.1], "newest first");
  assert.equal(withTests.tests[0].organicCarbon, 1.4);

  const afterDel = (await app.inject({ method: "DELETE", url: `/api/fields/${f.id}/tests/${withTests.tests[1].id}` })).json();
  assert.equal(afterDel.tests.length, 1);

  assert.equal((await app.inject({ method: "DELETE", url: `/api/fields/${f.id}` })).statusCode, 200);
  assert.equal((await app.inject(`/api/fields/${f.id}`)).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/fields/${f.id}` })).statusCode, 404);
  assert.deepEqual((await app.inject("/api/fields")).json(), []);
});

test("field summaries are capped", async () => {
  const res = await app.inject({ method: "POST", url: "/api/fields", payload: { lat: 1, lon: 1, summary: { blob: "x".repeat(30_000) } } });
  assert.equal(res.statusCode, 400);
});

test("readiness is 200 when SQLite is up and accounts are off", async () => {
  const res = await app.inject("/api/ready");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ready, true);
});

test("field journal: activities are validated, newest first, and removed with the field", async () => {
  const f = (await app.inject({ method: "POST", url: "/api/fields", payload: { name: "Journal", lat: -36.6, lon: 142.1 } })).json();
  assert.deepEqual(f.activities, []);
  const bad = await app.inject({ method: "POST", url: `/api/fields/${f.id}/activities`, payload: { date: "2026-05-01", type: "dancing" } });
  assert.equal(bad.statusCode, 400);
  await app.inject({ method: "POST", url: `/api/fields/${f.id}/activities`, payload: { date: "2026-05-01", type: "sowing", crop: "Wheat", quantity: "100", unit: "kg/ha", cost: 80 } });
  const res = await app.inject({ method: "POST", url: `/api/fields/${f.id}/activities`, payload: { date: "2026-11-20", type: "Harvest", crop: "Wheat", yieldTPerHa: 4.2 } });
  assert.equal(res.statusCode, 201);
  const acts = res.json().activities;
  assert.deepEqual(acts.map((a: any) => a.type), ["harvest", "sowing"]);
  assert.equal(acts[0].yieldTPerHa, 4.2);
  assert.equal(acts[1].quantity, 100);
  assert.equal(acts[1].cost, 80);

  const left = (await app.inject({ method: "DELETE", url: `/api/fields/${f.id}/activities/${acts[1].id}` })).json();
  assert.equal(left.activities.length, 1);
  await app.inject({ method: "DELETE", url: `/api/fields/${f.id}` });
  const { db } = await import("../src/lib/cache.ts");
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM activities WHERE field_id = ?").get(f.id) as any).c, 0);
});

test("bulk import validates every row before writing", async () => {
  const before = (await app.inject("/api/fields")).json().length;
  const bad = await app.inject({ method: "POST", url: "/api/fields/import", payload: { fields: [{ name: "ok", lat: 1, lon: 1 }, { name: "bad", lat: 999, lon: 1 }] } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /Row 2/);
  assert.equal((await app.inject("/api/fields")).json().length, before, "nothing written");
  const ok = await app.inject({ method: "POST", url: "/api/fields/import", payload: { fields: [{ name: "A", lat: 1, lon: 1 }, { name: "B", polygon: square }] } });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().created, 2);
});
