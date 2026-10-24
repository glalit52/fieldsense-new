import type { DailySeries } from "../providers/openmeteo.ts";
import type { Crop } from "./crops.ts";
import type { SoilSummary } from "./soil.ts";
import { clamp, mean, quantile, trapezoid } from "./stats.ts";

export interface Prepared {
  n: number; time: string[]; year: Int16Array; doy: Int16Array;
  tmax: Float64Array; tmin: Float64Array; tmean: Float64Array; rain: Float64Array; et0: Float64Array;
  week: Float64Array;   // 7-day forward mean temperature (sowing condition)
  fallow: Float64Array; // fraction of 1 m profile water store full under fallow, start of day
  awc: number; south: boolean; drainage: SoilSummary["drainage"];
  tew: number; rew: number; // FAO-56 evaporable water of the 10 cm surface layer (mm)
}

const fix = (a: number[], fallback: number) => Float64Array.from(a, (v) => (Number.isFinite(v) ? v : fallback));

export function prepare(s: DailySeries, soil: SoilSummary, lat: number, rainFactor = 1): Prepared {
  const n = s.time.length;
  const tmax = fix(s.tmax, 20), tmin = fix(s.tmin, 10);
  const tmean = Float64Array.from(s.tmean, (v, i) => (Number.isFinite(v) ? v : (tmax[i] + tmin[i]) / 2));
  const rain = Float64Array.from(s.rain, (v) => (Number.isFinite(v) ? v * rainFactor : 0));
  const et0 = fix(s.et0, 3);
  const year = new Int16Array(n), doy = new Int16Array(n);
  s.time.forEach((t, i) => {
    const d = new Date(t + "T00:00:00Z");
    year[i] = d.getUTCFullYear();
    doy[i] = Math.floor((d.getTime() - Date.UTC(year[i], 0, 1)) / 86_400_000);
  });
  const week = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { acc += tmean[i]; if (i + 7 < n) acc -= tmean[i + 7]; week[i] = acc / Math.min(7, n - i); }

  // FAO-56 surface layer: total / readily evaporable water of the top 10 cm.
  const clay = soil.topsoil.clay?.p50 ?? 25, sand = soil.topsoil.sand?.p50 ?? 40;
  const tew = clamp(1000 * (soil.fieldCapacity - 0.5 * soil.wiltingPoint) * 0.1, 8, 40);
  const rew = sand > 70 ? 5 : clay > 35 ? 10 : 8;

  // Fallow water store over 1 m: rain recharges; evaporation only dries the surface layer
  // (stage 1 then falling rate), plus a slow loss to weeds / vapour flux from depth.
  const taw = soil.awcMmPerM;
  const fallow = new Float64Array(n);
  let w = taw * 0.4, de = tew;
  for (let i = 0; i < n; i++) {
    fallow[i] = w / taw;
    const r = effectiveRain(rain[i], soil);
    w += r; de = Math.max(0, de - r);
    const kr = de < rew ? 1 : Math.max(0, (tew - de) / (tew - rew));
    const es = Math.min(kr * 1.1 * et0[i] * 0.8, w); // 0.8: partial stubble cover
    de = Math.min(tew, de + es);
    w -= es + 0.04 * et0[i] * (w / taw);
    w = clamp(w, 0, taw);
  }
  return { n, time: s.time, year, doy, tmax, tmin, tmean, rain, et0, week, fallow, awc: taw, south: lat < 0, drainage: soil.drainage, tew, rew };
}

/** Rain minus runoff (simple curve-number-like loss on heavy falls, larger on clay). */
function effectiveRain(r: number, soil: SoilSummary) {
  if (r <= 15) return r;
  const clay = soil.topsoil.clay?.p50 ?? 25;
  const loss = clamp(0.15 + clay / 200, 0.1, 0.45);
  return 15 + (r - 15) * (1 - loss);
}

export interface SeasonResult {
  ratio: number; water: number; temp: number; frost: number; heat: number; wet: number; chill: number;
  matured: boolean; days: number; tseason: number; waterIrrigated: number; disease: number; etc: number; eta: number; irrigation: number; rainInSeason: number;
}

