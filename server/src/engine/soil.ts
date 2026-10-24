import type { Range, SoilLayer, SoilProfile } from "../providers/soilgrids.ts";
import { clamp } from "./stats.ts";

export interface LabTest { ph?: number; organicCarbon?: number; clay?: number; date?: string }

export interface SoilSummary {
  source: string;
  confidence: "high" | "medium" | "low";
  topsoil: Record<string, Range | undefined>;
  subsoil: Record<string, Range | undefined>;
  texture: string;
  textureSub: string;
  fieldCapacity: number;   // vol fraction
  wiltingPoint: number;
  awcMmPerM: number;       // plant-available water per metre of soil
  drainage: "excessive" | "well" | "moderate" | "imperfect" | "poor";
  organicMatterPct: number;
  carbonStockTPerHa30: number;
  labOverride: boolean;
  layers: SoilLayer[];
}

const PROPS = ["ph", "soc", "clay", "sand", "silt", "cec", "nitrogen", "bdod", "cfvo"] as const;

function depthWeighted(layers: SoilLayer[], from: number, to: number) {
  const out: Record<string, Range | undefined> = {};
  for (const p of PROPS) {
    let w = 0; const acc = { p10: 0, p50: 0, p90: 0 };
    for (const L of layers) {
      const r = L[p] as Range | undefined;
      const ov = Math.max(0, Math.min(to, L.bottom) - Math.max(from, L.top));
      if (!r || !ov) continue;
      w += ov; acc.p10 += r.p10 * ov; acc.p50 += r.p50 * ov; acc.p90 += r.p90 * ov;
    }
    out[p] = w ? { p10: acc.p10 / w, p50: acc.p50 / w, p90: acc.p90 / w } : undefined;
  }
  return out;
}

/** USDA texture triangle. */
export function textureClass(sand: number, clay: number) {
  const silt = 100 - sand - clay;
  if (silt + 1.5 * clay < 15) return "Sand";
  if (silt + 1.5 * clay < 30) return "Loamy sand";
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return "Sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "Loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "Silt loam";
  if (silt >= 80 && clay < 12) return "Silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "Sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "Clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "Silty clay loam";
  if (clay >= 35 && sand > 45) return "Sandy clay";
  if (clay >= 40 && silt >= 40) return "Silty clay";
  return "Clay";
}

/** Saxton & Rawls (2006) pedotransfer functions: θ at -33 kPa and -1500 kPa. */
export function saxtonRawls(sandPct: number, clayPct: number, omPct: number) {
  const S = sandPct / 100, C = clayPct / 100, OM = clamp(omPct, 0, 8);
  const t1500 = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031;
  const wp = t1500 + (0.14 * t1500 - 0.02);
  const t33 = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299;
  const fc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);
  return { fc: clamp(fc, 0.05, 0.55), wp: clamp(wp, 0.01, 0.4) };
}

export function summariseSoil(profile: SoilProfile, lab?: LabTest, terrainWetness?: number | null): SoilSummary {
  const topsoil = depthWeighted(profile.layers, 0, 30);
  const subsoil = depthWeighted(profile.layers, 30, 100);
  let labOverride = false;
  // A lab test replaces the satellite/map estimate with a tight range (typical lab precision).
  if (lab?.ph != null) { topsoil.ph = { p10: lab.ph - 0.15, p50: lab.ph, p90: lab.ph + 0.15 }; labOverride = true; }
  if (lab?.organicCarbon != null) { const g = lab.organicCarbon * 10; topsoil.soc = { p10: g * 0.9, p50: g, p90: g * 1.1 }; labOverride = true; }
  if (lab?.clay != null) { topsoil.clay = { p10: lab.clay - 3, p50: lab.clay, p90: lab.clay + 3 }; labOverride = true; }

  const sand = topsoil.sand?.p50 ?? 40, clay = topsoil.clay?.p50 ?? 25;
  const socPct = (topsoil.soc?.p50 ?? 10) / 10;           // g/kg → %
  const om = socPct * 1.724;
  const { fc, wp } = saxtonRawls(sand, clay, om);
  const sub = saxtonRawls(subsoil.sand?.p50 ?? sand, subsoil.clay?.p50 ?? clay, om * 0.4);
  const stones = (topsoil.cfvo?.p50 ?? 5) / 100;
  const awcMmPerM = profile.awcMmPerM ?? ((fc - wp) * 0.3 + (sub.fc - sub.wp) * 0.7) * 1000 * (1 - stones);

  const subClay = subsoil.clay?.p50 ?? clay;
  let drainScore = 0; // higher = wetter
  drainScore += clay > 45 ? 2 : clay > 35 ? 1 : sand > 75 ? -2 : sand > 60 ? -1 : 0;
  drainScore += subClay - clay > 15 ? 1.5 : subClay > 45 ? 1 : 0; // duplex / heavy subsoil
  if (terrainWetness != null) drainScore += terrainWetness > 12 ? 1.5 : terrainWetness > 9 ? 0.75 : 0;
  const drainage = profile.drainage ?? (drainScore >= 3 ? "poor" : drainScore >= 2 ? "imperfect" : drainScore >= 1 ? "moderate" : drainScore <= -2 ? "excessive" : "well");

  const bd = topsoil.bdod?.p50 ?? 1.35;
  return {
    source: labOverride ? `${profile.source} + your lab test` : profile.source,
    confidence: labOverride ? "high" : profile.confidence,
    topsoil, subsoil,
    texture: textureClass(sand, clay),
    textureSub: textureClass(subsoil.sand?.p50 ?? sand, subClay),
    fieldCapacity: fc, wiltingPoint: wp, awcMmPerM,
    drainage,
    organicMatterPct: om,
    carbonStockTPerHa30: (socPct / 100) * bd * 0.3 * 10_000 * (1 - stones),
    labOverride,
    layers: profile.layers,
  };
}
