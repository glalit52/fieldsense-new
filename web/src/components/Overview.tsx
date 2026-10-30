import { f, levelColor, MONTHS, scoreColor, signed } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";
import { useT } from "../lib/i18n.tsx";

export default function Overview({ r, land, go }: { r: Report; land: any; go: (t: any) => void }) {
  const t = useT();
  const ph = r.soil.topsoil.ph;
  const top = r.crops[0];
  const lime = r.lime;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - 4) / 5) * 100))}%`;
  return (
    <div className="grid">
      <div className="stats">
        <Stat label={t("Topsoil pH")} value={f(ph?.p50, 2)} sub={t("likely {low}–{high}", { low: f(ph?.p10, 1), high: f(ph?.p90, 1) })} onClick={() => go("soil")} />
        <Stat label={t("Rain a year")} value={`${f(r.climate.normals.rain, 0)} mm`} sub={t(r.climate.dryYearsInTen === 1 ? "{n} dry year in 10" : "{n} dry years in 10", { n: r.climate.dryYearsInTen })} onClick={() => go("climate")} />
        <Stat label={t("{crop}, good year", { crop: top.name })} value={`${f(top.yieldTPerHa.good, 1)} t`} sub={t("{value} t in a dry year", { value: f(top.yieldTPerHa.poor, 1) })} onClick={() => go("crops")} />
        <Stat label={t("Land since {year}", { year: land?.firstYear ?? 2000 })} value={land?.changePct != null ? `${signed(land.changePct)}%` : land?.error ? "–" : "…"} sub={land?.verdict ? t("{value} green cover", { value: land.verdict.toLowerCase() }) : land?.error ? t("unavailable") : t("loading MODIS")} onClick={() => go("land")} />
      </div>

      <div className="card">
        <h3>{t("Lime, in one answer")}</h3>
        <div className={`lime-call ${lime.call.replace(" ", "-").toLowerCase()}`}>{t(lime.call)}</div>
        <div className="ph-scale" aria-label={t("pH scale")}>
          <div className="band" style={{ left: pos(ph?.p10 ?? 6), width: `calc(${pos(ph?.p90 ?? 7)} - ${pos(ph?.p10 ?? 6)})` }} />
          <div className="mark" style={{ left: pos(ph?.p50 ?? 6.5) }} title={`pH ${f(ph?.p50, 2)}`} />
          <div className="line" style={{ left: pos(lime.threshold) }}><span>{t("lime line {value}", { value: lime.threshold })}</span></div>
          <div className="ticks">{[4, 5, 6, 7, 8, 9].map((v) => <span key={v} style={{ left: pos(v) }}>{v}</span>)}</div>
        </div>
        <p>{t("{n}% chance the topsoil is below pH {value}.", { n: (lime.probabilityBelowThreshold * 100).toFixed(0), value: lime.threshold })}
          {lime.call !== "None needed" && <> {withBold(t("Plan about {rate} (range {low}–{high}) to reach pH {value}.", { low: f(lime.rateTPerHa.low), high: f(lime.rateTPerHa.high), value: lime.targetPh }), "{rate}", `${f(lime.rateTPerHa.mid)} t/ha`)}</>}
          {lime.subsoilPh && <> {t("Subsoil pH {value}.", { value: f(lime.subsoilPh.p50, 1) })}</>}</p>
        <p className="muted small">{r.soil.source}</p>
      </div>

      <div className="card">
        <h3>{t("{n} crops, ranked for your ground", { n: r.crops.length })} <button className="link" onClick={() => go("crops")}>{t("all crops")} →</button></h3>
        <ol className="crop-list">
          {r.crops.slice(0, 6).map((c: any) => (
            <li key={c.id}>
              <span className="name">{c.name}</span>
              <span className="bar"><span style={{ width: `${c.score}%`, background: scoreColor(c.score) }} /></span>
              <span className="score">{c.score}</span>
              <span className="muted small">{t("{n}/10 good", { n: c.goodYearsInTen })} · {c.sowing ? t("sow {date}", { date: c.sowing.label }) : t("perennial")}{c.limiting[0] ? ` · ${c.limiting[0]}` : ""}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h3>{t("Risks")}</h3>
        <div className="risks">
          {r.risks.map((k: any) => (
            <div key={k.id} className="risk" title={k.detail}>
              <span className="dot" style={{ background: levelColor(k.level) }} />
              <b>{k.label}</b> <span className="muted">{t(k.level)}</span>
              <p className="small">{k.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {r.operations && (
        <div className="card">
          <h3>{t("This fortnight")} <button className="link" onClick={() => go("ops")}>{t("16-day plan")} →</button></h3>
          <ul className="alerts">{r.operations.alerts.map((a: any, i: number) => <li key={i} className={a.level}>{a.text}</li>)}</ul>
          {r.operations.soilWaterPct != null && <p className="small">{withBold(t("Topsoil water is about {value} of capacity."), "{value}", `${f(r.operations.soilWaterPct, 0)}%`)} {t("Next 7 days: {rain} mm rain against {et0} mm evaporative demand.", { rain: f(r.operations.waterBalance7d.rain, 0), et0: f(r.operations.waterBalance7d.et0, 0) })}</p>}
        </div>
      )}

      <div className="card">
        <h3>{t("Ten years of weather, replayed")}</h3>
        <div className="mini-stats">
          <div><b>{f(r.climate.normals.rain, 0)} mm</b><span>{t("rain a year")}</span></div>
          <div><b>{r.climate.frostLabel}</b><span>{t("frost nights ({n}/yr)", { n: f(r.climate.normals.frostNights, 0) })}</span></div>
          <div><b>{r.climate.dryYearsInTen}</b><span>{t("dry years in ten")}</span></div>
          <div><b>{t("{n} days", { n: f(r.climate.normals.longestDrySpell, 0) })}</b><span>{t("longest dry spell")}</span></div>
          <div><b>{f(r.climate.normals.hotDays, 0)}</b><span>{t("days over 35 °C a year")}</span></div>
          <div><b>{signed(r.climate.trends.tempPerDecade, 2)} °C</b><span>{t("warming per decade")}</span></div>
        </div>
        <p className="muted small">{r.climate.normals.climateClass}. {t("Wettest month {value}.", { value: t(MONTHS[r.climate.monthly.reduce((b: any, m: any) => (m.rain > b.rain ? m : b)).month - 1]) })}</p>
      </div>

      <details className="card sources">
        <summary>{t("Where every number comes from")}</summary>
        <dl>{Object.entries(r.sources).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
        <p className="muted small">{t("Generated {date} in {n} s.", { date: new Date(r.generatedAt).toLocaleString(), n: (r.timings.totalMs / 1000).toFixed(1) })} {t("Yields are attainable yields under good management for past seasons' weather, not forecasts.")} {t("Lime rates are planning estimates, not prescriptions.")}</p>
      </details>
    </div>
  );
}

/** A translated sentence with one placeholder rendered in bold. */
function withBold(text: string, token: string, value: string) {
  const [pre, post] = text.split(token);
  return <>{pre}<b>{value}</b>{post}</>;
}

function Stat({ label, value, sub, onClick }: { label: string; value: string; sub: string; onClick?: () => void }) {
  return (
    <button className="stat" onClick={onClick}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      <span className="sub">{sub}</span>
    </button>
  );
}
