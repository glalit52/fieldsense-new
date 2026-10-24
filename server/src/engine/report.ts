import { cached, cell, DAY } from "../lib/cache.ts";
import { areaHa, centroid, type Ring } from "../lib/geo.ts";
import * as gee from "../providers/gee.ts";
import { reverse } from "../providers/geocode.ts";
import { modisNdviOrnl } from "../providers/modis.ts";
import { powerDaily } from "../providers/nasapower.ts";
import { archive, climateProjection, elevationGrid, forecast, seasonal } from "../providers/openmeteo.ts";
import { climateSoilEstimate, soilGridsRest, type SoilProfile } from "../providers/soilgrids.ts";
import { inUS, ssurgo } from "../providers/ssurgo.ts";
import { byYear, rainAgreement, summariseClimate } from "./climate.ts";
import { CROPS, cropById } from "./crops.ts";
import { analyseLandHealth } from "./landhealth.ts";
import { limeAdvice } from "./lime.ts";
import { operations } from "./operations.ts";
import { assessRisks } from "./risk.ts";
import { assessCrop, perturb, prepare, type CropAssessment } from "./simulate.ts";
import { summariseSoil, type LabTest } from "./soil.ts";
import { clamp, mean, round } from "./stats.ts";

export interface ReportInput {
  lat: number; lon: number; polygon?: Ring; lab?: LabTest; cropId?: string; limeTargetPh?: number; limeDepthCm?: number;
}

export const REPORT_VERSION = 11;
const HIST_START = 1991; // 35 years of daily reanalysis

type Step<T> = { ok: true; value: T; ms: number } | { ok: false; error: string; ms: number };
async function step<T>(fn: () => Promise<T>): Promise<Step<T>> {
  const t = Date.now();
  try { return { ok: true, value: await fn(), ms: Date.now() - t }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t }; }
}

function terrainFromGrid(g: { step: number; values: number[] }, lat: number) {
  const v = g.values, at = (r: number, c: number) => v[(r + 2) * 5 + (c + 2)];
  const dx = g.step * 111_320 * Math.cos((lat * Math.PI) / 180), dy = g.step * 110_540;
  const dzdx = (at(0, 1) - at(0, -1)) / (2 * dx), dzdy = (at(1, 0) - at(-1, 0)) / (2 * dy);
  const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  const aspect = (Math.atan2(-dzdx, dzdy) * 180) / Math.PI;
  const tpi = at(0, 0) - mean(v);
  return { elevation: at(0, 0), slopeDeg, aspectDeg: (aspect + 360) % 360, tpi, relief: Math.max(...v) - Math.min(...v) };
}

