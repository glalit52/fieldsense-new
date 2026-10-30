import { randomUUID } from "node:crypto";
import zlib from "node:zlib";
import type { Report } from "../engine/report.ts";
import { DAY, getCache, putCache } from "./cache.ts";
import { badRequest } from "./validate.ts";

/** Reports are kept a day so Agris follow-ups, PDFs and archiving survive restarts and redeploys. */
const REPORT_TTL = DAY;

export function storeReport(r: Report) {
  const id = randomUUID();
  putCache(`report-id:${id}`, r, REPORT_TTL);
  return id;
}

export const loadReport = (id: string) => (/^[0-9a-f-]{36}$/.test(id) ? getCache<Report>(`report-id:${id}`) : undefined);

/** The report behind a request's `reportId`, or a 400 that tells the user to run the check again. */
export function requireReport(id: unknown): Report {
  const r = loadReport(String(id ?? ""));
  if (!r) throw badRequest("This report has expired. Run the field check again.");
  return r;
}

/** Archived reports are stored gzipped: a full report is ~150 KB of JSON and compresses about 6×. */
export const packReport = (r: Report) => zlib.gzipSync(JSON.stringify(r));
export const unpackReport = (b: Buffer | Uint8Array): Report => JSON.parse(zlib.gunzipSync(b).toString("utf8"));

/** Headline numbers kept with a saved field for the fields list (same shape the web app has always saved). */
export const fieldSummary = (r: Report) => ({ ...r.summary, headline: r.headline, checkedAt: r.generatedAt, areaHa: r.location.areaHa ?? null });

/** What the history view needs from one check, without unpacking the whole report. */
export function checkSnapshot(r: Report) {
  const ph = r.soil.topsoil.ph;
  return {
    checkedAt: r.generatedAt,
    reportVersion: r.version,
    headline: r.headline,
    soilPh: ph?.p50 ?? null,
    organicCarbonPct: r.soil.topsoil.soc?.p50 != null ? r.soil.topsoil.soc.p50 / 10 : null,
    labUsed: Boolean(r.soil.labOverride),
    rainPerYear: r.climate.normals.rain,
    lime: { call: r.lime.call, rateTPerHa: r.lime.rateTPerHa.mid },
    topCrops: r.crops.slice(0, 8).map((c: any) => ({ id: c.id, name: c.name, score: c.score, median: c.yieldTPerHa.median })),
    risks: r.risks.map((x: any) => ({ id: x.id, label: x.label, level: x.level })),
    landChangePct: r.land?.changePct ?? null,
    selectedCrop: r.selectedCrop,
  };
}
export type CheckSnapshot = ReturnType<typeof checkSnapshot>;
