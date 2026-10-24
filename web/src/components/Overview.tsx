import { f, levelColor, MONTHS, scoreColor, signed } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";

export default function Overview({ r, land, go }: { r: Report; land: any; go: (t: any) => void }) {
  const ph = r.soil.topsoil.ph;
  const top = r.crops[0];
  const lime = r.lime;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - 4) / 5) * 100))}%`;
  return (
    <div className="grid">
      <div className="stats">
        <Stat label="Topsoil pH" value={f(ph?.p50, 2)} sub={`likely ${f(ph?.p10, 1)}–${f(ph?.p90, 1)}`} onClick={() => go("soil")} />
        <Stat label="Rain a year" value={`${f(r.climate.normals.rain, 0)} mm`} sub={`${r.climate.dryYearsInTen} dry year${r.climate.dryYearsInTen === 1 ? "" : "s"} in 10`} onClick={() => go("climate")} />
        <Stat label={`${top.name}, good year`} value={`${f(top.yieldTPerHa.good, 1)} t`} sub={`${f(top.yieldTPerHa.poor, 1)} t in a dry year`} onClick={() => go("crops")} />
        <Stat label={`Land since ${land?.firstYear ?? 2000}`} value={land?.changePct != null ? `${signed(land.changePct)}%` : land?.error ? "–" : "…"} sub={land?.verdict ? `${land.verdict.toLowerCase()} green cover` : land?.error ? "unavailable" : "loading MODIS"} onClick={() => go("land")} />
      </div>

      <div className="card">
        <h3>Lime, in one answer</h3>
        <div className={`lime-call ${lime.call.replace(" ", "-").toLowerCase()}`}>{lime.call}</div>
        <div className="ph-scale" aria-label="pH scale">
          <div className="band" style={{ left: pos(ph?.p10 ?? 6), width: `calc(${pos(ph?.p90 ?? 7)} - ${pos(ph?.p10 ?? 6)})` }} />
          <div className="mark" style={{ left: pos(ph?.p50 ?? 6.5) }} title={`pH ${f(ph?.p50, 2)}`} />
          <div className="line" style={{ left: pos(lime.threshold) }}><span>lime line {lime.threshold}</span></div>
          <div className="ticks">{[4, 5, 6, 7, 8, 9].map((t) => <span key={t} style={{ left: pos(t) }}>{t}</span>)}</div>
        </div>
        <p>{(lime.probabilityBelowThreshold * 100).toFixed(0)}% chance the topsoil is below pH {lime.threshold}.
          {lime.call !== "None needed" && <> Plan about <b>{f(lime.rateTPerHa.mid)} t/ha</b> (range {f(lime.rateTPerHa.low)}–{f(lime.rateTPerHa.high)}) to reach pH {lime.targetPh}.</>}
          {lime.subsoilPh && <> Subsoil pH {f(lime.subsoilPh.p50, 1)}.</>}</p>
        <p className="muted small">{r.soil.source}</p>
      </div>

      <div className="card">
        <h3>{r.crops.length} crops, ranked for your ground <button className="link" onClick={() => go("crops")}>all crops →</button></h3>
        <ol className="crop-list">
          {r.crops.slice(0, 6).map((c: any) => (
            <li key={c.id}>
              <span className="name">{c.name}</span>
              <span className="bar"><span style={{ width: `${c.score}%`, background: scoreColor(c.score) }} /></span>
              <span className="score">{c.score}</span>
              <span className="muted small">{c.goodYearsInTen}/10 good · {c.sowing ? `sow ${c.sowing.label}` : "perennial"}{c.limiting[0] ? ` · ${c.limiting[0]}` : ""}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h3>Risks</h3>
        <div className="risks">
          {r.risks.map((k: any) => (
            <div key={k.id} className="risk" title={k.detail}>
              <span className="dot" style={{ background: levelColor(k.level) }} />
              <b>{k.label}</b> <span className="muted">{k.level}</span>
              <p className="small">{k.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {r.operations && (
        <div className="card">
          <h3>This fortnight <button className="link" onClick={() => go("ops")}>16-day plan →</button></h3>
          <ul className="alerts">{r.operations.alerts.map((a: any, i: number) => <li key={i} className={a.level}>{a.text}</li>)}</ul>
          {r.operations.soilWaterPct != null && <p className="small">Topsoil water is about <b>{f(r.operations.soilWaterPct, 0)}%</b> of capacity. Next 7 days: {f(r.operations.waterBalance7d.rain, 0)} mm rain against {f(r.operations.waterBalance7d.et0, 0)} mm evaporative demand.</p>}
        </div>
      )}

      <div className="card">
        <h3>Ten years of weather, replayed</h3>
        <div className="mini-stats">
          <div><b>{f(r.climate.normals.rain, 0)} mm</b><span>rain a year</span></div>
          <div><b>{r.climate.frostLabel}</b><span>frost nights ({f(r.climate.normals.frostNights, 0)}/yr)</span></div>
          <div><b>{r.climate.dryYearsInTen}</b><span>dry years in ten</span></div>
          <div><b>{f(r.climate.normals.longestDrySpell, 0)} days</b><span>longest dry spell</span></div>
          <div><b>{f(r.climate.normals.hotDays, 0)}</b><span>days over 35 °C a year</span></div>
          <div><b>{signed(r.climate.trends.tempPerDecade, 2)} °C</b><span>warming per decade</span></div>
        </div>
        <p className="muted small">{r.climate.normals.climateClass}. Wettest month {MONTHS[r.climate.monthly.reduce((b: any, m: any) => (m.rain > b.rain ? m : b)).month - 1]}.</p>
      </div>

      <details className="card sources">
        <summary>Where every number comes from</summary>
        <dl>{Object.entries(r.sources).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
        <p className="muted small">Generated {new Date(r.generatedAt).toLocaleString()} in {(r.timings.totalMs / 1000).toFixed(1)} s. Yields are attainable yields under good management for past seasons' weather, not forecasts. Lime rates are planning estimates, not prescriptions.</p>
      </details>
    </div>
  );
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
