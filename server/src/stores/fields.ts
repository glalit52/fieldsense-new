import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { db } from "../lib/cache.ts";
import { cleanRing, isArea, type Ring } from "../lib/geo.ts";
import { HttpError, notFound, type ActivityInput, type ActivityType, type SoilTestInput } from "../lib/validate.ts";
import { Field } from "../models/Field.ts";

export interface SoilTest {
  id: string; date: string; ph: number | null; organicCarbon: number | null; clay: number | null; p: number | null; k: number | null; notes: string;
}
export interface Activity {
  id: string; date: string; type: ActivityType; crop: string; product: string; quantity: number | null; unit: string;
  cost: number | null; yieldTPerHa: number | null; notes: string;
}
export interface SavedField {
  id: string; name: string; lat: number; lon: number; polygon: Ring | null; notes: string;
  summary: Record<string, unknown> | null; tests: SoilTest[]; activities: Activity[]; created: number; updated: number;
}
export interface FieldInput { name: string; lat: number; lon: number; polygon?: Ring; notes: string; summary: Record<string, unknown> | null }
export type FieldPatch = Partial<Pick<FieldInput, "name" | "notes" | "summary">>;

/** Saved fields and their lab tests, scoped to an owner. Every method throws 404 for a field the owner doesn't have. */
export interface FieldStore {
  list(owner: string): Promise<SavedField[]>;
  get(owner: string, id: string): Promise<SavedField>;
  create(owner: string, f: FieldInput): Promise<SavedField>;
  update(owner: string, id: string, patch: FieldPatch): Promise<SavedField>;
  remove(owner: string, id: string): Promise<void>;
  addTest(owner: string, id: string, t: SoilTestInput): Promise<SavedField>;
  removeTest(owner: string, id: string, testId: string): Promise<SavedField>;
  addActivity(owner: string, id: string, a: ActivityInput): Promise<SavedField>;
  removeActivity(owner: string, id: string, activityId: string): Promise<SavedField>;
}

export const MAX_FIELDS_PER_OWNER = 1000;
const tooMany = () => new HttpError(409, `You can save up to ${MAX_FIELDS_PER_OWNER} fields`);
const newestFirst = (a: { date: string; id: string }, b: { date: string; id: string }) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id);

// ---------- SQLite: local single-user mode (no accounts); owner is ignored ----------
const sqlTest = (t: any): SoilTest => ({
  id: String(t.id), date: t.date, ph: t.ph, organicCarbon: t.organic_carbon, clay: t.clay, p: t.p, k: t.k, notes: t.notes ?? "",
});
const sqlActivity = (a: any): Activity => ({
  id: String(a.id), date: a.date, type: a.type, crop: a.crop ?? "", product: a.product ?? "", quantity: a.quantity, unit: a.unit ?? "",
  cost: a.cost, yieldTPerHa: a.yield_t_per_ha, notes: a.notes ?? "",
});
/** Outlines saved before polygon validation was strict may not enclose an area; those load as a plain pin. */
function storedRing(p: unknown): Ring | null {
  if (!Array.isArray(p)) return null;
  const ring = cleanRing(p as Ring);
  return isArea(ring) ? ring : null;
}
const sqlField = (r: any, tests: SoilTest[], activities: Activity[]): SavedField => ({
  id: r.id, name: r.name, lat: r.lat, lon: r.lon, polygon: storedRing(r.polygon ? JSON.parse(r.polygon) : null), notes: r.notes ?? "",
  summary: r.summary ? JSON.parse(r.summary) : null, tests, activities, created: r.created, updated: r.updated,
});
/** Groups child rows by field id in one pass, so listing N fields is not N×M. */
const byField = <T,>(rows: any[], map: (r: any) => T) => {
  const m = new Map<string, T[]>();
  for (const r of rows) (m.get(r.field_id) ?? m.set(r.field_id, []).get(r.field_id)!).push(map(r));
  return m;
};

