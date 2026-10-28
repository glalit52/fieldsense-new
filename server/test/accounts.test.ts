// Accounts and per-user fields against a throwaway MongoDB (mongodb-memory-server downloads mongod on first run).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongo: MongoMemoryServer;
let app: FastifyInstance;
let closeMongo: () => Promise<void>;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fieldsense-acct-"));

before(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, { DATA_DIR: dir, MONGO_URI: mongo.getUri("fieldsense"), JWT_SECRET: "t".repeat(40), ADMIN_EMAILS: "boss@example.com", WEB_DIST: path.join(dir, "no-web") });
  const { buildApp } = await import("../src/app.ts");
  const m = await import("../src/lib/mongoose.ts");
  closeMongo = m.closeMongo;
  app = await buildApp({ logger: false });
  await m.connectMongo(app.log);
});
after(async () => {
  await app.close();
  await closeMongo();
  await mongo.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Signs up and returns the session cookie header. */
async function signup(email: string, password = "correct horse") {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { name: "Test Farmer", email, password } });
  assert.equal(res.statusCode, 201, res.body);
  const c = res.cookies.find((x) => x.name === "fs_session")!;
  assert.equal(c.httpOnly, true);
  return { cookie: `fs_session=${c.value}`, user: res.json().user };
}

test("signup, me, login, logout", async () => {
  const { cookie, user } = await signup("Ana@Example.com");
  assert.equal(user.email, "ana@example.com");
  assert.equal(user.password, undefined, "hash never returned");

  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie } })).json().user.id, user.id);
  assert.equal((await app.inject("/api/auth/me")).statusCode, 401);

  const dup = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { name: "X Y", email: "ana@example.com", password: "whatever12" } });
  assert.equal(dup.statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/signup", payload: { name: "X Y", email: "b@x.io", password: "short" } })).statusCode, 400);

  assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ana@example.com", password: "nope nope" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ghost@example.com", password: "nope nope" } })).statusCode, 401);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ANA@example.com", password: "correct horse" } });
  assert.equal(login.statusCode, 200);

  const out = await app.inject({ method: "POST", url: "/api/auth/logout" });
  assert.equal(out.cookies.find((x) => x.name === "fs_session")?.value, "");
});

