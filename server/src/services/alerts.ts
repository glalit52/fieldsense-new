import type { FastifyBaseLogger } from "fastify";
import { authEnabled, config } from "../config.ts";
import { operations, type DayOps } from "../engine/operations.ts";
import type { SoilSummary } from "../engine/soil.ts";
import { db } from "../lib/cache.ts";
import { pool } from "../lib/http.ts";
import { isMongoConnected } from "../lib/mongoose.ts";
import { Field } from "../models/Field.ts";
import { User } from "../models/User.ts";
import { forecast } from "../providers/openmeteo.ts";

/**
 * Weather and spray alerts for saved fields. Alerts live in SQLite in both modes (they are derived and short-lived),
 * keyed by owner ("local" without accounts, else the user id). One alert per field, kind and day, so re-running
 * the scan never duplicates. Text is built by the client from `kind` and `value`, so alerts follow the UI language.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    field_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    level TEXT NOT NULL,
    day TEXT NOT NULL,
    value REAL,
    detail TEXT,
    created INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    emailed INTEGER NOT NULL DEFAULT 0,
    UNIQUE (owner, field_id, kind, day)
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_owner ON alerts(owner, created DESC);
  CREATE TABLE IF NOT EXISTS alert_runs (field_id TEXT PRIMARY KEY, last_day TEXT NOT NULL);
`);

export type AlertKind = "frost_hard" | "frost_light" | "heat" | "heavy_rain" | "gusts" | "blight" | "disease" | "spray";
export interface FieldAlert {
  id: string; fieldId: string; fieldName: string; kind: AlertKind; level: "danger" | "warn" | "info";
  day: string; value: number | null; detail: Record<string, unknown> | null; created: number; read: boolean;
}
interface NewAlert { kind: AlertKind; level: FieldAlert["level"]; day: string; value: number | null; detail?: Record<string, unknown> }
interface WatchedField { owner: string; id: string; name: string; lat: number; lon: number }

/** operations() only uses the soil's water limits; a medium loam stands in, since alerts don't depend on them. */
const LOAM = { fieldCapacity: 0.3, wiltingPoint: 0.14 } as SoilSummary;
const ALERT_DAYS = 7, SPRAY_DAYS = 3, KEEP_DAYS = 30;

/** Alert-worthy events in the next week of a field's forecast. */
export function alertsFromDays(days: DayOps[]): NewAlert[] {
  const ahead = days.filter((d) => !d.past).slice(0, ALERT_DAYS);
  const out: NewAlert[] = [];
  for (const d of ahead) {
    if (d.frost === "hard") out.push({ kind: "frost_hard", level: "danger", day: d.date, value: d.tmin });
    else if (d.frost === "light") out.push({ kind: "frost_light", level: "warn", day: d.date, value: d.tmin });
    if (d.heat) out.push({ kind: "heat", level: "warn", day: d.date, value: d.tmax });
    if (d.rain >= 25) out.push({ kind: "heavy_rain", level: d.rain >= 50 ? "danger" : "warn", day: d.date, value: Math.round(d.rain) });
    if ((d.gust ?? 0) > 60) out.push({ kind: "gusts", level: "warn", day: d.date, value: Math.round(d.gust) });
    if (d.smithPeriod) out.push({ kind: "blight", level: "danger", day: d.date, value: null });
  }
  // Disease and spray are weekly signals, not daily ones: one alert each, so the inbox isn't flooded.
  const wet = ahead.filter((d) => d.diseaseRisk === "high" && !d.smithPeriod);
  if (wet.length >= 2) out.push({ kind: "disease", level: "warn", day: wet[0].date, value: wet.length });
  const spray = ahead.slice(0, SPRAY_DAYS).find((d) => d.sprayWindows.some((x) => x.quality === "good"));
  if (spray) {
    const w = spray.sprayWindows.find((x) => x.quality === "good")!;
    out.push({ kind: "spray", level: "info", day: spray.date, value: spray.sprayHours, detail: { from: w.from, to: w.to } });
  }
  return out;
}

