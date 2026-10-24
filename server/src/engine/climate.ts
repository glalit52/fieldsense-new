import type { DailySeries } from "../providers/openmeteo.ts";
import { mannKendall, mean, median, quantile, round, senSlope, sum } from "./stats.ts";

export interface YearStats {
  year: number; rain: number; et0: number; tmean: number; tmaxMean: number; tminMean: number;
  frostNights: number; hardFrostNights: number; hotDays: number; extremeHotDays: number;
  longestDrySpell: number; heavyRainDays: number; gdd5: number; gdd10: number;
  lastSpringFrost: number | null; firstAutumnFrost: number | null; // day-of-season (see `seasonStart`)
}

export interface ClimateSummary {
  years: YearStats[];
  recent: YearStats[];             // last 10 complete years
  normals: {
    rain: number; et0: number; aridityIndex: number; tmean: number;
    frostNights: number; hotDays: number; longestDrySpell: number; frostFreeDays: number | null;
    climateClass: string;
  };
  dryYearsInTen: number;
  wetYearsInTen: number;
  monthly: { month: number; rain: number; rainP20: number; rainP80: number; tmax: number; tmin: number; et0: number }[];
  trends: { tempPerDecade: number; tempP: number; rainPerDecade: number; rainP: number; hotDaysPerDecade: number; frostPerDecade: number };
  frostLabel: string;
  sources: string[];
  agreement?: { source: string; meanAnnualRain: number; differencePct: number }[];
}

const isSouth = (lat: number) => lat < 0;

/** Split a daily series into complete calendar years. */
export function byYear(s: DailySeries) {
  const map = new Map<number, number[]>();
  s.time.forEach((t, i) => {
    const y = Number(t.slice(0, 4));
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(i);
  });
  return [...map.entries()].filter(([, idx]) => idx.length >= 360).map(([year, idx]) => ({ year, idx }));
}

