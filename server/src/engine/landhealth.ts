import { mannKendall, mean, median, quantile, senSlope } from "./stats.ts";

export interface NdviObs { date: string; ndvi: number }

export interface LandHealth {
  source: string;
  firstYear: number; lastYear: number;
  annual: { year: number; mean: number; peak: number; low: number; seasons: number }[];
  changePct: number;            // trend-implied change in mean NDVI over the record
  trendPerDecade: number; pValue: number;
  verdict: "Improving" | "Stable" | "Declining";
  seasonality: { month: number; ndvi: number; p20: number; p80: number }[];
  greenUpMonth: number; peakMonth: number;
  croppingIntensity: number;    // typical greenness peaks per year
  recentAnomaly: number;        // last 12 months vs same months long-term (NDVI units)
  current?: { date: string; ndvi: number; percentile: number };
  series: NdviObs[];            // thinned for charting
}

/** Smooth with a centred moving median to suppress cloud/snow dropouts. */
function smooth(v: number[], k = 2) {
  return v.map((_, i) => median(v.slice(Math.max(0, i - k), i + k + 1)));
}

function countPeaks(raw: number[], prominence = 0.08) {
  // Light 3-point mean (the median filter leaves flat tops that hide maxima).
  const v = raw.map((_, i) => mean(raw.slice(Math.max(0, i - 1), i + 2)));
  let peaks = 0;
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] > v[i - 1] && v[i] >= v[i + 1]) {
      const left = Math.min(...v.slice(Math.max(0, i - 6), i)), right = Math.min(...v.slice(i + 1, i + 7));
      if (v[i] - Math.max(left, right) >= prominence) peaks++;
    }
  }
  return peaks;
}

export function analyseLandHealth(obs: NdviObs[], source: string): LandHealth {
  const sorted = [...obs].sort((a, b) => a.date.localeCompare(b.date));
  const vals = smooth(sorted.map((o) => o.ndvi));
  const s = sorted.map((o, i) => ({ date: o.date, ndvi: vals[i] }));
  const rawByYear = new Map<number, number[]>();
  for (const o of sorted) {
    const y = Number(o.date.slice(0, 4));
    if (!rawByYear.has(y)) rawByYear.set(y, []);
    rawByYear.get(y)!.push(o.ndvi);
  }
  const byYear = new Map<number, number[]>();
  for (const o of s) {
    const y = Number(o.date.slice(0, 4));
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(o.ndvi);
  }
  const annual = [...byYear.entries()].filter(([, v]) => v.length >= 15)
    .map(([year, v]) => ({ year, mean: mean(v), peak: quantile(v, 0.95), low: quantile(v, 0.05), seasons: countPeaks(rawByYear.get(year) ?? v) }));
  const xs = annual.map((a) => a.year), ys = annual.map((a) => a.mean);
  const { slope, intercept } = senSlope(xs, ys);
  const { p } = mannKendall(ys);
  const start = intercept + slope * xs[0], end = intercept + slope * xs[xs.length - 1];
  const changePct = ((end - start) / Math.max(0.05, start)) * 100;
  const verdict = p < 0.1 && changePct > 3 ? "Improving" : p < 0.1 && changePct < -3 ? "Declining" : "Stable";

  const seasonality = Array.from({ length: 12 }, (_, m) => {
    const v = s.filter((o) => Number(o.date.slice(5, 7)) === m + 1).map((o) => o.ndvi);
    return { month: m + 1, ndvi: mean(v), p20: quantile(v, 0.2), p80: quantile(v, 0.8) };
  });
  const peakMonth = seasonality.reduce((b, x) => (x.ndvi > b.ndvi ? x : b)).month;
  const minMonth = seasonality.reduce((b, x) => (x.ndvi < b.ndvi ? x : b)).month;
  // Green-up: first month after the minimum where greenness rises past the midpoint.
  const mid = (seasonality[peakMonth - 1].ndvi + seasonality[minMonth - 1].ndvi) / 2;
  let greenUp = peakMonth;
  for (let k = 1; k <= 12; k++) { const m = ((minMonth - 1 + k) % 12) + 1; if (seasonality[m - 1].ndvi >= mid) { greenUp = m; break; } }

  const last = s[s.length - 1];
  const lastDate = new Date(last.date);
  const cutoff = new Date(lastDate.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const recent = s.filter((o) => o.date > cutoff);
  const anomaly = mean(recent.map((o) => o.ndvi - seasonality[Number(o.date.slice(5, 7)) - 1].ndvi));
  const sameMonth = s.filter((o) => o.date.slice(5, 7) === last.date.slice(5, 7)).map((o) => o.ndvi).sort((a, b) => a - b);
  const pct = sameMonth.filter((v) => v <= last.ndvi).length / Math.max(1, sameMonth.length);

  const step = Math.max(1, Math.floor(s.length / 400));
  return {
    source, firstYear: xs[0], lastYear: xs[xs.length - 1], annual,
    changePct, trendPerDecade: slope * 10, pValue: p, verdict, seasonality,
    greenUpMonth: greenUp, peakMonth, croppingIntensity: median(annual.map((a) => a.seasons)),
    recentAnomaly: anomaly,
    current: { date: last.date, ndvi: last.ndvi, percentile: pct },
    series: s.filter((_, i) => i % step === 0),
  };
}