export async function buildReport(input: ReportInput, onProgress?: (stage: string) => void) {
  const { lat, lon } = input;
  const ring: Ring = input.polygon && input.polygon.length >= 3 ? input.polygon : [[lon, lat]];
  const t0 = Date.now();
  const progress = (s: string) => onProgress?.(s);

  progress("Reading weather, soil, terrain and satellite records");
  const useGee = gee.geeEnabled();
  const [arch, power, soilRest, elev, place, fc, seas, cmip, ctx] = await Promise.all([
    step(() => archive(lat, lon, HIST_START)),
    step(() => powerDaily(lat, lon, 1981)),
    // US fields: field-scale SSURGO survey first; everywhere else (or on failure) SoilGrids.
    inUS(lat, lon) ? step(() => ssurgo(lat, lon)).then((r) => (r.ok ? r : step(() => soilGridsRest(lat, lon)))) : step(() => soilGridsRest(lat, lon)),
    step(() => elevationGrid(lat, lon)),
    step(() => reverse(lat, lon)),
    step(() => forecast(lat, lon)),
    step(() => seasonal(lat, lon)),
    step(() => climateProjection(lat, lon)),
    useGee ? step(() => gee.geeLandContext(ring, lat, lon)) : Promise.resolve(null),
  ]);
  if (!arch.ok) throw new Error(`Weather history unavailable: ${arch.error}`);
  const weather = arch.value;

  // ---- Soil: SoilGrids REST → SoilGrids on Earth Engine → climate estimate ----
  progress("Estimating soil");
  let profile: SoilProfile;
  const soilErrors: string[] = [];
  if (soilRest.ok) profile = soilRest.value;
  else {
    soilErrors.push(soilRest.error);
    const g = useGee ? await step(() => gee.geeSoilGrids(lat, lon)) : null;
    if (g?.ok) profile = g.value;
    else {
      if (g && !g.ok) soilErrors.push(g.error);
      const ys = byYear(weather);
      const ai = mean(ys.map(({ idx }) => idx.reduce((a, i) => a + (weather.rain[i] || 0), 0))) /
        mean(ys.map(({ idx }) => idx.reduce((a, i) => a + (weather.et0[i] || 0), 0)));
      profile = climateSoilEstimate(ai, mean(weather.tmean));
    }
  }
  const terrain = elev.ok ? terrainFromGrid(elev.value, lat) : null;
  const context = ctx && ctx.ok ? ctx.value : null;
  const soil = summariseSoil(profile, input.lab, context?.twi ?? null);
  const crop = input.cropId ? cropById(input.cropId) : undefined;

  // ---- Climate (with multi-source rainfall cross-check and CHIRPS bias correction) ----
  progress("Replaying 35 years of weather");
  const climate = summariseClimate(weather, lat);
  const others: { source: string; annual: { year: number; rain: number }[] }[] = [];
  if (power.ok) others.push({ source: "NASA POWER (MERRA-2)", annual: byYear(power.value as any).map(({ year, idx }) => ({ year, rain: idx.reduce((a, i) => a + (power.value.rain[i] || 0), 0) })) });
  if (context?.chirpsAnnual?.length) others.push({ source: "CHIRPS (gauge-blended satellite)", annual: context.chirpsAnnual });
  climate.agreement = rainAgreement(climate.years, others) as any;
  if (power.ok) climate.sources.push("NASA POWER daily agro-climatology (1981–)");
  let rainFactor = 1;
  const chirps = climate.agreement?.find((a) => a.source.startsWith("CHIRPS"));
  if (chirps && Number.isFinite(chirps.differencePct)) {
    rainFactor = clamp(1 + chirps.differencePct / 100, 0.6, 1.5);
    climate.sources.push(`CHIRPS via Earth Engine (rain bias-corrected ×${rainFactor.toFixed(2)})`);
  }

  // ---- Crops: daily water balance for 67 crops × 37 sowing dates × 30 seasons ----
  progress("Scoring 67 crops season by season");
  const prepared = prepare(weather, soil, lat, rainFactor);
  const crops = CROPS.map((c) => assessCrop(prepared, c, soil, 30, soil.confidence)).sort((a, b) => b.score - a.score);

  // ---- Future climate (CMIP6 delta change to ~2045) for the top crops ----
  progress("Projecting to 2045 with CMIP6 models");
  let future: any = null;
  if (cmip.ok && Object.keys(cmip.value).length) {
    const models = Object.values(cmip.value);
    const per = (rows: any[], a: number, b: number, k: "tmax" | "tmin" | "rain") => mean(rows.filter((r) => r.year >= a && r.year <= b).map((r) => r[k]));
    const dT = mean(models.map((m) => (per(m, 2040, 2049, "tmax") + per(m, 2040, 2049, "tmin")) / 2 - (per(m, 1995, 2014, "tmax") + per(m, 1995, 2014, "tmin")) / 2));
    const rr = mean(models.map((m) => per(m, 2040, 2049, "rain") / per(m, 1995, 2014, "rain")));
    const pf = prepare(perturb(weather, dT, rr), soil, lat, rainFactor);
    const top = crops.slice(0, 15);
    future = {
      horizon: "2040–2049 vs 1995–2014", models: Object.keys(cmip.value), warmingC: dT, rainChangePct: (rr - 1) * 100,
      crops: top.map((c) => {
        const f = assessCrop(pf, cropById(c.id)!, soil, 30, soil.confidence);
        return { id: c.id, name: c.name, now: c.score, future: f.score, change: f.score - c.score };
      }),
    };
  }

  // ---- Land health: Earth Engine MODIS (field mean) → ORNL MODIS (pixel). ORNL is slow on a cold cache,
  // so the report waits briefly and otherwise lets the client fetch /api/land when it is ready. ----
  progress("Tracing land health since 2000");
  let land: any = null, landError: string | null = null, landPending = false;
  const lh = useGee ? await step(() => gee.geeModisNdvi(ring, lat, lon)) : null;
  if (lh?.ok && lh.value.length > 50) land = analyseLandHealth(lh.value, "MODIS MOD13Q1 250 m field mean (Google Earth Engine)");
  else {
    const pending = modisNdviOrnl(lat, lon);
    pending.catch(() => {});
    const o = await Promise.race([step(() => pending), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    if (o === null) landPending = true;
    else if (o.ok) land = analyseLandHealth(o.value, "MODIS MOD13Q1 250 m pixel (NASA ORNL DAAC)");
    else landError = o.error;
  }

  const ops = fc.ok ? operations(fc.value, soil) : null;
  const lime = limeAdvice(soil, { targetPh: input.limeTargetPh ?? crop?.limeTarget ?? cropById(crops[0].id)?.limeTarget, depthCm: input.limeDepthCm });
  const risks = assessRisks(climate, soil, { slopeDeg: context?.slopeDeg ?? terrain?.slopeDeg, twi: context?.twi, tpi: terrain?.tpi, waterOccurrence: context?.maxWaterOccurrence });

  const top = crops.find((c) => c.group !== "Forage") ?? crops[0];
  const pick = crop ? crops.find((c) => c.id === crop.id)! : top;
  const headline = headlineText(pick, lime, crop != null);
  const summary = {
    soilPh: soil.topsoil.ph?.p50 ?? null, rainPerYear: climate.normals.rain,
    topCrop: top.name, topCropYield: pick.yieldTPerHa.good, landChangePct: land?.changePct ?? null,
    limeCall: lime.call,
  };

  return {
    version: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    location: {
      lat, lon, polygon: input.polygon ?? null, areaHa: input.polygon && input.polygon.length >= 3 ? areaHa(input.polygon) : null,
      ...(place.ok ? place.value : {}), elevation: weather.elevation, timezone: weather.timezone,
      centroid: input.polygon && input.polygon.length >= 3 ? centroid(input.polygon) : [lon, lat],
    },
    headline, summary,
    soil: { ...soil, errors: soilErrors },
    lime, climate: { ...climate, years: climate.years.map(roundYear), recent: climate.recent.map(roundYear) },
    crops: crops.map(roundCrop), selectedCrop: crop?.id ?? null,
    future, land, landError, landPending,
    terrain: terrain && { ...terrain, ...(context ? { twi: context.twi, heightAboveDrainage: context.heightAboveDrainage, meritSlopeDeg: context.slopeDeg } : {}) },
    landCover: context?.landCover ?? null, waterOccurrence: context?.maxWaterOccurrence ?? null,
    risks, operations: ops, seasonal: seas.ok ? seas.value : null,
    sources: {
      weather: "ERA5 reanalysis (Open-Meteo), 1991–present", forecast: fc.ok ? "Open-Meteo best-match NWP (ECMWF / GFS / ICON)" : `unavailable: ${fc.error}`,
      seasonal: seas.ok ? "ECMWF SEAS5 51-member ensemble" : `unavailable: ${seas.error}`,
      climateProjection: cmip.ok ? "CMIP6 HighResMIP (Open-Meteo climate API)" : `unavailable: ${cmip.error}`,
      soil: soil.source, terrain: elev.ok ? "Copernicus GLO-90 DEM (Open-Meteo)" + (context ? " + MERIT Hydro (Earth Engine)" : "") : "unavailable",
      land: land?.source ?? (landPending ? "loading (MODIS via NASA ORNL DAAC)" : `unavailable: ${landError}`), earthEngine: useGee ? (ctx?.ok ? "connected" : `error: ${ctx && !ctx.ok ? ctx.error : ""}`) : "not configured",
      nasaPower: power.ok ? "ok" : `unavailable: ${power.error}`,
    },
    timings: { totalMs: Date.now() - t0, archive: arch.ms, soil: soilRest.ms, power: power.ms },
  };
}

function headlineText(c: CropAssessment, lime: ReturnType<typeof limeAdvice>, chosen: boolean) {
  const first = c.score >= 60 ? `${c.name} ${chosen ? "suits this ground" : "is the top pick"}.` : c.score >= 35 ? `${c.name} is the best option, with caveats.` : `Tough ground: even ${c.name} struggles here.`;
  const second = lime.call === "None needed" ? "No lime needed." : lime.call === "Borderline" ? "Lime is borderline. Test first." : `Lime likely needed (~${lime.rateTPerHa.mid.toFixed(1)} t/ha).`;
  return `${first} ${second}`;
}

const roundYear = (y: any) => Object.fromEntries(Object.entries(y).map(([k, v]) => [k, typeof v === "number" ? round(v, 1) : v]));
function roundCrop(c: CropAssessment) {
  return {
    ...c,
    yieldTPerHa: { poor: round(c.yieldTPerHa.poor, 2), median: round(c.yieldTPerHa.median, 2), good: round(c.yieldTPerHa.good, 2) },
    irrigatedYieldTPerHa: round(c.irrigatedYieldTPerHa, 2), irrigationMm: round(c.irrigationMm, 0),
    factors: Object.fromEntries(Object.entries(c.factors).map(([k, v]) => [k, round(v, 2)])),
  };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;

export function cachedReport(input: ReportInput, onProgress?: (s: string) => void) {
  const k = `report:v${REPORT_VERSION}:${cell(input.lat, input.lon, 4)}:${JSON.stringify(input.polygon ?? null)}:${JSON.stringify(input.lab ?? null)}:${input.cropId ?? ""}:${input.limeTargetPh ?? ""}:${input.limeDepthCm ?? ""}:${new Date().toISOString().slice(0, 10)}`;
  return cached(k, DAY / 4, () => buildReport(input, onProgress));
}

export async function landHealth(lat: number, lon: number, polygon?: Ring) {
  const ring: Ring = polygon && polygon.length >= 3 ? polygon : [[lon, lat]];
  if (gee.geeEnabled()) {
    const g = await step(() => gee.geeModisNdvi(ring, lat, lon));
    if (g.ok && g.value.length > 50) return analyseLandHealth(g.value, "MODIS MOD13Q1 250 m field mean (Google Earth Engine)");
  }
  return analyseLandHealth(await modisNdviOrnl(lat, lon), "MODIS MOD13Q1 250 m pixel (NASA ORNL DAAC)");
}
