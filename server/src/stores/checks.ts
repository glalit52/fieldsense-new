import mongoose from "mongoose";
import type { Report } from "../engine/report.ts";
import { db } from "../lib/cache.ts";
import { checkSnapshot, packReport, unpackReport, type CheckSnapshot } from "../lib/reports.ts";
import { notFound } from "../lib/validate.ts";
import { FieldCheck } from "../models/FieldCheck.ts";

/** A field's archived check as the history list shows it. */
export type CheckMeta = CheckSnapshot & { id: string };

/** Oldest checks beyond this are dropped, so a field re-checked daily keeps about two months of history. */
export const MAX_CHECKS_PER_FIELD = 60;

/**
 * Archived checks of saved fields. Callers verify the owner has the field first (FieldStore.get);
 * the stores still scope every query by owner so a wrong field id can never reach another user's checks.
 */
export interface CheckStore {
  list(owner: string, fieldId: string): Promise<CheckMeta[]>;
  get(owner: string, fieldId: string, checkId: string): Promise<{ check: CheckMeta; report: Report }>;
  /** Archives a report; archiving the same report twice returns the existing check. */
  add(owner: string, fieldId: string, report: Report): Promise<CheckMeta>;
  remove(owner: string, fieldId: string, checkId: string): Promise<void>;
  removeField(owner: string, fieldId: string): Promise<void>;
}

const noCheck = () => notFound("No such check");

// ---------- SQLite (accounts off) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS field_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    report BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_field_checks_field ON field_checks(field_id, checked_at DESC);
`);
const sqlMeta = (r: any): CheckMeta => ({ ...JSON.parse(r.snapshot), id: String(r.id) });

export const sqliteCheckStore: CheckStore = {
  async list(_owner, fieldId) {
    return (db.prepare("SELECT id, snapshot FROM field_checks WHERE field_id = ? ORDER BY checked_at DESC, id DESC").all(fieldId) as any[]).map(sqlMeta);
  },
  async get(_owner, fieldId, checkId) {
    const r = db.prepare("SELECT * FROM field_checks WHERE field_id = ? AND id = ?").get(fieldId, Number(checkId) || -1) as any;
    if (!r) throw noCheck();
    return { check: sqlMeta(r), report: unpackReport(r.report) };
  },
  async add(_owner, fieldId, report) {
    const dup = db.prepare("SELECT id, snapshot FROM field_checks WHERE field_id = ? AND checked_at = ?").get(fieldId, report.generatedAt);
    if (dup) return sqlMeta(dup);
    const snap = checkSnapshot(report);
    const { lastInsertRowid } = db.prepare("INSERT INTO field_checks (field_id, checked_at, snapshot, report) VALUES (?,?,?,?)")
      .run(fieldId, report.generatedAt, JSON.stringify(snap), packReport(report));
    db.prepare(`DELETE FROM field_checks WHERE field_id = ? AND id NOT IN
      (SELECT id FROM field_checks WHERE field_id = ? ORDER BY checked_at DESC, id DESC LIMIT ?)`).run(fieldId, fieldId, MAX_CHECKS_PER_FIELD);
    return { ...snap, id: String(lastInsertRowid) };
  },
  async remove(_owner, fieldId, checkId) {
    const { changes } = db.prepare("DELETE FROM field_checks WHERE field_id = ? AND id = ?").run(fieldId, Number(checkId) || -1);
    if (!changes) throw noCheck();
  },
  async removeField(_owner, fieldId) {
    db.prepare("DELETE FROM field_checks WHERE field_id = ?").run(fieldId);
  },
};

// ---------- MongoDB (accounts on) ----------
const mongoMeta = (d: any): CheckMeta => ({ ...d.snapshot, id: String(d._id) });
const scope = (owner: string, fieldId: string) => ({ userId: owner, fieldId });

export const mongoCheckStore: CheckStore = {
  async list(owner, fieldId) {
    return (await FieldCheck.find(scope(owner, fieldId), { report: 0 }).sort({ checkedAt: -1 }).lean()).map(mongoMeta);
  },
  async get(owner, fieldId, checkId) {
    if (!mongoose.isValidObjectId(checkId)) throw noCheck();
    const d = await FieldCheck.findOne({ ...scope(owner, fieldId), _id: checkId }).lean();
    if (!d) throw noCheck();
    return { check: mongoMeta(d), report: unpackReport((d.report as any).buffer ?? d.report) };
  },
  async add(owner, fieldId, report) {
    const checkedAt = new Date(report.generatedAt);
    const dup = await FieldCheck.findOne({ ...scope(owner, fieldId), checkedAt }, { report: 0 }).lean();
    if (dup) return mongoMeta(dup);
    const doc = await FieldCheck.create({ ...scope(owner, fieldId), checkedAt, snapshot: checkSnapshot(report), report: packReport(report) });
    const keep = await FieldCheck.find(scope(owner, fieldId), { _id: 1 }).sort({ checkedAt: -1 }).limit(MAX_CHECKS_PER_FIELD).lean();
    await FieldCheck.deleteMany({ ...scope(owner, fieldId), _id: { $nin: keep.map((k) => k._id) } });
    return mongoMeta(doc.toObject());
  },
  async remove(owner, fieldId, checkId) {
    if (!mongoose.isValidObjectId(checkId)) throw noCheck();
    const { deletedCount } = await FieldCheck.deleteOne({ ...scope(owner, fieldId), _id: checkId });
    if (!deletedCount) throw noCheck();
  },
  async removeField(owner, fieldId) {
    await FieldCheck.deleteMany(scope(owner, fieldId));
  },
};
