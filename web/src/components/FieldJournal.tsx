import { useState } from "react";
import { api, type ActivityType, type SavedField } from "../lib/api.ts";
import { f } from "../lib/format.ts";
import { useT } from "../lib/i18n.tsx";
import SeasonReview from "./SeasonReview.tsx";

/** English labels; components translate them with t(). */
export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  sowing: "🌱 Sowing", fertiliser: "🧪 Fertiliser", spraying: "💧 Spraying", irrigation: "🚿 Irrigation",
  tillage: "🚜 Tillage", scouting: "🔎 Scouting", harvest: "🌾 Harvest", other: "📝 Other",
};
const UNITS: Partial<Record<ActivityType, string>> = { sowing: "kg/ha", fertiliser: "kg/ha", spraying: "L/ha", irrigation: "mm" };
const EMPTY = (type: ActivityType = "sowing") => ({
  date: new Date().toISOString().slice(0, 10), type, crop: "", product: "", quantity: "", unit: UNITS[type] ?? "", cost: "", yieldTPerHa: "", notes: "",
});

/** Season totals: spend and harvested yield, per calendar year, newest first. */
export function seasonTotals(field: SavedField) {
  const years = new Map<string, { cost: number; harvests: number[]; count: number }>();
  for (const a of field.activities) {
    const y = a.date.slice(0, 4);
    const s = years.get(y) ?? years.set(y, { cost: 0, harvests: [], count: 0 }).get(y)!;
    s.count++;
    s.cost += a.cost ?? 0;
    if (a.type === "harvest" && a.yieldTPerHa != null) s.harvests.push(a.yieldTPerHa);
  }
  return [...years.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/** The field's operations log: what was done, when, with what, at what cost, and what came off the field. */
export default function FieldJournal({ field, onChange, onClose }: { field: SavedField; onChange: () => void; onClose: () => void }) {
  const t = useT();
  const [a, setA] = useState(() => EMPTY());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof ReturnType<typeof EMPTY>) => (e: { target: { value: string } }) => setA({ ...a, [k]: e.target.value });
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); onChange(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const seasons = seasonTotals(field);

  return (
    <div className="journal">
      <h3>{t("Field journal")} · {field.name}
        <button className="link" onClick={onClose}>{t("Close")}</button></h3>

      {seasons.length > 0 && (
        <div className="mini-stats">
          {seasons.slice(0, 4).map(([y, s]) => (
            <div key={y}>
              <b>{s.cost ? s.cost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "–"}</b>
              <span>{t("{year} spend · {n} operations", { year: y, n: s.count })}</span>
              {s.harvests.length > 0 && <span>{t("Harvest {y} t/ha", { y: f(Math.max(...s.harvests), 1) })}</span>}
            </div>
          ))}
        </div>
      )}

      <form className="form-row" onSubmit={(e) => {
        e.preventDefault();
        act(() => api.addActivity(field.id, a).then(() => setA(EMPTY(a.type))));
      }}>
        <label>{t("Date")} <input type="date" required value={a.date} onChange={set("date")} /></label>
        <label>{t("Operation")}
          <select value={a.type} onChange={(e) => { const type = e.target.value as ActivityType; setA({ ...a, type, unit: UNITS[type] ?? a.unit }); }}>
            {Object.entries(ACTIVITY_LABELS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </label>
        <label>{t("Crop")} <input maxLength={80} value={a.crop} onChange={set("crop")} placeholder={t("e.g. Wheat")} /></label>
        <label>{t("Product / variety")} <input maxLength={120} value={a.product} onChange={set("product")} /></label>
        <label>{t("Quantity")} <input inputMode="decimal" value={a.quantity} onChange={set("quantity")} /></label>
        <label>{t("Unit")} <input maxLength={20} value={a.unit} onChange={set("unit")} style={{ width: 80 }} /></label>
        <label>{t("Cost")} <input inputMode="decimal" value={a.cost} onChange={set("cost")} /></label>
        {a.type === "harvest" && <label>{t("Yield t/ha")} <input inputMode="decimal" value={a.yieldTPerHa} onChange={set("yieldTPerHa")} /></label>}
        <label>{t("Notes")} <input maxLength={1000} value={a.notes} onChange={set("notes")} /></label>
        <button className="primary" disabled={busy}>{t("Add")}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}

      {field.activities.length ? (
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th>{t("Date")}</th><th>{t("Operation")}</th><th>{t("Crop")}</th><th>{t("Product")}</th><th>{t("Quantity")}</th><th>{t("Cost")}</th><th>{t("Yield")}</th><th>{t("Notes")}</th><th></th></tr></thead>
            <tbody>{field.activities.map((x) => (
              <tr key={x.id}>
                <td>{x.date}</td>
                <td>{ACTIVITY_LABELS[x.type] ? t(ACTIVITY_LABELS[x.type]) : x.type}</td>
                <td>{x.crop || "–"}</td>
                <td>{x.product || "–"}</td>
                <td>{x.quantity != null ? `${x.quantity} ${x.unit}` : "–"}</td>
                <td>{x.cost != null ? x.cost.toLocaleString() : "–"}</td>
                <td>{x.yieldTPerHa != null ? `${x.yieldTPerHa} t/ha` : ""}</td>
                <td className="small notes">{x.notes}</td>
                <td><button className="icon danger" aria-label={`Delete ${x.type} on ${x.date}`} disabled={busy}
                  onClick={() => confirm(t("Delete the {date} {type} entry?", { date: x.date, type: t(ACTIVITY_LABELS[x.type] ?? x.type) })) && act(() => api.deleteActivity(field.id, x.id))}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="muted small">{t("No operations recorded yet. Log sowing, inputs, sprays and harvests to track this field's season, spend and yield.")}</p>}
      <SeasonReview field={field} />
    </div>
  );
}