function season(p: Prepared, c: Crop, start: number, soil: SoilSummary, maturity = 1): SeasonResult | null {
  const taw = p.awc * c.root;
  let dr = taw * (1 - p.fallow[start]);
  let de = p.tew * 0.5, tPot = 0;
  let gdd = 0, etcSum = 0, etaSum = 0, tAct = 0, rainSum = 0, frostHits = 0, heatHits = 0, wetDays = 0, killed = false;
  let tAcc = 0, tN = 0, d = 0, stage = 0, chillF = 1, tSum = 0;
  const perennial = c.perennial;
  const maxDays = perennial ? 365 : 330;
  const req = c.gdd * maturity;

  if (perennial && c.chill > 0) {
    // Chill accumulated in the ~150 days of winter before the season starts.
    let ch = 0;
    for (let i = Math.max(0, start - 150); i < start; i++) {
      const tn = p.tmin[i], tx = p.tmax[i];
      ch += tx <= 7.2 ? 24 : tn >= 7.2 ? 0 : (24 * (7.2 - tn)) / (tx - tn);
    }
    chillF = clamp(ch / c.chill, 0.2, 1) ** 0.7;
  }

  for (let i = start; d < maxDays; i++, d++) {
    if (i >= p.n) return null; // ran off the end of the record
    const tm = p.tmean[i];
    tSum += tm;
    let kc: number;
    if (perennial) {
      stage = d / 365;
      const active = tm > c.tbase;
      kc = active ? c.kcMid : Math.min(c.kcIni, 0.3);
      if (active) { tAcc += trapezoid(tm, c.tbase - 2, c.toptLo, c.toptHi, c.tmax + 2); tN++; }
      if (p.tmin[i] < c.vegFrost) killed = true;
      if (d >= 20 && d <= 80 && p.tmin[i] < c.flowerFrost) frostHits++;
      if (p.tmax[i] > c.heat) heatHits += 0.35; // trees buffer heat better than annual flowers
    } else {
      gdd += Math.max(0, Math.min(tm, c.toptHi) - c.tbase);
      stage = gdd / req;
      kc = stage < 0.15 ? c.kcIni : stage < 0.4 ? c.kcIni + ((stage - 0.15) / 0.25) * (c.kcMid - c.kcIni)
        : stage < 0.75 ? c.kcMid : c.kcMid + ((Math.min(stage, 1) - 0.75) / 0.25) * (c.kcEnd - c.kcMid);
      // Cool-season crops: cold days mostly slow development (thermal time handles it). Warm-season (C4 / tropical)
      // crops also lose photosynthetic capacity when cool, so they take the full cold-side penalty.
      const tf = trapezoid(tm, c.tbase, c.toptLo, c.toptHi, c.tmax);
      tAcc += tm < c.toptLo ? (c.tbase >= 10 ? 0.5 + 0.5 * tf : 0.85 + 0.15 * tf) : tf;
      tN++;
      if (p.tmin[i] < c.vegFrost && stage < 0.9) killed = true;
      if (stage >= 0.5 && stage <= 0.72) {
        if (p.tmin[i] < c.flowerFrost) frostHits++;
        if (p.tmax[i] > c.heat) heatHits++;
      }
    }
    // FAO-56 dual coefficient: basal transpiration (Kcb) + soil evaporation (Ke) from the wet surface.
    const kcb = Math.max(0.15, kc - (kc === c.kcIni ? kc - 0.15 : 0.05));
    const cover = perennial ? (tm > c.tbase ? 0.7 : 0.4) : clamp((kcb - 0.15) / Math.max(0.1, c.kcMid - 0.2));
    const rEff = effectiveRain(p.rain[i], soil);
    rainSum += p.rain[i];
    de = Math.max(0, de - rEff);
    const kr = de < p.rew ? 1 : Math.max(0, (p.tew - de) / (p.tew - p.rew));
    const ke = Math.min(kr * Math.max(0, 1.2 - kcb), (1 - cover) * 1.2);
    const es = ke * p.et0[i];
    de = Math.min(p.tew, de + es);
    const tp = kcb * p.et0[i];
    const pDep = clamp(0.5 + 0.04 * (5 - tp), 0.1, 0.8);
    const raw = pDep * taw;
    const ks = dr > raw ? Math.max(0, (taw - dr) / (taw - raw)) : 1;
    const ta = ks * tp;
    dr = dr - rEff + ta + es;
    if (dr < 0) {
      if (-dr > 8 && p.drainage !== "excessive" && p.drainage !== "well") wetDays += p.drainage === "poor" ? 1 : p.drainage === "imperfect" ? 0.6 : 0.3;
      dr = 0;
    }
    dr = Math.min(dr, taw);
    etcSum += tp + es; etaSum += ta + es; tPot += tp; tAct += ta;
    if (!perennial && stage >= 1) break;
  }

  const matured = perennial || stage >= 1;
  // Relative stress (FAO-33 Ky) and absolute water productivity cap, whichever binds.
  const water = Math.max(0, Math.min(1 - c.ky * (1 - tAct / Math.max(1, tPot)), (c.wpT * tAct) / (c.yMax * 1000)));
  const waterIrrigated = Math.min(1, (c.wpT * tPot) / (c.yMax * 1000));
  const temp = tN ? tAcc / tN : 0;
  const frost = killed ? 0.1 : Math.max(0.3, 1 - 0.12 * frostHits);
  const heat = Math.max(0.4, 1 - 0.06 * heatHits);
  const wet = 1 - (1 - c.wlTol) * Math.min(1, wetDays / 25) * 0.7;
  const matF = matured ? 1 : stage > 0.85 ? stage ** 4 : 0.05;
  // Longer-season cultivars build more biomass; short ones give some up.
  const cultivar = perennial ? 1 : maturity < 1 ? 0.9 : maturity > 1 ? 1.05 : 1;
  // Wet-season foliar disease, scaled by in-season rain (per 120 days for perennials' year).
  const rainNorm = perennial ? rainSum * (120 / 365) : rainSum;
  const disease = 1 - c.humidSens * clamp((rainNorm - 300) / 400);
  return {
    ratio: Math.min(1, water * temp * frost * heat * wet * chillF * matF * cultivar * disease),
    disease,
    water, temp, frost, heat, wet, chill: chillF, matured, days: d, waterIrrigated, tseason: tSum / Math.max(1, d),
    etc: etcSum, eta: etaSum, irrigation: Math.max(0, tPot - tAct) / 0.8, rainInSeason: rainSum,
  };
}