const insert = db.prepare(`INSERT OR IGNORE INTO alerts (owner, field_id, field_name, kind, level, day, value, detail, created)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const row = (r: any): FieldAlert => ({
  id: String(r.id), fieldId: r.field_id, fieldName: r.field_name, kind: r.kind, level: r.level, day: r.day,
  value: r.value, detail: r.detail ? JSON.parse(r.detail) : null, created: r.created, read: Boolean(r.read),
});

/** Saved fields to watch: every account's fields with accounts on, else the local workspace's. */
async function watchedFields(owner?: string): Promise<WatchedField[]> {
  if (authEnabled()) {
    if (!isMongoConnected()) return [];
    const docs = await Field.find(owner ? { userId: owner } : {}, { name: 1, lat: 1, lon: 1, userId: 1 }).lean();
    return docs.map((d: any) => ({ owner: String(d.userId), id: String(d._id), name: d.name, lat: d.lat, lon: d.lon }));
  }
  return (db.prepare("SELECT id, name, lat, lon FROM fields").all() as any[]).map((r) => ({ owner: "local", id: r.id, name: r.name, lat: r.lat, lon: r.lon }));
}

/**
 * Scans saved fields' forecasts and stores new alerts. Each field is scanned once a day unless `force`
 * (the user's "refresh"). Returns how many fields were scanned and how many new alerts were raised.
 */
export async function scanFields(opts: { owner?: string; force?: boolean; log?: FastifyBaseLogger } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const lastRun = db.prepare("SELECT last_day FROM alert_runs WHERE field_id = ?");
  const fields = (await watchedFields(opts.owner)).filter((f) => opts.force || (lastRun.get(f.id) as any)?.last_day !== today);
  let raised = 0, failed = 0;
  // Fields share forecasts per ~1 km cell (cached hourly), so neighbouring fields cost one upstream call.
  await pool(fields, 3, async (f) => {
    try {
      const ops = operations(await forecast(f.lat, f.lon), LOAM);
      for (const a of alertsFromDays(ops.days)) {
        raised += Number(insert.run(f.owner, f.id, f.name, a.kind, a.level, a.day, a.value, a.detail ? JSON.stringify(a.detail) : null, Date.now()).changes ?? 0);
      }
      db.prepare("INSERT OR REPLACE INTO alert_runs (field_id, last_day) VALUES (?, ?)").run(f.id, today);
    } catch (err) {
      failed++;
      opts.log?.warn({ err, field: f.id }, "alert scan failed for field");
    }
  });
  db.prepare("DELETE FROM alerts WHERE day < ?").run(new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10));
  if (raised) await emailNewAlerts(opts.log);
  return { scanned: fields.length, raised, failed };
}

export function listAlerts(owner: string) {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const alerts = (db.prepare("SELECT * FROM alerts WHERE owner = ? AND day >= ? ORDER BY day ASC, field_name ASC, level ASC LIMIT 300").all(owner, since) as any[]).map(row);
  return { alerts, unread: alerts.filter((a) => !a.read).length };
}

export function markRead(owner: string, ids?: string[]) {
  if (ids?.length) {
    const stmt = db.prepare("UPDATE alerts SET read = 1 WHERE owner = ? AND id = ?");
    for (const id of ids.slice(0, 500)) stmt.run(owner, Number(id) || -1);
  } else db.prepare("UPDATE alerts SET read = 1 WHERE owner = ?").run(owner);
}

export function removeFieldAlerts(fieldId: string) {
  db.prepare("DELETE FROM alerts WHERE field_id = ?").run(fieldId);
  db.prepare("DELETE FROM alert_runs WHERE field_id = ?").run(fieldId);
}
export function removeOwnerAlerts(owner: string) {
  db.prepare("DELETE FROM alerts WHERE owner = ?").run(owner);
}

// ---------- Email (Resend) ----------

const fmtDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
/** English alert text for emails (the app renders its own, translated). */
export function alertText(a: Pick<FieldAlert, "kind" | "day" | "value" | "detail">) {
  const day = fmtDay(a.day), v = a.value;
  switch (a.kind) {
    case "frost_hard": return `Hard frost (${v?.toFixed(0)} °C) on ${day}. Protect seedlings and flowering crops.`;
    case "frost_light": return `Light frost possible (${v?.toFixed(0)} °C) on ${day}.`;
    case "heat": return `Heat: ${v?.toFixed(0)} °C on ${day}. Avoid afternoon spraying; irrigate ahead if you can.`;
    case "heavy_rain": return `Heavy rain: about ${v} mm on ${day}. Hold fertiliser and chemical applications.`;
    case "gusts": return `Damaging gusts up to ${v} km/h on ${day}.`;
    case "blight": return `Late-blight weather (Smith period) on ${day}. Protect potato and tomato crops.`;
    case "disease": return `Long leaf wetness on ${v} days this week, from ${day}, favours fungal disease. Scout your crops.`;
    case "spray": return `Good spray window on ${day}, ${a.detail?.from}–${a.detail?.to} (light wind, Delta T 2–8, no rain for 4 h).`;
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Emails each opted-in user one digest of their new frost, heat, rain, wind and disease alerts. */
async function emailNewAlerts(log?: FastifyBaseLogger) {
  const { resendKey, from } = config.alerts;
  if (!resendKey || !from || !authEnabled() || !isMongoConnected()) return;
  const pending = db.prepare("SELECT * FROM alerts WHERE emailed = 0 AND level IN ('danger','warn') ORDER BY day ASC").all() as any[];
  if (!pending.length) return;
  const byOwner = new Map<string, FieldAlert[]>();
  for (const r of pending) (byOwner.get(r.owner) ?? byOwner.set(r.owner, []).get(r.owner)!).push(row(r));
  const users = await User.find({ _id: { $in: [...byOwner.keys()] }, alertEmails: true }, { email: 1, name: 1 }).lean();
  const done = db.prepare("UPDATE alerts SET emailed = 1 WHERE owner = ? AND emailed = 0");
  for (const owner of byOwner.keys()) {
    const u = users.find((x) => String(x._id) === owner);
    if (!u) { done.run(owner); continue; } // not opted in: never email these later either
    const list = byOwner.get(owner)!;
    const lines = list.map((a) => `<li><b>${escapeHtml(a.fieldName)}</b>: ${escapeHtml(alertText(a))}</li>`).join("");
    const html = `<p>Hello ${escapeHtml(u.name)},</p><p>New weather alerts for your fields:</p><ul>${lines}</ul>`
      + (config.appUrl ? `<p><a href="${config.appUrl}">Open FieldSense</a> for the full 16-day plan.</p>` : "")
      + `<p style="color:#666;font-size:12px">You get these because alert emails are on in FieldSense settings.</p>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [u.email], subject: `FieldSense: ${list.length} weather alert${list.length === 1 ? "" : "s"} for your fields`, html }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      done.run(owner);
    } catch (err) {
      log?.warn({ err }, "alert email failed; will retry on the next scan");
    }
  }
}

/** Starts the background scan: shortly after boot, then every three hours (each field at most once a day). */
export function startAlertScheduler(log: FastifyBaseLogger) {
  if (!config.alerts.enabled) return;
  const run = () => scanFields({ log }).then((r) => r.scanned && log.info(r, "alert scan")).catch((err) => log.error({ err }, "alert scan failed"));
  setTimeout(run, 90_000).unref();
  setInterval(run, 3 * 3600_000).unref();
}