function longestRun(flags: boolean[]) {
  let best = 0, cur = 0;
  for (const f of flags) { cur = f ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}

export function yearStats(s: DailySeries, lat: number): YearStats[] {
  return byYear(s).map(({ year, idx }) => {
    const g = (a: number[]) => idx.map((i) => a[i]);
    const tmax = g(s.tmax), tmin = g(s.tmin), tmean = g(s.tmean), rain = g(s.rain);
    // Frost dates measured in a frost-season-centred year: Jul→Jun (north) or Jan→Dec (south).
    const frostDays = tmin.map((t, k) => (t <= 0 ? k : -1)).filter((k) => k >= 0);
    let lastSpring: number | null = null, firstAutumn: number | null = null;
    if (frostDays.length) {
      const mid = isSouth(lat) ? 196 : 15; // mid-winter day of year
      if (isSouth(lat)) {
        lastSpring = Math.max(...frostDays);
        firstAutumn = Math.min(...frostDays);
      } else {
        const spring = frostDays.filter((k) => k < 200), autumn = frostDays.filter((k) => k >= 200);
        lastSpring = spring.length ? Math.max(...spring) : null;
        firstAutumn = autumn.length ? Math.min(...autumn) : null;
      }
      void mid;
    }
    return {
      year,
      rain: sum(rain), et0: sum(g(s.et0)), tmean: mean(tmean), tmaxMean: mean(tmax), tminMean: mean(tmin),
      frostNights: tmin.filter((t) => t <= 0).length, hardFrostNights: tmin.filter((t) => t <= -4).length,
      hotDays: tmax.filter((t) => t >= 35).length, extremeHotDays: tmax.filter((t) => t >= 40).length,
      longestDrySpell: longestRun(rain.map((r) => r < 1)),
      heavyRainDays: rain.filter((r) => r >= 25).length,
      gdd5: sum(tmean.map((t) => Math.max(0, t - 5))), gdd10: sum(tmean.map((t) => Math.max(0, t - 10))),
      lastSpringFrost: lastSpring, firstAutumnFrost: firstAutumn,
    };
  });
}

function climateClass(ai: number, tmean: number) {
  const moisture = ai < 0.05 ? "Hyper-arid" : ai < 0.2 ? "Arid" : ai < 0.5 ? "Semi-arid" : ai < 0.65 ? "Dry sub-humid" : ai < 1 ? "Sub-humid" : "Humid";
  const temp = tmean < 5 ? "cold" : tmean < 12 ? "cool" : tmean < 18 ? "temperate" : tmean < 24 ? "warm" : "hot";
  return `${moisture}, ${temp}`;
}

export function summariseClimate(s: DailySeries, lat: number): ClimateSummary {
  const years = yearStats(s, lat);
  const recent = years.slice(-10);
  const rainAll = years.map((y) => y.rain);
  const medRain = median(rainAll);
  const et0 = mean(years.map((y) => y.et0));
  const normalsRain = mean(rainAll);
  const xs = years.map((y) => y.year);
  const tT = senSlope(xs, years.map((y) => y.tmean)), rT = senSlope(xs, rainAll);

  // Frost-free period: median last spring frost → median first autumn frost.
  let frostFree: number | null = null;
  const ls = years.map((y) => y.lastSpringFrost).filter((v): v is number => v != null);
  const fa = years.map((y) => y.firstAutumnFrost).filter((v): v is number => v != null);
  if (!ls.length) frostFree = 365;
  else if (isSouth(lat)) frostFree = Math.round(365 - (median(ls) - median(fa)));
  else if (fa.length) frostFree = Math.round(median(fa) - median(ls));

  const monthly = Array.from({ length: 12 }, (_, m) => {
    const perYear = new Map<number, number>();
    const tx: number[] = [], tn: number[] = [], e: number[] = [];
    s.time.forEach((t, i) => {
      if (Number(t.slice(5, 7)) !== m + 1) return;
      const y = Number(t.slice(0, 4));
      perYear.set(y, (perYear.get(y) ?? 0) + (Number.isFinite(s.rain[i]) ? s.rain[i] : 0));
      tx.push(s.tmax[i]); tn.push(s.tmin[i]); e.push(s.et0[i]);
    });
    const r = [...perYear.values()];
    return { month: m + 1, rain: mean(r), rainP20: quantile(r, 0.2), rainP80: quantile(r, 0.8), tmax: mean(tx), tmin: mean(tn), et0: mean(e) * 30.4 };
  });

  const frost = mean(recent.map((y) => y.frostNights));
  return {
    years, recent,
    normals: {
      rain: normalsRain, et0, aridityIndex: normalsRain / et0, tmean: mean(years.map((y) => y.tmean)),
      frostNights: frost, hotDays: mean(recent.map((y) => y.hotDays)), longestDrySpell: median(recent.map((y) => y.longestDrySpell)),
      frostFreeDays: frostFree, climateClass: climateClass(normalsRain / et0, mean(years.map((y) => y.tmean))),
    },
    dryYearsInTen: recent.filter((y) => y.rain < 0.8 * medRain).length,
    wetYearsInTen: recent.filter((y) => y.rain > 1.2 * medRain).length,
    monthly,
    trends: {
      tempPerDecade: tT.slope * 10, tempP: mannKendall(years.map((y) => y.tmean)).p,
      rainPerDecade: rT.slope * 10, rainP: mannKendall(rainAll).p,
      hotDaysPerDecade: senSlope(xs, years.map((y) => y.hotDays)).slope * 10,
      frostPerDecade: senSlope(xs, years.map((y) => y.frostNights)).slope * 10,
    },
    frostLabel: frost < 1 ? "None" : frost < 5 ? "Rare" : frost < 20 ? "Some" : frost < 60 ? "Common" : "Frequent",
    sources: ["ERA5 / ERA5-Land reanalysis via Open-Meteo"],
  };
}

/** Cross-check annual rainfall between ERA5 and other sources (NASA POWER, CHIRPS). */
export function rainAgreement(era5: YearStats[], others: { source: string; annual: { year: number; rain: number }[] }[]) {
  const eMap = new Map(era5.map((y) => [y.year, y.rain]));
  return others.map((o) => {
    const pairs = o.annual.filter((a) => eMap.has(a.year) && Number.isFinite(a.rain));
    const om = mean(pairs.map((p) => p.rain)), em = mean(pairs.map((p) => eMap.get(p.year)!));
    return { source: o.source, meanAnnualRain: round(om, 0) ?? NaN, differencePct: round(((om - em) / em) * 100, 1) ?? NaN, years: pairs.length };
  });
}
