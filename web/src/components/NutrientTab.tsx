import { useEffect, useState } from "react";
import { api, type NutrientPlan, type Report, type SavedField } from "../lib/api.ts";
import { money, usePrices } from "../lib/economics.ts";
import { f } from "../lib/format.ts";
import { useDateFormat, useT } from "../lib/i18n.tsx";

/** Bag sizes sold in India, for "how many bags" (kg). */
const BAG: Record<string, number> = { Urea: 45, DAP: 50, "MOP (potash)": 50 };

/** N-P-K plan for a crop on this field: nutrients, products, a dated split schedule and its cost; logs to the journal. */
export default function NutrientTab({ r, reportId, cropId, onCropId, field, onLogged }: {
  r: Report; reportId: string; cropId?: string; onCropId: (id: string) => void;
  field?: SavedField; onLogged: () => void;
}) {
  const t = useT(), fmt = useDateFormat();
  const { prices, fertPrice, update } = usePrices();
  const lab = field?.tests.find((x) => x.p != null || x.k != null);
  const crops = r.crops.filter((c: any) => c.score > 0 || c.irrigatedScore > 0);
  const [crop, setCrop] = useState<string>(cropId ?? r.selectedCrop ?? crops.find((c: any) => c.group !== "Forage")?.id ?? crops[0]?.id);
  const [target, setTarget] = useState("");
  const [p, setP] = useState(lab?.p != null ? String(lab.p) : "");
  const [k, setK] = useState(lab?.k != null ? String(lab.k) : "");
  const [sowing, setSowing] = useState("");
  const [plan, setPlan] = useState<NutrientPlan | null>(null);
  const [error, setError] = useState("");
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const area: number | null = r.location.areaHa ?? null;
  const cur = prices.currency;

  useEffect(() => { if (cropId && cropId !== crop) { setCrop(cropId); setTarget(""); setSowing(""); } }, [cropId]);
  useEffect(() => {
    const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
    const timer = setTimeout(() => {
      setError("");
      api.nutrients({ reportId, cropId: crop, targetYield: num(target), p: num(p), k: num(k), sowingDate: sowing || undefined })
        .then((x) => { setPlan(x); setLogged(false); })
        .catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [reportId, crop, target, p, k, sowing]);

  const productCost = (name: string, kg: number) => kg * fertPrice(name);
  const costPerHa = plan ? plan.products.reduce((s, x) => s + productCost(x.name, x.kgPerHa), 0) : 0;

  const logToJournal = async () => {
    if (!field || !plan) return;
    setLogging(true); setError("");
    try {
      for (const a of plan.applications) for (const x of a.products) {
        await api.addActivity(field.id, {
          date: a.date, type: "fertiliser", crop: plan.crop.name, product: `${x.name} ${x.grade}`, quantity: String(x.kgPerHa), unit: "kg/ha",
          cost: String(Math.round(productCost(x.name, x.kgPerHa) * (area ?? 1))), notes: `${t("Planned")}: ${t(a.stage)}`,
        });
      }
      setLogged(true);
      onLogged();
    } catch (e: any) { setError(e.message); } finally { setLogging(false); }
  };

  return (
    <div className="card wide">
      <div className="form-row">
        <label>{t("Crop")}
          <select value={crop} onChange={(e) => { setCrop(e.target.value); onCropId(e.target.value); setTarget(""); setSowing(""); }}>
            {crops.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>{t("Target yield t/ha")} <input inputMode="decimal" style={{ width: 80 }} placeholder={plan ? f(plan.targetYield, 1) : ""} value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label>{t("Lab P (Olsen) mg/kg")} <input inputMode="decimal" style={{ width: 80 }} value={p} onChange={(e) => setP(e.target.value)} /></label>
        <label>{t("Lab K mg/kg")} <input inputMode="decimal" style={{ width: 80 }} value={k} onChange={(e) => setK(e.target.value)} /></label>
        <label>{t("Sowing date")} <input type="date" value={sowing || plan?.applications[0]?.date || ""} onChange={(e) => setSowing(e.target.value)} /></label>
      </div>
      {lab && <p className="muted small">{t("Using the lab test from {date}.", { date: lab.date })}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {plan && (
        <>
          <div className="stats">
            <div className="stat card"><span className="label">{t("Nitrogen (N)")}</span><span className="value">{plan.nutrients.n} <small>kg/ha</small></span>
              <span className="sub">{plan.basis.legume ? t("starter only: fixes its own N") : t("soil supplies ~{n} kg", { n: plan.basis.nSupplyKgHa })}</span></div>
            <div className="stat card"><span className="label">{t("Phosphate (P₂O₅)")}</span><span className="value">{plan.nutrients.p2o5} <small>kg/ha</small></span>
              <span className="sub">{plan.basis.pClass ? t("soil P {cls}", { cls: t(plan.basis.pClass) }) : t("no lab P: medium assumed")}</span></div>
            <div className="stat card"><span className="label">{t("Potash (K₂O)")}</span><span className="value">{plan.nutrients.k2o} <small>kg/ha</small></span>
              <span className="sub">{plan.basis.kClass ? t("soil K {cls}", { cls: t(plan.basis.kClass) }) : t("no lab K: medium assumed")}</span></div>
            <div className="stat card"><span className="label">{t("Fertiliser cost")}</span><span className="value">{money(costPerHa, cur)}<small>/ha</small></span>
              <span className="sub">{area ? t("{money} for {ha} ha", { money: money(costPerHa * area, cur), ha: f(area, 1) }) : t("per hectare")}</span></div>
          </div>

          <h4>{t("Products")}</h4>
          <div className="table-scroll">
            <table className="ops">
              <thead><tr><th>{t("Product")}</th><th>kg/ha</th><th>{t("Bags / ha")}</th>{area ? <th>{t("Whole field")}</th> : null}<th>{t("Price / kg")}</th><th>{t("Cost / ha")}</th></tr></thead>
              <tbody>{plan.products.map((x) => (
                <tr key={x.name}>
                  <td><b>{t(x.name)}</b> <span className="muted small">{x.grade}</span></td>
                  <td>{x.kgPerHa}</td>
                  <td>{f(x.kgPerHa / (BAG[x.name] ?? 50), 1)} × {BAG[x.name] ?? 50} kg</td>
                  {area ? <td>{Math.round(x.kgPerHa * area)} kg</td> : null}
                  <td><input aria-label={t("Price / kg")} inputMode="decimal" style={{ width: 70 }} value={fertPrice(x.name)}
                    onChange={(e) => update({ fert: { ...prices.fert, [x.name]: Math.max(0, Number(e.target.value) || 0) } })} /></td>
                  <td>{money(productCost(x.name, x.kgPerHa), cur)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <h4>{t("When to apply")}</h4>
          <ol className="schedule">{plan.applications.map((a) => (
            <li key={a.date + a.stage}>
              <b>{fmt(a.date)}</b> · {t(a.stage)} <span className="muted small">({t("day {n}", { n: a.daysAfterSowing })})</span>
              <div>{a.products.map((x) => `${t(x.name)} ${x.kgPerHa} kg/ha`).join(" + ")} <span className="muted small">→ N {a.n}{a.p2o5 ? ` · P₂O₅ ${a.p2o5}` : ""}{a.k2o ? ` · K₂O ${a.k2o}` : ""} kg/ha</span></div>
            </li>
          ))}</ol>

          <ul className="reasons">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <div className="actions">
            {field
              ? <button className="primary" disabled={logging || logged} onClick={logToJournal}>{logged ? t("✓ Added to {name}'s journal", { name: field.name }) : logging ? t("Adding…") : t("Add these doses to the field journal")}</button>
              : <span className="muted small">{t("Save this field to add the plan to its journal.")}</span>}
          </div>
          <p className="muted small">{t("Nutrient balance: crop uptake for the target yield ({n} kg N, {p} kg P₂O₅, {k} kg K₂O per tonne), less the soil's supply, adjusted for your lab P and K. A planning estimate: confirm with a soil test and your local agronomist.", {
            n: plan.basis.uptakePerTonne.n, p: plan.basis.uptakePerTonne.p2o5, k: plan.basis.uptakePerTonne.k2o,
          })}</p>
        </>
      )}
    </div>
  );
}