export const sqliteFieldStore: FieldStore = {
  async list() {
    const tests = byField(db.prepare("SELECT * FROM soil_tests ORDER BY date DESC, id DESC").all() as any[], sqlTest);
    const acts = byField(db.prepare("SELECT * FROM activities ORDER BY date DESC, id DESC").all() as any[], sqlActivity);
    return (db.prepare("SELECT * FROM fields ORDER BY updated DESC").all() as any[])
      .map((r) => sqlField(r, tests.get(r.id) ?? [], acts.get(r.id) ?? []));
  },
  async get(_owner, id) {
    const r = db.prepare("SELECT * FROM fields WHERE id = ?").get(id);
    if (!r) throw notFound("No such field");
    return sqlField(r,
      (db.prepare("SELECT * FROM soil_tests WHERE field_id = ? ORDER BY date DESC, id DESC").all(id) as any[]).map(sqlTest),
      (db.prepare("SELECT * FROM activities WHERE field_id = ? ORDER BY date DESC, id DESC").all(id) as any[]).map(sqlActivity));
  },
  async create(owner, f) {
    if (((db.prepare("SELECT COUNT(*) AS c FROM fields").get() as any).c ?? 0) >= MAX_FIELDS_PER_OWNER) throw tooMany();
    const id = randomUUID(), now = Date.now();
    db.prepare("INSERT INTO fields (id, name, lat, lon, polygon, notes, created, updated, summary) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, f.name, f.lat, f.lon, f.polygon ? JSON.stringify(f.polygon) : null, f.notes, now, now, f.summary ? JSON.stringify(f.summary) : null);
    return this.get(owner, id);
  },
  async update(owner, id, p) {
    const cur = await this.get(owner, id);
    db.prepare("UPDATE fields SET name = ?, notes = ?, summary = ?, updated = ? WHERE id = ?")
      .run(p.name ?? cur.name, p.notes ?? cur.notes, JSON.stringify(p.summary !== undefined ? p.summary : cur.summary), Date.now(), id);
    return this.get(owner, id);
  },
  async remove(owner, id) {
    await this.get(owner, id);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM soil_tests WHERE field_id = ?").run(id);
      db.prepare("DELETE FROM activities WHERE field_id = ?").run(id);
      db.prepare("DELETE FROM fields WHERE id = ?").run(id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
  async addTest(owner, id, t) {
    await this.get(owner, id);
    db.prepare("INSERT INTO soil_tests (field_id, date, ph, organic_carbon, clay, p, k, notes) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, t.date, t.ph ?? null, t.organicCarbon ?? null, t.clay ?? null, t.p ?? null, t.k ?? null, t.notes);
    db.prepare("UPDATE fields SET updated = ? WHERE id = ?").run(Date.now(), id);
    return this.get(owner, id);
  },
  async removeTest(owner, id, testId) {
    await this.get(owner, id);
    db.prepare("DELETE FROM soil_tests WHERE field_id = ? AND id = ?").run(id, Number(testId) || -1);
    return this.get(owner, id);
  },
  async addActivity(owner, id, a) {
    await this.get(owner, id);
    db.prepare("INSERT INTO activities (field_id, date, type, crop, product, quantity, unit, cost, yield_t_per_ha, notes) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, a.date, a.type, a.crop, a.product, a.quantity ?? null, a.unit, a.cost ?? null, a.yieldTPerHa ?? null, a.notes);
    db.prepare("UPDATE fields SET updated = ? WHERE id = ?").run(Date.now(), id);
    return this.get(owner, id);
  },
  async removeActivity(owner, id, activityId) {
    await this.get(owner, id);
    db.prepare("DELETE FROM activities WHERE field_id = ? AND id = ?").run(id, Number(activityId) || -1);
    return this.get(owner, id);
  },
};

// ---------- MongoDB: per-user fields when accounts are enabled ----------
const mongoField = (f: any): SavedField => ({
  id: String(f._id), name: f.name, lat: f.lat, lon: f.lon, polygon: storedRing(f.polygon), notes: f.notes ?? "",
  summary: f.summary ?? null,
  tests: (f.tests ?? []).map((t: any) => ({
    id: String(t._id), date: t.date, ph: t.ph ?? null, organicCarbon: t.organicCarbon ?? null, clay: t.clay ?? null, p: t.p ?? null, k: t.k ?? null, notes: t.notes ?? "",
  })).sort(newestFirst),
  activities: (f.activities ?? []).map((a: any) => ({
    id: String(a._id), date: a.date, type: a.type, crop: a.crop ?? "", product: a.product ?? "", quantity: a.quantity ?? null, unit: a.unit ?? "",
    cost: a.cost ?? null, yieldTPerHa: a.yieldTPerHa ?? null, notes: a.notes ?? "",
  })).sort(newestFirst),
  created: new Date(f.createdAt).getTime(), updated: new Date(f.updatedAt).getTime(),
});

/** Filter for one owner's field; a malformed id can never match, so it is a 404 rather than a CastError. */
function own(owner: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound("No such field");
  return { _id: id, userId: owner };
}

async function mongoUpdate(owner: string, id: string, update: mongoose.UpdateQuery<unknown>) {
  const doc = await Field.findOneAndUpdate(own(owner, id), update, { returnDocument: "after", runValidators: true }).lean();
  if (!doc) throw notFound("No such field");
  return mongoField(doc);
}

export const mongoFieldStore: FieldStore = {
  async list(owner) {
    return (await Field.find({ userId: owner }).sort({ updatedAt: -1 }).lean()).map(mongoField);
  },
  async get(owner, id) {
    const doc = await Field.findOne(own(owner, id)).lean();
    if (!doc) throw notFound("No such field");
    return mongoField(doc);
  },
  async create(owner, f) {
    if (await Field.countDocuments({ userId: owner }) >= MAX_FIELDS_PER_OWNER) throw tooMany();
    const doc = await Field.create({ userId: owner, ...f, polygon: f.polygon ?? undefined, tests: [], activities: [] });
    return mongoField(doc.toObject());
  },
  update: (owner, id, p) => mongoUpdate(owner, id, { $set: p }),
  async remove(owner, id) {
    const { deletedCount } = await Field.deleteOne(own(owner, id));
    if (!deletedCount) throw notFound("No such field");
  },
  addTest: (owner, id, t) => mongoUpdate(owner, id, { $push: { tests: t } }),
  removeTest(owner, id, testId) {
    if (!mongoose.isValidObjectId(testId)) throw notFound("No such lab test");
    return mongoUpdate(owner, id, { $pull: { tests: { _id: testId } } });
  },
  addActivity: (owner, id, a) => mongoUpdate(owner, id, { $push: { activities: a } }),
  removeActivity(owner, id, activityId) {
    if (!mongoose.isValidObjectId(activityId)) throw notFound("No such activity");
    return mongoUpdate(owner, id, { $pull: { activities: { _id: activityId } } });
  },
};
