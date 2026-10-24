import { cached, cell, DAY } from "../lib/cache.ts";
import { config } from "../config.ts";
import { getJson } from "../lib/http.ts";

// With a commercial key, use the customer endpoints (higher limits, SLA).
const om = (host: string, path: string) => config.openMeteoKey
  ? `https://customer-${host}.open-meteo.com${path}&apikey=${config.openMeteoKey}`
  : `https://${host}.open-meteo.com${path}`;

export interface DailySeries {
  time: string[];
  tmax: number[];
  tmin: number[];
  tmean: number[];
  rain: number[];
  et0: number[];
  radiation: number[];
  wind: number[];
  rh: number[];
  sm0_7: number[];
  sm7_28: number[];
}

const ARCHIVE_VARS = [
  "temperature_2m_max", "temperature_2m_min", "temperature_2m_mean", "precipitation_sum",
  "et0_fao_evapotranspiration", "shortwave_radiation_sum", "wind_speed_10m_max",
  "relative_humidity_2m_mean", "soil_moisture_0_to_7cm_mean", "soil_moisture_7_to_28cm_mean",
];

function toSeries(d: any): DailySeries {
  const n = (k: string) => (d[k] as (number | null)[]).map((v) => (v == null ? NaN : v));
  return {
    time: d.time,
    tmax: n("temperature_2m_max"), tmin: n("temperature_2m_min"), tmean: n("temperature_2m_mean"),
    rain: n("precipitation_sum"), et0: n("et0_fao_evapotranspiration"), radiation: n("shortwave_radiation_sum"),
    wind: n("wind_speed_10m_max"), rh: n("relative_humidity_2m_mean"),
    sm0_7: n("soil_moisture_0_to_7cm_mean"), sm7_28: n("soil_moisture_7_to_28cm_mean"),
  };
}

/** ERA5 / ERA5-Land reanalysis, daily, from `startYear` to ~5 days ago. */
export function archive(lat: number, lon: number, startYear: number): Promise<DailySeries & { elevation: number; timezone: string }> {
  const end = new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10);
  return cached(`om:archive:${cell(lat, lon, 2)}:${startYear}:${end.slice(0, 7)}`, 30 * DAY, async () => {
    const url = om("archive-api", `/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=${startYear}-01-01&end_date=${end}&daily=${ARCHIVE_VARS.join(",")}&timezone=auto`);
    const j = await getJson(url, { timeoutMs: 90_000, retries: 3, source: "Open-Meteo archive (ERA5)" });
    return { ...toSeries(j.daily), elevation: j.elevation, timezone: j.timezone };
  });
}

/** 16-day forecast with 7 past days, daily + hourly agronomic variables. */
export function forecast(lat: number, lon: number) {
  return cached(`om:fc:${cell(lat, lon, 2)}:${new Date().toISOString().slice(0, 13)}`, DAY / 8, async () => {
    const daily = [
      "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max",
      "et0_fao_evapotranspiration", "wind_speed_10m_max", "wind_gusts_10m_max", "shortwave_radiation_sum",
      "weather_code", "sunrise", "sunset",
    ];
    const hourly = [
      "temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m", "leaf_wetness_probability",
      "vapour_pressure_deficit", "soil_moisture_0_to_1cm", "soil_moisture_3_to_9cm", "soil_temperature_6cm", "dew_point_2m",
    ];
    const url = om("api", `/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=${daily.join(",")}&hourly=${hourly.join(",")}&past_days=7&forecast_days=16&timezone=auto`);
    return getJson(url, { source: "Open-Meteo forecast" });
  });
}

