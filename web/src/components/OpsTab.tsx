import { f, wx } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";
import { useDateFormat, useT } from "../lib/i18n.tsx";

export default function OpsTab({ r }: { r: Report }) {
  const t = useT(), fmt = useDateFormat();
  const o = r.operations;
  if (!o) return <div className="card">{t("Forecast unavailable right now.")}</div>;
  const days = o.days.filter((d: any) => !d.past);
  return (
    <div className="grid">
      <div className="card">
        <h3>{t("Alerts")}</h3>
        <ul className="alerts">{o.alerts.length ? o.alerts.map((a: any, i: number) => <li key={i} className={a.level}>{a.text}</li>) : <li className="info">{t("No frost, heat, wind or disease alerts in the next 16 days.")}</li>}</ul>
        <div className="mini-stats">
          <div><b>{f(o.soilWaterPct, 0)}%</b><span>{t("topsoil water now (of capacity)")}</span></div>
          <div><b>{f(o.soilTemp, 1)} °C</b><span>{t("soil at 6 cm, next 3 days")}</span></div>
          <div><b>{f(o.waterBalance7d.rain, 0)} mm</b><span>{t("rain, next 7 days")}</span></div>
          <div><b>{f(o.waterBalance7d.deficit, 0)} mm</b><span>{t("7-day water deficit (ET₀ − rain)")}</span></div>
        </div>
      </div>
      <div className="card wide">
        <h3>{t("16-day field operations plan")} <span className="muted small">{t("times in {value}", { value: o.timezone })}</span></h3>
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th>{t("Day")}</th><th></th><th>{t("Max / min")}</th><th>{t("Rain")}</th><th>ET₀</th><th>{t("Wind / gust")}</th><th>{t("Spray windows")}</th><th>{t("Disease")}</th><th>{t("Frost")}</th><th>{t("Workable")}</th></tr></thead>
            <tbody>
              {days.map((d: any) => (
                <tr key={d.date}>
                  <td>{fmt(d.date)}</td>
                  <td className="wx">{wx(d.weatherCode)}</td>
                  <td><b>{f(d.tmax, 0)}°</b> / {f(d.tmin, 0)}°{d.heat && <span className="tag bad">{t("heat")}</span>}</td>
                  <td>{f(d.rain, 1)} mm{d.rainProb != null && <span className="muted small"> {d.rainProb}%</span>}</td>
                  <td>{f(d.et0, 1)}</td>
                  <td>{f(d.windMax, 0)} / {f(d.gust, 0)} km/h</td>
                  <td className="small">{d.sprayWindows.length ? d.sprayWindows.map((w: any, i: number) => <span key={i} className={`tag ${w.quality === "good" ? "good" : "warn"}`}>{w.from}–{w.to}</span>) : <span className="muted">{t("none")}</span>}</td>
                  <td><span className={`tag ${d.diseaseRisk === "high" ? "bad" : d.diseaseRisk === "moderate" ? "warn" : "good"}`}>{t(d.diseaseRisk)}</span>{d.smithPeriod && <span className="tag bad">{t("blight")}</span>}<span className="muted small"> {t("{n} h wet", { n: d.leafWetHours })}</span></td>
                  <td>{d.frost === "none" ? <span className="muted">–</span> : <span className={`tag ${d.frost === "hard" ? "bad" : "warn"}`}>{d.frost}</span>}</td>
                  <td>{d.workable ? "✓" : <span className="muted">{t("too wet")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t("Spray windows: daylight, wind 3–15 km/h, Delta T 2–8 (good) or 8–10 (marginal), under 30 °C, no rain within 4 h.")} {t("Disease risk counts leaf-wetness hours at 8–28 °C.")} {t("Blight uses Smith periods (two days with min ≥10 °C and ≥11 h at RH ≥90%).")}</p>
      </div>
      {r.seasonal && (
        <div className="card wide">
          <h3>{t("Seasonal outlook")} <span className="muted small">{t("ECMWF SEAS5, 51 members")}</span></h3>
          <div className="table-scroll">
            <table className="ops">
              <thead><tr><th>{t("Month")}</th><th>{t("Rain (dry · median · wet member)")}</th><th>{t("Normal rain")}</th><th>{t("Mean max / min")}</th></tr></thead>
              <tbody>{r.seasonal.filter((m: any) => m.days >= 20).map((m: any) => {
                const normal = r.climate.monthly[Number(m.month.slice(5, 7)) - 1];
                const ratio = m.rainMedian / Math.max(1, normal.rain);
                return (
                  <tr key={m.month}>
                    <td>{fmt(m.month + "-15", { month: "long", year: "numeric" })}</td>
                    <td>{f(m.rainP10, 0)} · <b>{f(m.rainMedian, 0)}</b> · {f(m.rainP90, 0)} mm <span className={`tag ${ratio < 0.75 ? "bad" : ratio > 1.25 ? "good" : ""}`}>{ratio < 0.75 ? t("drier") : ratio > 1.25 ? t("wetter") : t("near normal")}</span></td>
                    <td>{f(normal.rain, 0)} mm</td>
                    <td>{f(m.tmax, 1)}° / {f(m.tmin, 1)}° <span className="muted small">{t("(normal {max}° / {min}°)", { max: f(normal.tmax, 1), min: f(normal.tmin, 1) })}</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <p className="muted small">{t("Seasonal models have modest skill outside the tropics.")} {t("Use them as a lean, not a forecast.")} {t("Raw model output, not bias-corrected.")}</p>
        </div>
      )}
    </div>
  );
}
