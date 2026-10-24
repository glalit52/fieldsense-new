import type { SoilSummary } from "./soil.ts";
import { clamp, normCdf } from "./stats.ts";

export interface LimeAdvice {
  call: "Likely needed" | "Borderline" | "None needed";
  probabilityBelowThreshold: number;
  threshold: number;
  targetPh: number;
  topsoilPh: { p10: number; p50: number; p90: number };
  subsoilPh?: { p10: number; p50: number; p90: number };
  subsoilAcidity: boolean;
  rateTPerHa: { low: number; mid: number; high: number };
  bufferCapacity: number;
  alkaline: boolean;
  notes: string[];
}

/**
 * Lime requirement from pH deficit × pH buffering capacity (pHBC).
 * pHBC (cmol H+/kg/pH) from clay and organic carbon (after Aitken et al. 1990 / Merry 2009),
 * converted to t CaCO3/ha for an incorporation depth, then divided by lime effectiveness.
 */
export function limeAdvice(soil: SoilSummary, opts: { targetPh?: number; depthCm?: number; neutralisingValue?: number } = {}): LimeAdvice {
  const threshold = 5.5;
  const targetPh = opts.targetPh ?? 6.0;
  const depth = opts.depthCm ?? 10;
  const nv = (opts.neutralisingValue ?? 95) / 100;
  const ph = soil.topsoil.ph ?? { p10: 6, p50: 6.5, p90: 7 };
  const sd = Math.max(0.08, (ph.p90 - ph.p10) / 2.563);
  const pBelow = normCdf((threshold - ph.p50) / sd);
  const pBelowTarget = normCdf((targetPh - ph.p50) / sd);

  const clay = soil.topsoil.clay?.p50 ?? 25;
  const ocPct = (soil.topsoil.soc?.p50 ?? 10) / 10;
  const bd = soil.topsoil.bdod?.p50 ?? 1.35;
  const pHBC = 0.25 + 0.042 * clay + 0.16 * ocPct * 1.724;
  // 1 cmol(+)/kg neutralised by 0.5 g CaCO3/kg; soil mass per ha for `depth` cm = bd*depth*100 t.
  const tPerPhUnit = pHBC * 0.5e-3 * bd * depth * 100;
  const field = 1 / (0.7 * nv); // incomplete reaction in the field and product quality
  const rate = (p: number) => clamp((targetPh - p) * tPerPhUnit * field, 0, 12);

  const sub = soil.subsoil.ph;
  const subsoilAcidity = sub ? sub.p50 < 5.0 : false;
  const notes: string[] = [];
  if (subsoilAcidity) notes.push("Subsoil (30–100 cm) looks acidic. Surface lime moves slowly; consider deep incorporation or higher rates over several seasons.");
  if (ph.p50 > 7.8) notes.push("Alkaline topsoil: no lime. Watch for zinc, iron and manganese deficiency, and boron toxicity on very high pH.");
  if (soil.confidence === "low") notes.push("Soil map was unavailable, so this call uses a climate-based estimate. A soil test is strongly advised.");
  if (!soil.labOverride) notes.push("Enter a lab or test-kit pH to replace the satellite estimate and narrow the range.");

  const call = pBelow > 0.6 ? "Likely needed" : pBelow > 0.2 || pBelowTarget > 0.6 ? "Borderline" : "None needed";
  const mid = call === "None needed" ? 0 : rate(ph.p50);
  return {
    call, probabilityBelowThreshold: pBelow, threshold, targetPh,
    topsoilPh: ph, subsoilPh: sub, subsoilAcidity,
    rateTPerHa: { low: call === "None needed" ? 0 : rate(ph.p90), mid, high: rate(ph.p10) },
    bufferCapacity: pHBC, alkaline: ph.p50 > 7.8, notes,
  };
}