/** Exposed for diagnostics/tests. */
export const seasonDiag = (p: Prepared, c: Crop, start: number, soil: SoilSummary, maturity = 1) => season(p, c, start, soil, maturity);

export function soilFactors(c: Crop, soil: SoilSummary) {
  const ph = soil.topsoil.ph?.p50 ?? 6.5;
  const [mn, lo, hi, mx] = c.ph;
  // Concave response: small departures from the optimum cost little; 0.4 at the absolute limit, falling fast beyond.
  const side = (d: number, span: number) => (d <= 0 ? 1 : d <= span ? 1 - 0.6 * (d / span) ** 2 : Math.max(0.05, 0.4 - 0.7 * (d - span)));
  const phF = ph < lo ? side(lo - ph, lo - mn) : side(ph - hi, mx - hi);
  const clay = soil.topsoil.clay?.p50 ?? 25, sand = soil.topsoil.sand?.p50 ?? 40;
  let textureF = 1;
  if (c.texture === "light") textureF = clay > 45 ? 0.55 : clay > 35 ? 0.7 : clay > 27 ? 0.85 : 1;
  else if (c.texture === "heavy") textureF = sand > 75 ? 0.6 : sand > 60 ? 0.8 : 1;
  else if (c.texture === "medium") textureF = clay > 50 || sand > 80 ? 0.75 : clay > 42 || sand > 70 ? 0.88 : 1;
  const sens = 1 - c.wlTol;
  const drainF = soil.drainage === "poor" ? 1 - 0.5 * sens : soil.drainage === "imperfect" ? 1 - 0.25 * sens
    : soil.drainage === "moderate" ? 1 - 0.08 * sens : soil.drainage === "excessive" ? (c.wlTol > 0.8 ? 0.6 : 0.95) : 1;
  return { ph: phF, texture: textureF, drainage: drainF, total: phF * textureF * drainF, phValue: ph };
}

