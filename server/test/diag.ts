import { archive } from "../src/providers/openmeteo.ts";
import { climateSoilEstimate } from "../src/providers/soilgrids.ts";
import { summariseSoil } from "../src/engine/soil.ts";
import { prepare, seasonDiag } from "../src/engine/simulate.ts";
import { cropById } from "../src/engine/crops.ts";
const [lat, lon, crop, md] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const w = await archive(lat, lon, 1991);
const soil = summariseSoil(climateSoilEstimate(0.92, 10));
const p = prepare(w, soil, lat);
const c = cropById(crop)!;
console.log("awc", p.awc.toFixed(0), "TAW", (p.awc * c.root).toFixed(0), "fallow@sow", [...p.fallow.filter((_, i) => p.time[i].endsWith(md))].slice(-6).map((x) => x.toFixed(2)).join(" "));
for (const y of [2012, 2016, 2018, 2020, 2022, 2024]) {
  const r = seasonDiag(p, c, p.time.indexOf(`${y}-${md}`), soil)!;
  console.log(y, ["ratio", "water", "waterIrrigated", "temp", "frost", "matured", "days", "tseason", "etc", "eta", "rainInSeason"].map((k) => `${k}=${typeof (r as any)[k] === "number" ? (r as any)[k].toFixed(2) : (r as any)[k]}`).join(" "));
}
process.exit(0);
