import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { f, MONTHS, signed } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";
import { useT } from "../lib/i18n.tsx";

const axis = { tick: { fontSize: 11, fill: "var(--muted)" }, stroke: "var(--line)" };

export default function ClimateTab({ r }: { r: Report }) {
  const t = useT();
  const c = r.climate;
  const monthly = c.monthly.map((m: any) => ({ ...m, name: t(MONTHS[m.month - 1]), range: [m.rainP20, m.rainP80] }));
  const med = [...c.years.map((y: any) => y.rain)].sort((a, b) => a - b)[Math.floor(c.years.length / 2)];
  return (
    <div className="grid">
      <div className="card">
        <h3>{c.normals.climateClass}</h3>
        <div className="mini-stats">
          <div><b>{f(c.normals.rain, 0)} mm</b><span>{t("mean annual rain")}</span></div>
          <div><b>{f(c.normals.et0, 0)} mm</b><span>{t("evaporative demand (ET₀)")}</span></div>
          <div><b>{f(c.normals.aridityIndex, 2)}</b><span>{t("aridity index (rain / ET₀)")}</span></div>
          <div><b>{f(c.normals.tmean, 1)} °C</b><span>{t("mean temperature")}</span></div>
          <div><b>{c.normals.frostFreeDays ?? "–"}</b><span>{t("frost-free days")}</span></div>
          <div><b>{c.dryYearsInTen} / {c.wetYearsInTen}</b><span>{t("dry / wet years in last 10")}</span></div>
        </div>
        <h4>{t("Trends since {year}", { year: c.years[0].year })}</h4>
        <ul className="small">
          <li>{t(c.trends.tempP < 0.05 ? "Temperature {value} °C per decade (significant)" : "Temperature {value} °C per decade (not significant)", { value: signed(c.trends.tempPerDecade, 2) })}</li>
          <li>{t(c.trends.rainP < 0.05 ? "Rainfall {value} mm per decade (significant)" : "Rainfall {value} mm per decade (not significant)", { value: signed(c.trends.rainPerDecade, 0) })}</li>
          <li>{t("Hot days {hot} per decade · frost nights {frost} per decade", { hot: signed(c.trends.hotDaysPerDecade, 1), frost: signed(c.trends.frostPerDecade, 1) })}</li>
        </ul>
      </div>

      <div className="card">
        <h3>{t("Monthly rain")} <span className="muted small">{t("mean, with the 20–80% band of years")}</span></h3>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="name" {...axis} /><YAxis {...axis} unit=" mm" width={56} />
            <Tooltip formatter={(v: any, n: any) => [Array.isArray(v) ? `${f(v[0], 0)}–${f(v[1], 0)} mm` : `${f(v, 0)} mm`, n]} />
            <Bar dataKey="range" name={t("20–80% of years")} fill="var(--series-1-soft)" radius={[4, 4, 0, 0]} />
            <Line dataKey="rain" name={t("Mean")} stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
        <h3>{t("Monthly temperature")}</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="name" {...axis} /><YAxis {...axis} unit="°" width={44} />
            <Tooltip formatter={(v: any) => `${f(v, 1)} °C`} /><Legend />
            <Line dataKey="tmax" name={t("Mean max")} stroke="var(--series-2)" strokeWidth={2} dot={false} />
            <Line dataKey="tmin" name={t("Mean min")} stroke="var(--series-3)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card wide">
        <h3>{t("{n} years of rain", { n: c.years.length })} <span className="muted small">{t("dashed line = median {value} mm", { value: f(med, 0) })}</span></h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={c.years} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="year" {...axis} /><YAxis {...axis} width={44} />
            <Tooltip formatter={(v: any) => `${f(v, 0)} mm`} />
            <ReferenceLine y={med} stroke="var(--muted)" strokeDasharray="4 4" />
            <Bar dataKey="rain" name={t("Annual rain")} fill="var(--series-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="table-scroll">
          <table className="ops small">
            <thead><tr><th>{t("Year")}</th><th>{t("Rain")}</th><th>{t("Frost nights")}</th><th>{t("Days ≥35 °C")}</th><th>{t("Longest dry spell")}</th><th>{t("Heavy-rain days")}</th><th>{t("GDD (base 5)")}</th></tr></thead>
            <tbody>{[...c.years].reverse().slice(0, 12).map((y: any) => (
              <tr key={y.year}><td>{y.year}</td><td>{f(y.rain, 0)} mm</td><td>{y.frostNights}</td><td>{y.hotDays}</td><td>{y.longestDrySpell} d</td><td>{y.heavyRainDays}</td><td>{f(y.gdd5, 0)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {c.agreement?.length > 0 && (
        <div className="card">
          <h3>{t("Rain cross-check")}</h3>
          <p className="small">{t("ERA5 annual mean {value} mm, compared with independent sources over the same years:", { value: f(c.normals.rain, 0) })}</p>
          <ul className="small">{c.agreement.map((a: any) => <li key={a.source}>{a.source}: {f(a.meanAnnualRain, 0)} mm ({signed(a.differencePct, 1)}%)</li>)}</ul>
          <p className="muted small">{t("Sources:")} {c.sources.join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