export interface CropAssessment {
  id: string; name: string; group: string; product: string; perennial: boolean;
  score: number;                       // 0–100, rainfed: share of world-class attainable yield reached
  irrigatedScore: number;              // 0–100 with full irrigation
  goodYearsInTen: number;
  yieldTPerHa: { poor: number; median: number; good: number };
  irrigatedYieldTPerHa: number; irrigationMm: number;
  sowing: { bestDoy: number; fromDoy: number; toDoy: number; label: string } | null;
  cultivar: "short-season" | "standard" | "long-season" | null;
  seasonDays: number;
  limiting: string[];
  factors: Record<string, number>;
  recentYears: { year: number; score: number }[];
  firmness: "firm" | "likely" | "uncertain";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function doyLabel(doy: number) {
  const d = new Date(Date.UTC(2001, 0, 1 + ((doy % 365) + 365) % 365));
  const part = d.getUTCDate() <= 10 ? "early" : d.getUTCDate() <= 20 ? "mid" : "late";
  return `${part} ${MONTHS[d.getUTCMonth()]}`;
}

/** Index of each year's day-of-year `doy` in the prepared series. */
function startIndices(p: Prepared, doy: number, firstYear: number) {
  const out: { year: number; i: number }[] = [];
  for (let i = 0; i < p.n; i++) if (p.doy[i] === doy && p.year[i] >= firstYear) out.push({ year: p.year[i], i });
  return out;
}

export function assessCrop(p: Prepared, c: Crop, soil: SoilSummary, yearsBack = 30, soilConfidence = "high"): CropAssessment {
  const lastYear = p.year[p.n - 1];
  const firstYear = lastYear - yearsBack;
  const sf = soilFactors(c, soil);

  type Cand = { doy: number; maturity: number; results: { year: number; r: SeasonResult }[]; mean: number; irr: number };
  const cands: Cand[] = [];
  const doys = c.perennial ? [p.south ? 243 : 59] : Array.from({ length: 37 }, (_, k) => k * 10);
  // Cultivar choice: short / standard / long season maturity classes.
  const maturities = c.perennial ? [1] : [0.85, 1, 1.15];
  for (const maturity of maturities) for (const doy of doys) {
    const results: { year: number; r: SeasonResult }[] = [];
    for (const { year, i } of startIndices(p, doy, firstYear)) {
      if (!c.perennial && p.week[i] < c.tbase + 2) { results.push({ year, r: { ratio: 0, water: 1, temp: 0, frost: 1, heat: 1, wet: 1, chill: 1, matured: false, days: 0, waterIrrigated: 0, disease: 1, tseason: 0, etc: 0, eta: 0, irrigation: 0, rainInSeason: 0 } }); continue; }
      const r = season(p, c, i, soil, maturity);
      if (r) results.push({ year, r });
    }
    if (results.length >= 5) {
      const irr = mean(results.map(({ r }) => (r.water > 0 ? Math.min(1, (r.ratio / r.water) * r.waterIrrigated) : r.waterIrrigated * r.temp * r.frost * r.heat * r.wet * r.chill * r.disease * (r.matured ? 1 : 0.05))));
      cands.push({ doy, maturity, results, mean: mean(results.map((x) => x.r.ratio)), irr });
    }
  }
  // Best rainfed sowing date; when rainfed fails everywhere, the best date for an irrigated crop.
  cands.sort((a, b) => (b.mean - a.mean) || (b.irr - a.irr));
  const best = cands[0];
  if (!best || (best.mean <= 0.001 && best.irr <= 0.001)) {
    return {
      id: c.id, name: c.name, group: c.group, product: c.product, perennial: c.perennial, score: 0, irrigatedScore: 0, goodYearsInTen: 0,
      yieldTPerHa: { poor: 0, median: 0, good: 0 }, irrigatedYieldTPerHa: 0, irrigationMm: 0, sowing: null, cultivar: null, seasonDays: 0,
      limiting: [c.perennial ? "Climate outside this crop's range" : "Season too cold or short to mature"],
      factors: { ph: sf.ph, texture: sf.texture, drainage: sf.drainage }, recentYears: [], firmness: "firm",
    };
  }
  // Sowing window: contiguous candidate dates within 90% of the best.
  const key = best.mean > 0.001 ? "mean" : "irr";
  const good = new Set(cands.filter((x) => x.maturity === best.maturity && x[key] >= best[key] * 0.9).map((x) => x.doy));
  let from = best.doy, to = best.doy;
  while (good.has((from - 10 + 370) % 370)) { from = (from - 10 + 370) % 370; if (from === best.doy) break; }
  while (good.has((to + 10) % 370)) { to = (to + 10) % 370; if (to === best.doy) break; }

  const rs = best.results.map((x) => x.r);
  const ratios = rs.map((r) => r.ratio * sf.total);
  const recent = best.results.slice(-10).map((x) => ({ year: x.year, score: Math.round(100 * x.r.ratio * sf.total) }));
  const f = (k: keyof SeasonResult) => mean(rs.map((r) => r[k] as number));
  const factors: Record<string, number> = {
    water: f("water"), temperature: f("temp"), frost: f("frost"), heat: f("heat"), wetSeasons: f("wet"), disease: f("disease"), chill: f("chill"),
    maturity: rs.filter((r) => r.matured).length / rs.length, ph: sf.ph, texture: sf.texture, drainage: sf.drainage,
  };
  const label = (k: string) => {
    switch (k) {
      case "water": return "dry seasons limit yield";
      case "temperature": return f("tseason") > c.toptHi ? "too hot through the season" : "too cool for strong growth";
      case "frost": return "frost damage around flowering";
      case "heat": return "heat stress at flowering";
      case "wetSeasons": return "waterlogging in wet seasons";
      case "disease": return "foliar disease in wet seasons";
      case "chill": return "not enough winter chill";
      case "maturity": return "season too short or cool to mature in some years";
      case "ph": return sf.phValue < c.ph[1] ? "soil too acidic" : "soil too alkaline";
      case "texture": return (soil.topsoil.clay?.p50 ?? 25) > 35 ? "heavy clay soil" : "light sandy soil";
      case "drainage": return "poorly drained ground";
      default: return k;
    }
  };
  const limiting = Object.entries(factors).filter(([, v]) => v < 0.88).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => label(k)).filter(Boolean);
  const score = Math.round(100 * mean(ratios));
  const sdev = quantile(ratios, 0.8) - quantile(ratios, 0.2);
  const firmness = soilConfidence === "low" ? "uncertain" : sdev < 0.25 && score > 55 ? "firm" : sdev < 0.45 ? "likely" : "uncertain";
  const irrigRatio = best.irr * sf.total;

