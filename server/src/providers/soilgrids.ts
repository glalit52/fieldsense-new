import { cached, cell, DAY } from "../lib/cache.ts";
import { getJson } from "../lib/http.ts";

export interface Range { p10: number; p50: number; p90: number }
export interface SoilLayer {
  depth: string; // e.g. "0-5cm"
  top: number; bottom: number;
  ph?: Range; soc?: Range; clay?: Range; sand?: Range; silt?: Range;
  cec?: Range; nitrogen?: Range; bdod?: Range; cfvo?: Range;
}
export interface SoilProfile {
  source: string;
  confidence: "high" | "medium" | "low";
  layers: SoilLayer[];
  drainage?: "excessive" | "well" | "moderate" | "imperfect" | "poor"; // surveyed class, when the source has one
  awcMmPerM?: number;                                                    // measured available water, when known
}

// SoilGrids d_factor-scaled units → conventional units.
const PROPS: Record<string, { key: keyof SoilLayer; scale: number }> = {
  phh2o: { key: "ph", scale: 10 },        // pH*10 → pH
  soc: { key: "soc", scale: 10 },         // dg/kg → g/kg
  clay: { key: "clay", scale: 10 },       // g/kg → %
  sand: { key: "sand", scale: 10 },
  silt: { key: "silt", scale: 10 },
  cec: { key: "cec", scale: 10 },         // mmol(c)/kg → cmol(c)/kg
  nitrogen: { key: "nitrogen", scale: 100 }, // cg/kg → g/kg
  bdod: { key: "bdod", scale: 100 },      // cg/cm³ → g/cm³
  cfvo: { key: "cfvo", scale: 10 },       // cm³/dm³ → vol %
};
const DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"];

/** SoilGrids gives Q05/Q50/Q95; assume ~normal and rescale the 90% band to an 80% band. */
function to80(q05: number, q50: number, q95: number): Range {
  const k = 1.2816 / 1.6449;
  return { p10: q50 - (q50 - q05) * k, p50: q50, p90: q50 + (q95 - q50) * k };
}

// Circuit breaker: ISRIC's API has outages; after a gateway/timeout failure skip it for 15 minutes.
let downUntil = 0;

export function soilGridsRest(lat: number, lon: number): Promise<SoilProfile> {
  return cached(`soilgrids:${cell(lat, lon, 3)}`, 365 * DAY, async () => {
    if (Date.now() < downUntil) throw new Error("ISRIC SoilGrids is temporarily unavailable (skipping for a few minutes)");
    const qs = Object.keys(PROPS).map((p) => `property=${p}`).join("&") + "&" +
      DEPTHS.map((d) => `depth=${d}`).join("&") + "&value=Q0.05&value=Q0.5&value=Q0.95";
    const j = await getJson(`https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&${qs}`,
      { timeoutMs: 20_000, retries: 1, source: "ISRIC SoilGrids" }).catch((e) => {
      if (!(e?.status >= 400 && e?.status < 500)) downUntil = Date.now() + 15 * 60_000;
      throw e;
    });
    const layers: SoilLayer[] = DEPTHS.map((d) => {
      const [top, bottom] = d.replace("cm", "").split("-").map(Number);
      return { depth: d, top, bottom };
    });
    let any = false;
    for (const layer of j.properties.layers) {
      const meta = PROPS[layer.name];
      if (!meta) continue;
      for (const dep of layer.depths) {
        const L = layers.find((l) => l.depth === dep.label);
        const v = dep.values;
        if (!L || v["Q0.5"] == null) continue;
        any = true;
        (L as any)[meta.key] = to80(v["Q0.05"] / meta.scale, v["Q0.5"] / meta.scale, v["Q0.95"] / meta.scale);
      }
    }
    if (!any) throw new Error("SoilGrids returned no data (water, urban or outside coverage)");
    return { source: "ISRIC SoilGrids 2.0 (250 m, ~240k profiles)", confidence: "high", layers };
  });
}

/**
 * Last-resort estimator when no soil map is reachable: pedogenic relationships between
 * climate (aridity) and pH / organic carbon. Deliberately wide ranges and flagged low confidence.
 */
export function climateSoilEstimate(aridityIndex: number, meanTemp: number): SoilProfile {
  const ph = 5.0 + 3.2 / (1 + Math.exp(5 * (aridityIndex - 0.65)));
  const soc = Math.max(3, Math.min(60, 8 + 30 * Math.min(aridityIndex, 1.5) - 0.6 * Math.max(0, meanTemp - 10)));
  const r = (v: number, sd: number): Range => ({ p10: Math.max(0, v - 1.28 * sd), p50: v, p90: v + 1.28 * sd });
  const layer = (depth: string, top: number, bottom: number, phShift: number, socMul: number): SoilLayer => ({
    depth, top, bottom,
    ph: r(ph + phShift, 0.9), soc: r(soc * socMul, soc * 0.5), clay: r(22, 12), sand: r(35, 18), silt: r(43, 12),
    cec: r(15, 8), nitrogen: r(soc * socMul / 11, soc / 25), bdod: r(1.35, 0.15), cfvo: r(8, 6),
  });
  return {
    source: "Climate-based estimate (no soil map reachable — enter a lab test for a firm answer)",
    confidence: "low",
    layers: [layer("0-5cm", 0, 5, 0, 1.3), layer("5-15cm", 5, 15, 0.05, 1), layer("15-30cm", 15, 30, 0.1, 0.7),
      layer("30-60cm", 30, 60, 0.25, 0.4), layer("60-100cm", 60, 100, 0.35, 0.25)],
  };
}
