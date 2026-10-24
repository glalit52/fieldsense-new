import { dayLabel, f, wx } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";

export default function OpsTab({ r }: { r: Report }) {
  const o = r.operations;
  if (!o) return <div className="card">Forecast unavailable right now.</div>;
  const days = o.days.filter((d: any) => !d.past);
  return (
    <div className="grid">
      <div className="card">
        <h3>Alerts</h3>
        <ul className="alerts">{o.alerts.length ? o.alerts.map((a: any, i: number) => <li key={i} className={a.level}>{a.text}</li>) : <li className="info">No frost, heat, wind or disease alerts in the next 16 days.</li>}</ul>
        <div className="mini-stats">
          <div><b>{f(o.soilWaterPct, 0)}%</b><span>topsoil water now (of capacity)</span></div>
          <div><b>{f(o.soilTemp, 1)} °C</b><span>soil at 6 cm, next 3 days</span></div>
          <div><b>{f(o.waterBalance7d.rain, 0)} mm</b><span>rain, next 7 days</span></div>
          <div><b>{f(o.waterBalance7d.deficit, 0)} mm</b><span>7-day water deficit (ET₀ − rain)</span></div>
        </div>
      </div>
      <div className="card wide">
        <h3>16-day field operations plan <span className="muted small">times in {o.timezone}</span></h3>
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th>Day</th><th></th><th>Max / min</th><th>Rain</th><th>ET₀</th><th>Wind / gust</th><th>Spray windows</th><th>Disease</th><th>Frost</th><th>Workable</th></tr></thead>
            <tbody>
              {days.map((d: any) => (
                <tr key={d.date}>
                  <td>{dayLabel(d.date)}</td>
                  <td className="wx">{wx(d.weatherCode)}</td>
                  <td><b>{f(d.tmax, 0)}°</b> / {f(d.tmin, 0)}°{d.heat && <span className="tag bad">heat</span>}</td>
                  <td>{f(d.rain, 1)} mm{d.rainProb != null && <span className="muted small"> {d.rainProb}%</span>}</td>
                  <td>{f(d.et0, 1)}</td>
                  <td>{f(d.windMax, 0)} / {f(d.gust, 0)} km/h</td>
                  <td className="small">{d.sprayWindows.length ? d.sprayWindows.map((w: any, i: number) => <span key={i} className={`tag ${w.quality === "good" ? "good" : "warn"}`}>{w.from}–{w.to}</span>) : <span className="muted">none</span>}</td>
                  <td><span className={`tag ${d.diseaseRisk === "high" ? "bad" : d.diseaseRisk === "moderate" ? "warn" : "good"}`}>{d.diseaseRisk}</span>{d.smithPeriod && <span className="tag bad">blight</span>}<span className="muted small"> {d.leafWetHours} h wet</span></td>
                  <td>{d.frost === "none" ? <span className="muted">–</span> : <span className={`tag ${d.frost === "hard" ? "bad" : "warn"}`}>{d.frost}</span>}</td>
                  <td>{d.workable ? "✓" : <span className="muted">too wet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Spray windows: daylight, wind 3–15 km/h, Delta T 2–8 (good) or 8–10 (marginal), under 30 °C, no rain within 4 h. Disease risk counts leaf-wetness hours at 8–28 °C. Blight uses Smith periods (two days with min ≥10 °C and ≥11 h at RH ≥90%).</p>
      </div>
      {r.seasonal && (
        <div className="card wide">
          <h3>Seasonal outlook <span className="muted small">ECMWF SEAS5, 51 members</span></h3>
          <div className="table-scroll">
            <table className="ops">
              <thead><tr><th>Month</th><th>Rain (dry · median · wet member)</th><th>Normal rain</th><th>Mean max / min</th></tr></thead>
              <tbody>{r.seasonal.filter((m: any) => m.days >= 20).map((m: any) => {
                const normal = r.climate.monthly[Number(m.month.slice(5, 7)) - 1];
                const ratio = m.rainMedian / Math.max(1, normal.rain);
                return (
                  <tr key={m.month}>
                    <td>{new Date(m.month + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</td>
                    <td>{f(m.rainP10, 0)} · <b>{f(m.rainMedian, 0)}</b> · {f(m.rainP90, 0)} mm <span className={`tag ${ratio < 0.75 ? "bad" : ratio > 1.25 ? "good" : ""}`}>{ratio < 0.75 ? "drier" : ratio > 1.25 ? "wetter" : "near normal"}</span></td>
                    <td>{f(normal.rain, 0)} mm</td>
                    <td>{f(m.tmax, 1)}° / {f(m.tmin, 1)}° <span className="muted small">(normal {f(normal.tmax, 1)}° / {f(normal.tmin, 1)}°)</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <p className="muted small">Seasonal models have modest skill outside the tropics. Use them as a lean, not a forecast. Raw model output, not bias-corrected.</p>
        </div>
      )}
    </div>
  );
}