/** ECMWF SEAS5 ensemble seasonal outlook (~7 months), reduced to monthly ensemble stats. */
export function seasonal(lat: number, lon: number) {
  return cached(`om:seas:${cell(lat, lon, 1)}:${new Date().toISOString().slice(0, 10)}`, DAY, async () => {
    const url = om("seasonal-api", `/v1/seasonal?latitude=${lat}&longitude=${lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=210`);
    const j = await getJson(url, { timeoutMs: 60_000, source: "Open-Meteo seasonal (ECMWF SEAS5)" });
    const d = j.daily;
    const members = (base: string) => Object.keys(d).filter((k) => k === base || k.startsWith(base + "_member"));
    const months = new Map<string, { rain: number[]; tmax: number[]; tmin: number[] }>();
    const rainKeys = members("precipitation_sum");
    const tmaxKeys = members("temperature_2m_max");
    const tminKeys = members("temperature_2m_min");
    d.time.forEach((t: string, i: number) => {
      const m = t.slice(0, 7);
      if (!months.has(m)) months.set(m, { rain: new Array(rainKeys.length).fill(0), tmax: [], tmin: [] });
      const e = months.get(m)!;
      rainKeys.forEach((k, mi) => (e.rain[mi] += d[k][i] ?? 0));
      const mx = tmaxKeys.map((k) => d[k][i]).filter((v: any) => v != null);
      const mn = tminKeys.map((k) => d[k][i]).filter((v: any) => v != null);
      if (mx.length) e.tmax.push(mx.reduce((a: number, b: number) => a + b, 0) / mx.length);
      if (mn.length) e.tmin.push(mn.reduce((a: number, b: number) => a + b, 0) / mn.length);
    });
    return [...months.entries()].map(([month, e]) => {
      const r = [...e.rain].sort((a, b) => a - b);
      const q = (p: number) => r[Math.min(r.length - 1, Math.floor(p * r.length))];
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
      return { month, days: e.tmax.length, rainP10: q(0.1), rainMedian: q(0.5), rainP90: q(0.9), tmax: avg(e.tmax), tmin: avg(e.tmin), members: r.length };
    });
  });
}

/** CMIP6 HighResMIP downscaled projections (to 2050) — multi-model daily series. */
export function climateProjection(lat: number, lon: number) {
  const models = ["MRI_AGCM3_2_S", "EC_Earth3P_HR", "MPI_ESM1_2_XR", "CMCC_CM2_VHR4"];
  return cached(`om:cmip6:${cell(lat, lon, 1)}`, 180 * DAY, async () => {
    const url = om("climate-api", `/v1/climate?latitude=${lat}&longitude=${lon}` +
      `&start_date=1995-01-01&end_date=2049-12-31&models=${models.join(",")}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum`);
    const j = await getJson(url, { timeoutMs: 120_000, source: "Open-Meteo climate (CMIP6)" });
    const d = j.daily;
    // Reduce to annual means per model to keep payload small.
    const out: Record<string, { year: number; tmax: number; tmin: number; rain: number }[]> = {};
    for (const m of models) {
      const tx = d[`temperature_2m_max_${m}`], tn = d[`temperature_2m_min_${m}`], pr = d[`precipitation_sum_${m}`];
      if (!tx || tx.every((v: any) => v == null)) continue;
      const years = new Map<number, { tx: number; tn: number; pr: number; n: number }>();
      d.time.forEach((t: string, i: number) => {
        if (tx[i] == null || tn[i] == null || pr[i] == null) return;
        const y = Number(t.slice(0, 4));
        const e = years.get(y) ?? { tx: 0, tn: 0, pr: 0, n: 0 };
        e.tx += tx[i]; e.tn += tn[i]; e.pr += pr[i]; e.n++;
        years.set(y, e);
      });
      out[m] = [...years.entries()].filter(([, e]) => e.n > 300)
        .map(([year, e]) => ({ year, tmax: e.tx / e.n, tmin: e.tn / e.n, rain: e.pr }));
    }
    return out;
  });
}

export function elevationGrid(lat: number, lon: number, stepDeg = 0.0015) {
  // 5x5 grid (~165 m spacing) for slope, aspect and topographic position.
  return cached(`om:elev:${cell(lat, lon, 4)}`, 365 * DAY, async () => {
    const lats: number[] = [], lons: number[] = [];
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) { lats.push(+(lat + r * stepDeg).toFixed(5)); lons.push(+(lon + c * stepDeg).toFixed(5)); }
    const j = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`, { source: "Open-Meteo elevation (Copernicus DEM)" });
    return { step: stepDeg, values: j.elevation as number[] };
  });
}
