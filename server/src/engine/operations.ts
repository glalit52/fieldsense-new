import type { SoilSummary } from "./soil.ts";
import { clamp, sum } from "./stats.ts";

/** Stull (2011) wet-bulb temperature from air temperature (°C) and RH (%). */
export function wetBulb(t: number, rh: number) {
  return t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(t + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) - 4.686035;
}

export interface DayOps {
  date: string; tmax: number; tmin: number; rain: number; rainProb: number; et0: number; windMax: number; gust: number;
  weatherCode: number; frost: "none" | "light" | "hard"; heat: boolean;
  sprayHours: number; sprayWindows: { from: string; to: string; quality: "good" | "marginal" }[];
  leafWetHours: number; diseaseRisk: "low" | "moderate" | "high"; smithPeriod: boolean;
  workable: boolean; past: boolean;
}

export interface Operations {
  days: DayOps[];
  soilWaterPct: number | null;      // plant-available water in top soil, % of capacity
  soilTemp: number | null;          // 6 cm, next 3-day mean
  waterBalance7d: { rain: number; et0: number; deficit: number };
  alerts: { level: "info" | "warn" | "danger"; text: string }[];
  timezone: string;
}

export function operations(fc: any, soil: SoilSummary): Operations {
  const H = fc.hourly, D = fc.daily;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: fc.timezone });
  const hoursByDay = new Map<string, number[]>();
  H.time.forEach((t: string, i: number) => {
    const d = t.slice(0, 10);
    if (!hoursByDay.has(d)) hoursByDay.set(d, []);
    hoursByDay.get(d)!.push(i);
  });

  const days: DayOps[] = D.time.map((date: string, di: number) => {
    const idx = hoursByDay.get(date) ?? [];
    const windows: DayOps["sprayWindows"] = [];
    let cur: { from: string; to: string; quality: "good" | "marginal" } | null = null;
    let sprayHours = 0, wet = 0;
    for (const i of idx) {
      const t = H.temperature_2m[i], rh = H.relative_humidity_2m[i], w = H.wind_speed_10m[i];
      const hr = Number(H.time[i].slice(11, 13));
      const rainSoon = sum([0, 1, 2, 3].map((k) => H.precipitation[i + k] ?? 0));
      const dT = t - wetBulb(t, rh);
      const lw = H.leaf_wetness_probability?.[i];
      if ((lw != null ? lw >= 50 : rh >= 90) && t >= 8 && t <= 28) wet++;
      const ok = hr >= 6 && hr <= 19 && rainSoon < 0.2 && w >= 3 && w <= 15 && t < 30;
      const quality = ok && dT >= 2 && dT <= 8 ? "good" : ok && dT > 8 && dT <= 10 ? "marginal" : null;
      if (quality) {
        sprayHours++;
        const hh = H.time[i].slice(11, 16);
        if (cur && cur.quality === quality) cur.to = hh;
        else { if (cur) windows.push(cur); cur = { from: hh, to: hh, quality }; }
      } else if (cur) { windows.push(cur); cur = null; }
    }
    if (cur) windows.push(cur);
    const rh90 = idx.filter((i) => H.relative_humidity_2m[i] >= 90).length;
    const tmin = D.temperature_2m_min[di];
    return {
      date, tmax: D.temperature_2m_max[di], tmin, rain: D.precipitation_sum[di] ?? 0, rainProb: D.precipitation_probability_max?.[di] ?? null,
      et0: D.et0_fao_evapotranspiration[di] ?? 0, windMax: D.wind_speed_10m_max[di], gust: D.wind_gusts_10m_max?.[di],
      weatherCode: D.weather_code?.[di], frost: tmin <= -2 ? "hard" : tmin <= 1 ? "light" : "none", heat: D.temperature_2m_max[di] >= 35,
      sprayHours, sprayWindows: windows.map((w) => ({ ...w, to: nextHour(w.to) })),
      leafWetHours: wet, diseaseRisk: wet >= 10 ? "high" : wet >= 6 ? "moderate" : "low",
      smithPeriod: tmin >= 10 && rh90 >= 11, workable: true, past: date < today,
    } satisfies DayOps;
  });
  // Late-blight Smith period needs two consecutive qualifying days.
  for (let i = 1; i < days.length; i++) days[i].smithPeriod = days[i].smithPeriod && days[i - 1].smithPeriod;

  const nowLocal = new Date().toLocaleString("sv-SE", { timeZone: fc.timezone }).slice(0, 13).replace(" ", "T");
  const nowIdx = Math.max(0, H.time.findIndex((t: string) => t.startsWith(nowLocal)));
  const sm = H.soil_moisture_3_to_9cm?.[nowIdx] ?? null;
  const soilWaterPct = sm != null ? clamp((sm - soil.wiltingPoint) / (soil.fieldCapacity - soil.wiltingPoint), 0, 1.2) * 100 : null;
  // Trafficability: wet soil after rain is too soft to work.
  let store = soilWaterPct ?? 50;
  for (const d of days.filter((x) => !x.past)) {
    store = clamp(store + d.rain * 2.5 - d.et0 * 3, 0, 130);
    d.workable = store < 95 && d.rain < 8;
  }
  const next3 = H.soil_temperature_6cm ? H.soil_temperature_6cm.slice(nowIdx, nowIdx + 72) : [];
  const future = days.filter((d) => !d.past);
  const wk = future.slice(0, 7);
  const alerts: Operations["alerts"] = [];
  const hard = future.filter((d) => d.frost === "hard"), light = future.filter((d) => d.frost === "light");
  if (hard.length) alerts.push({ level: "danger", text: `Hard frost forecast on ${hard.map((d) => fmt(d.date)).join(", ")}. Protect flowering crops and seedlings.` });
  else if (light.length) alerts.push({ level: "warn", text: `Light frost possible on ${light.map((d) => fmt(d.date)).join(", ")}.` });
  const hot = future.filter((d) => d.heat);
  if (hot.length) alerts.push({ level: "warn", text: `Heat (≥35 °C) on ${hot.map((d) => fmt(d.date)).join(", ")}. Avoid spraying in the afternoon; irrigate ahead if you can.` });
  const smith = future.filter((d) => d.smithPeriod);
  if (smith.length) alerts.push({ level: "danger", text: `Late-blight Smith period on ${smith.map((d) => fmt(d.date)).join(", ")}. Potato and tomato growers should protect crops.` });
  const disease = future.filter((d) => d.diseaseRisk === "high");
  if (disease.length >= 2) alerts.push({ level: "warn", text: `Long leaf-wetness periods on ${disease.length} days ahead favour fungal disease (rusts, septoria, blackleg). Scout crops.` });
  const gusty = future.filter((d) => (d.gust ?? 0) > 60);
  if (gusty.length) alerts.push({ level: "warn", text: `Damaging gusts over 60 km/h on ${gusty.map((d) => fmt(d.date)).join(", ")}.` });
  const bigRain = future.filter((d) => d.rain >= 25);
  if (bigRain.length) alerts.push({ level: "info", text: `Heavy rain (≥25 mm) on ${bigRain.map((d) => fmt(d.date)).join(", ")}. Hold fertiliser and chemical applications.` });
  const bestSpray = future.find((d) => d.sprayWindows.some((w) => w.quality === "good"));
  if (bestSpray) {
    const w = bestSpray.sprayWindows.find((x) => x.quality === "good")!;
    alerts.push({ level: "info", text: `Next good spray window: ${fmt(bestSpray.date)} ${w.from}–${w.to} (light wind, Delta T 2–8, no rain for 4 h).` });
  }
  return {
    days, soilWaterPct, soilTemp: next3.length ? sum(next3) / next3.length : null,
    waterBalance7d: { rain: sum(wk.map((d) => d.rain)), et0: sum(wk.map((d) => d.et0)), deficit: sum(wk.map((d) => d.et0)) - sum(wk.map((d) => d.rain)) },
    alerts, timezone: fc.timezone,
  };
}

function nextHour(hh: string) {
  const h = Number(hh.slice(0, 2)) + 1;
  return `${String(h).padStart(2, "0")}:00`;
}
function fmt(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
