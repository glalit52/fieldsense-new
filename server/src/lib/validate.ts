import { CROPS } from "../engine/crops.ts";
import type { ReportInput } from "../engine/report.ts";
import { centroid, cleanRing, isArea, type Ring } from "./geo.ts";

/** An error with an HTTP status; the app error handler sends `message` to the client. */
export class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);

export function num(v: unknown, name: string, min: number, max: number): number {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${name} must be a number between ${min} and ${max}`);
  return n;
}

/** Optional number: null, undefined and "" mean "not given". */
export function optNum(v: unknown, name: string, min: number, max: number): number | undefined {
  return v == null || v === "" ? undefined : num(v, name, min, max);
}

export function str(v: unknown, max: number, fallback = ""): string {
  return v == null ? fallback : String(v).trim().slice(0, max);
}

export function parseRing(p: unknown): Ring | undefined {
  if (p == null) return undefined;
  // 501 allows a 500-corner outline sent GeoJSON-style with its first corner repeated at the end.
  if (!Array.isArray(p) || p.length < 3 || p.length > 501) throw badRequest("polygon must be 3–500 [lon, lat] pairs");
  const ring = cleanRing(p.map((pt: any) => [num(pt?.[0], "polygon lon", -180, 180), num(pt?.[1], "polygon lat", -90, 90)] as [number, number]));
  if (!isArea(ring)) throw badRequest("polygon must outline an area: at least 3 different corners that are not all in a line");
  return ring;
}

/** A point or outline: the outline's centroid wins over lat/lon when both are given. */
export function parseLocation(b: any): { lat: number; lon: number; polygon?: Ring } {
  const polygon = parseRing(b?.polygon);
  const [lon, lat] = polygon ? centroid(polygon) : [b?.lon, b?.lat];
  return { lat: num(lat, "lat", -60, 75), lon: num(lon, "lon", -180, 180), polygon };
}

export function parseInput(b: any): ReportInput {
  const lab = b?.lab ? {
    ph: optNum(b.lab.ph, "lab pH", 3, 10.5),
    organicCarbon: optNum(b.lab.organicCarbon, "organic carbon %", 0, 30),
    clay: optNum(b.lab.clay, "clay %", 0, 100),
  } : undefined;
  return {
    ...parseLocation(b),
    lab: lab && Object.values(lab).some((v) => v != null) ? lab : undefined,
    cropId: typeof b?.cropId === "string" && CROPS.some((c) => c.id === b.cropId) ? b.cropId : undefined,
    limeTargetPh: optNum(b?.limeTargetPh, "limeTargetPh", 5, 7.5),
    limeDepthCm: optNum(b?.limeDepthCm, "limeDepthCm", 5, 40),
  };
}

export interface SoilTestInput { date: string; ph?: number; organicCarbon?: number; clay?: number; p?: number; k?: number; notes: string }

export function parseSoilTest(b: any): SoilTestInput {
  const date = str(b?.date, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("date must be YYYY-MM-DD");
  const t = {
    date,
    ph: optNum(b?.ph, "pH", 3, 10.5),
    organicCarbon: optNum(b?.organicCarbon, "organic carbon %", 0, 30),
    clay: optNum(b?.clay, "clay %", 0, 100),
    p: optNum(b?.p, "P", 0, 1000),
    k: optNum(b?.k, "K", 0, 5000),
    notes: str(b?.notes, 1000),
  };
  if ([t.ph, t.organicCarbon, t.clay, t.p, t.k].every((v) => v == null)) throw badRequest("Enter at least one lab value");
  return t;
}

/** Farm operations recorded against a field: the season's journal, with costs and harvested yield. */
export const ACTIVITY_TYPES = ["sowing", "fertiliser", "spraying", "irrigation", "tillage", "scouting", "harvest", "other"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export interface ActivityInput {
  date: string; type: ActivityType; crop: string; product: string; quantity?: number; unit: string; cost?: number; yieldTPerHa?: number; notes: string;
}

export function parseActivity(b: any): ActivityInput {
  const date = str(b?.date, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("date must be YYYY-MM-DD");
  const type = str(b?.type, 20).toLowerCase() as ActivityType;
  if (!ACTIVITY_TYPES.includes(type)) throw badRequest(`type must be one of ${ACTIVITY_TYPES.join(", ")}`);
  return {
    date, type,
    crop: str(b?.crop, 80),
    product: str(b?.product, 120),
    quantity: optNum(b?.quantity, "quantity", 0, 1e7),
    unit: str(b?.unit, 20),
    cost: optNum(b?.cost, "cost", 0, 1e9),
    yieldTPerHa: type === "harvest" ? optNum(b?.yieldTPerHa, "yield t/ha", 0, 200) : undefined,
    notes: str(b?.notes, 1000),
  };
}
