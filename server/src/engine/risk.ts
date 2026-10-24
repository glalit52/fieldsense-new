import type { ClimateSummary } from "./climate.ts";
import type { SoilSummary } from "./soil.ts";
import { clamp } from "./stats.ts";

export interface Risk { id: string; label: string; level: "low" | "moderate" | "high"; score: number; detail: string }

const lvl = (s: number): Risk["level"] => (s >= 0.6 ? "high" : s >= 0.3 ? "moderate" : "low");

export function assessRisks(cl: ClimateSummary, soil: SoilSummary, terrain: { slopeDeg?: number | null; twi?: number | null; tpi?: number | null; waterOccurrence?: number | null }): Risk[] {
  const n = cl.normals;
  const out: Risk[] = [];

  const frost = clamp(n.frostNights / 40);
  out.push({ id: "frost", label: "Frost", level: lvl(frost), score: frost,
    detail: `${n.frostNights.toFixed(0)} frost nights a year (${cl.frostLabel.toLowerCase()})${n.frostFreeDays != null && n.frostFreeDays < 365 ? `, about ${n.frostFreeDays} frost-free days` : ""}. Trend ${cl.trends.frostPerDecade >= 0 ? "+" : ""}${cl.trends.frostPerDecade.toFixed(1)} nights per decade.` });

  const heat = clamp(n.hotDays / 30);
  out.push({ id: "heat", label: "Heat", level: lvl(heat), score: heat,
    detail: `${n.hotDays.toFixed(0)} day${n.hotDays.toFixed(0) === "1" ? "" : "s"} over 35 °C a year; trend ${cl.trends.hotDaysPerDecade >= 0 ? "+" : ""}${cl.trends.hotDaysPerDecade.toFixed(1)} per decade.` });

  const drought = clamp((cl.dryYearsInTen / 10) * 1.5 + (1 - clamp(n.aridityIndex)) * 0.4);
  out.push({ id: "drought", label: "Drought", level: lvl(drought), score: drought,
    detail: `${cl.dryYearsInTen} dry years in the last ten (rain below 80% of normal). Longest dry spell is typically ${n.longestDrySpell.toFixed(0)} days. ${n.climateClass}.` });

  const clay = soil.topsoil.clay?.p50 ?? 25;
  const wetness = terrain.twi ?? null, tpi = terrain.tpi ?? null;
  let wl = { poor: 0.75, imperfect: 0.5, moderate: 0.3, well: 0.12, excessive: 0.03 }[soil.drainage];
  if (tpi != null && tpi < -1.5) wl += 0.2;            // sits lower than surroundings
  if ((terrain.waterOccurrence ?? 0) > 5) wl += 0.25;  // satellites have seen standing water here
  wl += clamp((n.aridityIndex - 0.6) * 0.3, 0, 0.2);
  wl = clamp(wl);
  out.push({ id: "waterlogging", label: "Waterlogging", level: lvl(wl), score: wl,
    detail: `${soil.drainage[0].toUpperCase() + soil.drainage.slice(1)} drainage, ${clay.toFixed(0)}% clay topsoil` +
      `${tpi != null && tpi < -1.5 ? "; the field sits in a low spot relative to its surroundings" : ""}` +
      `${wetness != null ? `; terrain wetness index ${wetness.toFixed(1)}` : ""}` +
      `${(terrain.waterOccurrence ?? 0) > 5 ? `; surface water seen ${terrain.waterOccurrence!.toFixed(0)}% of the time since 1984 (JRC)` : ""}.` });

  const slope = terrain.slopeDeg ?? 1;
  const intensity = cl.recent.reduce((a, y) => a + y.heavyRainDays, 0) / Math.max(1, cl.recent.length);
  const erosion = clamp((slope / 8) * 0.6 + (intensity / 8) * 0.4 * (1 - clay / 100));
  out.push({ id: "erosion", label: "Erosion", level: lvl(erosion), score: erosion,
    detail: `Slope about ${slope.toFixed(1)}°, ${intensity.toFixed(1)} heavy-rain days (≥25 mm) a year. Keep stubble cover on slopes.` });

  const acid = soil.topsoil.ph ? clamp((5.8 - soil.topsoil.ph.p50) / 1.5) : 0;
  const sodic = (soil.topsoil.ph?.p50 ?? 7) > 8.4 ? 0.6 : 0;
  out.push({ id: "soil_chem", label: acid >= sodic ? "Soil acidity" : "Alkalinity / sodicity", level: lvl(Math.max(acid, sodic)), score: Math.max(acid, sodic),
    detail: acid >= sodic ? `Topsoil pH ${soil.topsoil.ph?.p50.toFixed(1) ?? "?"}. Acidity raises aluminium and manganese toxicity risk for sensitive crops.` :
      `Topsoil pH ${soil.topsoil.ph?.p50.toFixed(1)}. High pH can mean sodic, dispersive subsoil and micronutrient deficiency; check ESP and boron.` });
  return out;
}
