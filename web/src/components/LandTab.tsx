import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { f, MONTHS, signed } from "../lib/format.ts";

const axis = { tick: { fontSize: 11, fill: "var(--muted)" }, stroke: "var(--line)" };

export default function LandTab({ land }: { land: any }) {
  if (!land) return <div className="card"><h3>Tracing 25 years of green cover…</h3><p className="muted">Fetching every 16-day MODIS composite since 2000. The first check in a new area can take a few minutes; it's cached after that.</p></div>;
  if (land.error) return <div className="card">Land history unavailable: {land.error}</div>;
  const season = land.seasonality.map((m: any) => ({ ...m, name: MONTHS[m.month - 1] }));
  const series = land.series.map((p: any) => ({ t: new Date(p.date).getTime(), ndvi: p.ndvi }));
  return (
    <div className="grid">
      <div className="card">
        <h3>{land.annual.length} years of your land, in one line</h3>
        <p className="big-text">{land.verdict}: {signed(land.changePct)}% green cover since {land.firstYear}.</p>
        <div className="mini-stats">
          <div><b>{signed(land.trendPerDecade, 3)}</b><span>NDVI per decade (Theil–Sen)</span></div>
          <div><b>p = {f(land.pValue, 3)}</b><span>Mann–Kendall trend test</span></div>
          <div><b>{land.croppingIntensity}</b><span>crop cycles a year</span></div>
          <div><b>{MONTHS[land.greenUpMonth - 1]} → {MONTHS[land.peakMonth - 1]}</b><span>green-up → peak</span></div>
          <div><b>{signed(land.recentAnomaly, 3)}</b><span>last 12 months vs normal</span></div>
          <div><b>{f(land.current.ndvi, 2)}</b><span>latest ({land.current.date}), {ordinal(Math.round(land.current.percentile * 100))} percentile for the month</span></div>
        </div>
        <p className="muted small">{land.source}. NDVI measures green leaf cover: bare soil about 0.1–0.2, sparse crop 0.3, dense healthy canopy 0.7 or more.</p>
      </div>
      <div className="card">
        <h3>Typical year <span className="muted small">mean NDVI by month</span></h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={season} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="name" {...axis} /><YAxis {...axis} domain={[0, "auto"]} width={40} />
            <Tooltip formatter={(v: any) => f(v, 2)} />
            <Line dataKey="ndvi" name="NDVI" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="card wide">
        <h3>Every 16 days since {land.firstYear}</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t) => String(new Date(t).getFullYear())} {...axis} />
            <YAxis {...axis} domain={[0, "auto"]} width={40} />
            <Tooltip labelFormatter={(t: any) => new Date(t).toLocaleDateString()} formatter={(v: any) => f(v, 2)} />
            <Line dataKey="ndvi" name="NDVI" stroke="var(--series-1)" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <h3>Annual mean</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={land.annual} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="year" {...axis} /><YAxis {...axis} domain={[0, "auto"]} width={40} />
            <Tooltip formatter={(v: any) => f(v, 3)} />
            <Bar dataKey="mean" name="Mean NDVI" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}