  return {
    id: c.id, name: c.name, group: c.group, product: c.product, perennial: c.perennial,
    score, irrigatedScore: Math.round(100 * irrigRatio), goodYearsInTen: recent.filter((r) => r.score >= 50).length,
    yieldTPerHa: { poor: c.yMax * quantile(ratios, 0.2), median: c.yMax * quantile(ratios, 0.5), good: c.yMax * quantile(ratios, 0.8) },
    irrigatedYieldTPerHa: c.yMax * irrigRatio, irrigationMm: f("irrigation"),
    sowing: c.perennial ? null : { bestDoy: best.doy, fromDoy: from, toDoy: to, label: from === to ? doyLabel(best.doy) : `${doyLabel(from)} – ${doyLabel(to)}` },
    cultivar: c.perennial ? null : best.maturity < 1 ? "short-season" : best.maturity > 1 ? "long-season" : "standard",
    seasonDays: Math.round(f("days")),
    limiting, factors, recentYears: recent, firmness,
  };
}

/** Apply CMIP6 deltas (temperature shift, rainfall scaling) to the historical record. */
export function perturb(s: DailySeries, dT: number, rainRatio: number): DailySeries {
  return {
    ...s,
    tmax: s.tmax.map((v) => v + dT), tmin: s.tmin.map((v) => v + dT), tmean: s.tmean.map((v) => v + dT),
    rain: s.rain.map((v) => v * rainRatio), et0: s.et0.map((v) => v * (1 + 0.03 * dT)), // ~3%/°C ET0 sensitivity
  };
}
