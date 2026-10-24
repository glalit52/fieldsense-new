// Calibration check: do known farming regions rank their dominant crops near the top?
import { archive } from "../src/providers/openmeteo.ts";
import { climateSoilEstimate, soilGridsRest } from "../src/providers/soilgrids.ts";
import { inUS, ssurgo } from "../src/providers/ssurgo.ts";
import { summariseSoil } from "../src/engine/soil.ts";
import { assessCrop, prepare } from "../src/engine/simulate.ts";
import { CROPS } from "../src/engine/crops.ts";
import { byYear } from "../src/engine/climate.ts";

const SITES: [string, number, number, string[]][] = [
  ["Wimmera AU", -36.63, 142.16, ["wheat", "barley", "canola", "lentil", "chickpea", "faba_bean"]],
  ["Iowa US", 42.0, -93.75, ["maize", "soybean"]],
  ["Punjab IN", 30.9, 75.85, ["wheat", "rice", "cotton", "maize"]],
  ["Beauce FR", 48.3, 1.6, ["wheat", "barley", "canola", "sugar_beet", "maize"]],
  ["Rift KE", 0.52, 35.27, ["maize", "common_bean", "wheat", "potato", "tea"]],
  ["Mato Grosso BR", -13.0, -55.9, ["soybean", "maize", "cotton"]],
];

let hits = 0, total = 0;
for (const [name, lat, lon, expected] of SITES) {
  const w = await archive(lat, lon, 1991);
  let prof;
  try { prof = inUS(lat, lon) ? await ssurgo(lat, lon) : await soilGridsRest(lat, lon); } catch {
    const ys = byYear(w);
    const ai = ys.reduce((a, { idx }) => a + idx.reduce((s, i) => s + (w.rain[i] || 0), 0), 0) / ys.reduce((a, { idx }) => a + idx.reduce((s, i) => s + (w.et0[i] || 0), 0), 0);
    prof = climateSoilEstimate(ai, w.tmean.reduce((a, b) => a + (b || 0), 0) / w.tmean.length);
  }
  const soil = summariseSoil(prof);
  const p = prepare(w, soil, lat);
  const ranked = CROPS.map((c) => assessCrop(p, c, soil)).sort((a, b) => b.score - a.score);
  const top10 = ranked.slice(0, 10).map((c) => c.id);
  const found = expected.filter((e) => top10.includes(e));
  hits += found.length; total += expected.length;
  console.log(`\n${name}  soil:${prof.confidence} pH ${soil.topsoil.ph?.p50.toFixed(1)}  expected in top10: ${found.length}/${expected.length}`);
  console.log("  " + ranked.slice(0, 10).map((c) => `${c.name} ${c.score} (${c.yieldTPerHa.median.toFixed(1)}t)`).join(" | "));
  for (const e of expected.filter((x) => !top10.includes(x))) {
    const c = ranked.find((x) => x.id === e)!;
    console.log(`  MISS ${c.name}: #${ranked.indexOf(c) + 1} score ${c.score}, ${c.yieldTPerHa.median.toFixed(1)} t, ${JSON.stringify(c.factors)}`);
  }
}
console.log(`\nTOTAL ${hits}/${total} expected crops in top 10`);
process.exit(0);