test("bearer tokens are rejected when tampered with", async () => {
  const { cookie } = await signup("bearer@example.com");
  const token = cookie.split("=")[1];
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${token}x` } })).statusCode, 401);
});

test("fields require sign-in and are private to their owner", async () => {
  assert.equal((await app.inject("/api/fields")).statusCode, 401);
  const a = await signup("owner-a@example.com");
  const b = await signup("owner-b@example.com");

  const f = (await app.inject({ method: "POST", url: "/api/fields", headers: { cookie: a.cookie }, payload: { name: "A1", lat: -36.6, lon: 142.1 } })).json();
  assert.equal((await app.inject({ url: "/api/fields", headers: { cookie: a.cookie } })).json().length, 1);
  assert.equal((await app.inject({ url: "/api/fields", headers: { cookie: b.cookie } })).json().length, 0);
  assert.equal((await app.inject({ url: `/api/fields/${f.id}`, headers: { cookie: b.cookie } })).statusCode, 404, "other user's field is invisible");
  assert.equal((await app.inject({ method: "DELETE", url: `/api/fields/${f.id}`, headers: { cookie: b.cookie } })).statusCode, 404);
  assert.equal((await app.inject({ url: "/api/fields/not-an-id", headers: { cookie: a.cookie } })).statusCode, 404, "malformed id is 404 not 502");

  const t = (await app.inject({ method: "POST", url: `/api/fields/${f.id}/tests`, headers: { cookie: a.cookie }, payload: { date: "2026-02-01", ph: 5.6, clay: 22 } })).json();
  assert.equal(t.tests[0].ph, 5.6);
  const updated = (await app.inject({ method: "PUT", url: `/api/fields/${f.id}`, headers: { cookie: a.cookie }, payload: { summary: { soilPh: 5.6 } } })).json();
  assert.equal(updated.summary.soilPh, 5.6);
  assert.equal(updated.tests.length, 1);
  const noTest = (await app.inject({ method: "DELETE", url: `/api/fields/${f.id}/tests/${t.tests[0].id}`, headers: { cookie: a.cookie } })).json();
  assert.equal(noTest.tests.length, 0);
});

test("password change signs out older sessions; account deletion removes fields", async () => {
  const { cookie: old } = await signup("rotate@example.com");
  await new Promise((r) => setTimeout(r, 1100)); // JWT iat has 1 s resolution
  const changed = await app.inject({ method: "POST", url: "/api/auth/password", headers: { cookie: old }, payload: { currentPassword: "correct horse", newPassword: "battery staple" } });
  assert.equal(changed.statusCode, 200);
  const fresh = `fs_session=${changed.cookies.find((x) => x.name === "fs_session")!.value}`;
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: old } })).statusCode, 401, "old session revoked");
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: fresh } })).statusCode, 200);

  await app.inject({ method: "POST", url: "/api/fields", headers: { cookie: fresh }, payload: { lat: 1, lon: 1 } });
  assert.equal((await app.inject({ method: "DELETE", url: "/api/auth/me", headers: { cookie: fresh }, payload: { password: "wrong pass" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/auth/me", headers: { cookie: fresh }, payload: { password: "battery staple" } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: fresh } })).statusCode, 401);
  const { Field } = await import("../src/models/Field.ts");
  assert.equal(await Field.countDocuments({}), 1, "only owner-a's field remains");
});

test("tokens in the query string are ignored", async () => {
  const { cookie } = await signup("query@example.com");
  const token = cookie.split("=")[1];
  assert.equal((await app.inject(`/api/auth/me?token=${token}`)).statusCode, 401);
});

/** Reused below: sign-up is limited to 10/min per IP, which this suite would otherwise exceed. */
let plain: Awaited<ReturnType<typeof signup>>, boss: typeof plain;
test("admin endpoints are for admins only; ADMIN_EMAILS grants the role", async () => {
  plain = await signup("plain@example.com");
  assert.equal((await app.inject({ url: "/api/admin/stats", headers: { cookie: plain.cookie } })).statusCode, 403);
  boss = await signup("boss@example.com");
  assert.equal(boss.user.role, "admin");
  const stats = (await app.inject({ url: "/api/admin/stats", headers: { cookie: boss.cookie } })).json();
  assert.ok(stats.users >= 2);
  const list = (await app.inject({ url: "/api/admin/users?q=plain", headers: { cookie: boss.cookie } })).json();
  assert.equal(list.total, 1);
  assert.equal(list.users[0].email, "plain@example.com");
  assert.equal(list.users[0].password, undefined);
  const promoted = await app.inject({ method: "PATCH", url: `/api/admin/users/${plain.user.id}`, headers: { cookie: boss.cookie }, payload: { role: "admin" } });
  assert.equal(promoted.json().user.role, "admin");
  assert.equal((await app.inject({ url: "/api/admin/stats", headers: { cookie: plain.cookie } })).statusCode, 200);
  const self = await app.inject({ method: "PATCH", url: `/api/admin/users/${plain.user.id}`, headers: { cookie: plain.cookie }, payload: { role: "user" } });
  assert.equal(self.statusCode, 400, "can't demote yourself");
});

test("activities are private to the field's owner", async () => {
  const a = boss, b = plain;
  const f = (await app.inject({ method: "POST", url: "/api/fields", headers: { cookie: a.cookie }, payload: { name: "F", lat: 1, lon: 1 } })).json();
  const res = await app.inject({ method: "POST", url: `/api/fields/${f.id}/activities`, headers: { cookie: a.cookie }, payload: { date: "2026-06-01", type: "spraying", product: "Glyphosate", cost: 12.5 } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().activities[0].product, "Glyphosate");
  assert.equal((await app.inject({ method: "POST", url: `/api/fields/${f.id}/activities`, headers: { cookie: b.cookie }, payload: { date: "2026-06-01", type: "other" } })).statusCode, 404);
  const gone = await app.inject({ method: "DELETE", url: `/api/fields/${f.id}/activities/${res.json().activities[0].id}`, headers: { cookie: a.cookie } });
  assert.equal(gone.json().activities.length, 0);
});
