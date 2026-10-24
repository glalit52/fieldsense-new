export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const f = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? "–" : n.toFixed(d));
export const pct = (n: number | null | undefined, d = 0) => (n == null || !Number.isFinite(n) ? "–" : `${(n * 100).toFixed(d)}%`);
export const signed = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? "–" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`);
export const dayLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
export const scoreColor = (s: number) => (s >= 70 ? "var(--good)" : s >= 50 ? "var(--ok)" : s >= 30 ? "var(--warn)" : "var(--bad)");
export const levelColor = (l: string) => (l === "high" ? "var(--bad)" : l === "moderate" ? "var(--warn)" : "var(--good)");

const WMO: Record<number, string> = { 0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️", 51: "🌦️", 53: "🌦️", 55: "🌧️", 61: "🌧️", 63: "🌧️", 65: "🌧️", 71: "🌨️", 73: "🌨️", 75: "❄️", 80: "🌦️", 81: "🌧️", 82: "⛈️", 95: "⛈️", 96: "⛈️", 99: "⛈️" };
export const wx = (c: number) => WMO[c] ?? "·";
