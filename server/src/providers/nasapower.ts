import { cached, cell, DAY } from "../lib/cache.ts";
import { getJson } from "../lib/http.ts";

/**
 * NASA POWER (MERRA-2 + CERES) daily agro-climatology since 1981 — an independent second source to ERA5.
 * Fetched in ≤10-year chunks: multi-decade requests have been observed to return PRECTOTCORR scaled ×24
 * while still labelled mm/day.
 */
export function powerDaily(lat: number, lon: number, startYear = 1981) {
  const end = new Date(Date.now() - 10 * DAY);
  const endStr = end.toISOString().slice(0, 10).replaceAll("-", "");
  return cached(`power:v3:${cell(lat, lon, 2)}:${startYear}:${endStr.slice(0, 6)}`, 30 * DAY, async () => {
    const params = "T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M";
    const chunks: [string, string][] = [];
    for (let y = startYear; y <= end.getUTCFullYear(); y += 10) {
      const last = Math.min(y + 9, end.getUTCFullYear());
      chunks.push([`${y}0101`, last === end.getUTCFullYear() ? endStr : `${last}1231`]);
    }
    const parts = await Promise.all(chunks.map(([s, e]) => getJson(
      `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${params}&community=AG&longitude=${lon}&latitude=${lat}&start=${s}&end=${e}&format=JSON`,
      { timeoutMs: 90_000, source: "NASA POWER" })));
    // Per-chunk guard against the ×24 precipitation scaling: compare each chunk to the median chunk.
    const chunkMean = (j: any) => { const v = Object.values(j.properties.parameter.PRECTOTCORR as Record<string, number>).filter((x) => x > -998); return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); };
    const means = parts.map(chunkMean), med = [...means].sort((a, b) => a - b)[Math.floor(means.length / 2)];
    const p: Record<string, Record<string, number>> = {};
    parts.forEach((j, ci) => {
      const scaled = means.length > 1 && means[ci] > 12 * Math.min(med, ...means);
      for (const [k, v] of Object.entries(j.properties.parameter as Record<string, Record<string, number>>)) {
        const fixed = k === "PRECTOTCORR" && scaled ? Object.fromEntries(Object.entries(v).map(([d, x]) => [d, x > -998 ? x / 24 : x])) : v;
        p[k] = { ...(p[k] ?? {}), ...fixed };
      }
    });
    const dates = Object.keys(p.PRECTOTCORR).sort();
    const v = (k: string) => dates.map((d) => (p[k][d] <= -998 ? NaN : p[k][d]));
    const rain = v("PRECTOTCORR");
    return {
      time: dates.map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`),
      tmax: v("T2M_MAX"), tmin: v("T2M_MIN"), rain, radiation: v("ALLSKY_SFC_SW_DWN"), rh: v("RH2M"), wind: v("WS2M"),
    };
  });
}
