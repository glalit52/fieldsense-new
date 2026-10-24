import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { f, MONTHS, signed } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";

const axis = { tick: { fontSize: 11, fill: "var(--muted)" }, stroke: "var(--line)" };

export default function ClimateTab({ r }: { r: Report }) {
  const c = r.climate;
  const monthly = c.monthly.map((m: any) => ({ ...m, name: MONTHS[m.month - 1], range: [m.rainP20, m.rainP80] }));
  const med = [...c.years.map((y: any) => y.rain)].sort((a, b) => a - b)[Math.floor(c.years.length / 2)];
  return (
    <div className="grid">
      <div className="card">
        <h3>{c.normals.climateClass}</h3>
        <div className="mini-stats">
          <div><b>{f(c.normals.rain, 0)} mm</b><span>mean annual rain</span></div>
          <div><b>{f(c.normals.et0, 0)} mm</b><span>evaporative demand (ET₀)</span></div>
          <div><b>{f(c.normals.aridityIndex, 2)}</b><span>aridity index (rain / ET₀)</span></div>
          <div><b>{f(c.normals.tmean, 1)} °C</b><span>mean temperature</span></div>
          <div><b>{c.normals.frostFreeDays ?? "–"}</b><span>frost-free days</span></div>
          <div><b>{c.dryYearsInTen} / {c.wetYearsInTen}</b><span>dry / wet years in last 10</span></div>
        </div>
        <h4>Trends since {c.years[0].year}</h4>
        <ul className="small">
          <li>Temperature {signed(c.trends.tempPerDecade, 2)} °C per decade {c.trends.tempP < 0.05 ? "(significant)" : "(not significant)"}</li>
          <li>Rainfall {signed(c.trends.rainPerDecade, 0)} mm per decade {c.trends.rainP < 0.05 ? "(significant)" : "(not significant)"}</li>
          <li>Hot days {signed(c.trends.hotDaysPerDecade, 1)} per decade · frost nights {signed(c.trends.frostPerDecade, 1)} per decade</li>
        </ul>
      </div>

      <div className="card">
        <h3>Monthly rain <span className="muted small">mean, with the 20–80% band of years</span></h3>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="name" {...axis} /><YAxis {...axis} unit=" mm" width={56} />
            <Tooltip formatter={(v: any, n: any) => [Array.isArray(v) ? `${f(v[0], 0)}–${f(v[1], 0)} mm` : `${f(v, 0)} mm`, n]} />
            <Bar dataKey="range" name="20–80% of years" fill="var(--series-1-soft)" radius={[4, 4, 0, 0]} />
            <Line dataKey="rain" name="Mean" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
        <h3>Monthly temperature</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="name" {...axis} /><YAxis {...axis} unit="°" width={44} />
            <Tooltip formatter={(v: any) => `${f(v, 1)} °C`} /><Legend />
            <Line dataKey="tmax" name="Mean max" stroke="var(--series-2)" strokeWidth={2} dot={false} />
            <Line dataKey="tmin" name="Mean min" stroke="var(--series-3)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card wide">
        <h3>{c.years.length} years of rain <span className="muted small">dashed line = median {f(med, 0)} mm</span></h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={c.years} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="year" {...axis} /><YAxis {...axis} width={44} />
            <Tooltip formatter={(v: any) => `${f(v, 0)} mm`} />
            <ReferenceLine y={med} stroke="var(--muted)" strokeDasharray="4 4" />
            <Bar dataKey="rain" name="Annual rain" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="table-scroll">
          <table className="ops small">
            <thead><tr><th>Year</th><th>Rain</th><th>Frost nights</th><th>Days ≥35 °C</th><th>Longest dry spell</th><th>Heavy-rain days</th><th>GDD (base 5)</th></tr></thead>
            <tbody>{[...c.years].reverse().slice(0, 12).map((y: any) => (
              <tr key={y.year}><td>{y.year}</td><td>{f(y.rain, 0)} mm</td><td>{y.frostNights}</td><td>{y.hotDays}</td><td>{y.longestDrySpell} d</td><td>{y.heavyRainDays}</td><td>{f(y.gdd5, 0)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {c.agreement?.length > 0 && (
        <div className="card">
          <h3>Rain cross-check</h3>
          <p className="small">ERA5 annual mean {f(c.normals.rain, 0)} mm, compared with independent sources over the same years:</p>
          <ul className="small">{c.agreement.map((a: any) => <li key={a.source}>{a.source}: {f(a.meanAnnualRain, 0)} mm ({signed(a.differencePct, 1)}%)</li>)}</ul>
          <p className="muted small">Sources: {c.sources.join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
