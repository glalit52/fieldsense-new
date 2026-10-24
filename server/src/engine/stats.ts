export const sum = (a: number[]) => a.reduce((x, y) => x + (Number.isFinite(y) ? y : 0), 0);
export const finite = (a: number[]) => a.filter(Number.isFinite);
export const mean = (a: number[]) => { const f = finite(a); return f.length ? sum(f) / f.length : NaN; };

export function quantile(a: number[], q: number) {
  const s = finite(a).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (a: number[]) => quantile(a, 0.5);

export function std(a: number[]) {
  const m = mean(a), f = finite(a);
  return Math.sqrt(sum(f.map((v) => (v - m) ** 2)) / Math.max(1, f.length - 1));
}

/** Theil–Sen slope: robust trend (units per x-step). */
export function senSlope(xs: number[], ys: number[]) {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    if (xs[j] !== xs[i] && Number.isFinite(ys[i]) && Number.isFinite(ys[j])) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  }
  const slope = median(slopes);
  const intercept = median(xs.map((x, i) => ys[i] - slope * x));
  return { slope, intercept };
}

/** Mann–Kendall trend test, two-sided p-value (normal approximation, no tie correction). */
export function mannKendall(ys: number[]) {
  const y = finite(ys), n = y.length;
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(y[j] - y[i]);
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  return { s, z, p: 2 * (1 - normCdf(Math.abs(z))) };
}

export function normCdf(z: number) {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return 0.5 * (1 + Math.sign(z) * erf);
}

/** Trapezoid membership: 0 outside [a,d], 1 inside [b,c], linear between. */
export function trapezoid(x: number, a: number, b: number, c: number, d: number) {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  return x < b ? (x - a) / (b - a) : (d - x) / (d - c);
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const round = (x: number, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
