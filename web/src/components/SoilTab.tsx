import { useState } from "react";
import { f } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";
import { useT } from "../lib/i18n.tsx";

const PROPS: [string, string, string, number][] = [
  ["ph", "pH (water)", "", 2], ["soc", "Organic carbon", "g/kg", 1], ["clay", "Clay", "%", 0], ["sand", "Sand", "%", 0], ["silt", "Silt", "%", 0],
  ["cec", "CEC", "cmol/kg", 1], ["nitrogen", "Total nitrogen", "g/kg", 2], ["bdod", "Bulk density", "g/cm³", 2], ["cfvo", "Stones", "vol %", 0],
];

export default function SoilTab({ r, onLab, onLime }: { r: Report; onLab: (lab: any) => void; onLime: (o: { limeTargetPh?: number; limeDepthCm?: number }) => void }) {
  const t = useT();
  const s = r.soil, lime = r.lime;
  const [lab, setLab] = useState({ ph: "", organicCarbon: "", clay: "" });
  const [target, setTarget] = useState(String(lime.targetPh));
  const [depth, setDepth] = useState("10");
  return (
    <div className="grid">
      <div className={`card ${s.confidence === "low" ? "warn-card" : ""}`}>
        <h3>{t("Your soil")}</h3>
        <p className="big-text">{t("{texture} topsoil over {sub} subsoil, {drainage} drainage.", { texture: s.texture, sub: s.textureSub.toLowerCase(), drainage: s.drainage })}</p>
        <div className="mini-stats">
          <div><b>{f(s.awcMmPerM, 0)} mm/m</b><span>{t("plant-available water")}</span></div>
          <div><b>{f(s.organicMatterPct, 1)}%</b><span>{t("organic matter")}</span></div>
          <div><b>{f(s.carbonStockTPerHa30, 0)} t C/ha</b><span>{t("carbon stock, 0–30 cm")}</span></div>
          <div><b>{f(s.fieldCapacity * 100, 0)}% / {f(s.wiltingPoint * 100, 0)}%</b><span>{t("field capacity / wilting point")}</span></div>
        </div>
        <p className="muted small">{t("Source: {value}.", { value: s.source })} {t("Confidence: {value}.", { value: t(s.confidence) })}{s.errors?.length ? ` (${s.errors.join("; ")})` : ""}</p>
      </div>

      <div className="card">
        <h3>{t("Soil profile, with 80% ranges")}</h3>
        <table className="soil-table">
          <thead><tr><th>{t("Property")}</th><th>{t("Topsoil 0–30 cm")}</th><th>{t("Subsoil 30–100 cm")}</th></tr></thead>
          <tbody>
            {PROPS.map(([k, label, unit, d]) => (
              <tr key={k}>
                <td>{t(label)} {unit && <span className="muted small">{unit}</span>}</td>
                <td><Range v={s.topsoil[k]} d={d} /></td>
                <td><Range v={s.subsoil[k]} d={d} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t("Phosphorus and potassium can't be mapped reliably from space.")} {t("Measure them with a soil test.")}</p>
      </div>

      <div className="card">
        <h3>{t("Lime calculator")}</h3>
        <p><b>{t(lime.call)}</b>: {t("{n}% chance the topsoil pH is below {value}.", { n: (lime.probabilityBelowThreshold * 100).toFixed(0), value: lime.threshold })} {t("Buffer capacity about {value} cmol/kg per pH unit.", { value: f(lime.bufferCapacity, 2) })}</p>
        <div className="form-row">
          <label>{t("Target pH")} <input type="number" step="0.1" min="5" max="7.5" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          <label>{t("Incorporation depth (cm)")} <input type="number" min="5" max="40" value={depth} onChange={(e) => setDepth(e.target.value)} /></label>
          <button onClick={() => onLime({ limeTargetPh: Number(target), limeDepthCm: Number(depth) })}>{t("Recalculate")}</button>
        </div>
        <p>{withBold(t("Estimated lime (CaCO₃ equivalent, NV 95%): {rate}, range {low}–{high} t/ha.", { low: f(lime.rateTPerHa.low), high: f(lime.rateTPerHa.high) }), "{rate}", `${f(lime.rateTPerHa.mid)} t/ha`)}</p>
        <ul className="small">{lime.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
      </div>

      <div className="card">
        <h3>{t("Have a soil test? Make it exact.")}</h3>
        <p className="small">{t("Enter lab or test-kit values.")} {t("FieldSense replaces the map estimate and re-runs the lime call and all 67 crop scores.")}</p>
        <form className="form-row" onSubmit={(e) => { e.preventDefault(); onLab({ ph: num(lab.ph), organicCarbon: num(lab.organicCarbon), clay: num(lab.clay) }); }}>
          <label>{t("pH (water)")} <input inputMode="decimal" value={lab.ph} onChange={(e) => setLab({ ...lab, ph: e.target.value })} placeholder={f(s.topsoil.ph?.p50, 1)} /></label>
          <label>{t("Organic carbon %")} <input inputMode="decimal" value={lab.organicCarbon} onChange={(e) => setLab({ ...lab, organicCarbon: e.target.value })} placeholder={f((s.topsoil.soc?.p50 ?? 0) / 10, 1)} /></label>
          <label>{t("Clay %")} <input inputMode="decimal" value={lab.clay} onChange={(e) => setLab({ ...lab, clay: e.target.value })} placeholder={f(s.topsoil.clay?.p50, 0)} /></label>
          <button className="primary" type="submit">{t("Use my test")}</button>
        </form>
        {s.labOverride && <p className="ok-text small">✓ {t("This report uses your lab values.")}</p>}
      </div>
    </div>
  );
}

const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

/** A translated sentence with one placeholder rendered in bold. */
function withBold(text: string, token: string, value: string) {
  const [pre, post] = text.split(token);
  return <>{pre}<b>{value}</b>{post}</>;
}

function Range({ v, d }: { v?: { p10: number; p50: number; p90: number }; d: number }) {
  if (!v) return <span className="muted">–</span>;
  return <span><b>{f(v.p50, d)}</b> <span className="muted small">({f(v.p10, d)}–{f(v.p90, d)})</span></span>;
}
