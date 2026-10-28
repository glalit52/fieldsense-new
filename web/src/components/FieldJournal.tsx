import { useState } from "react";
import { api, type ActivityType, type SavedField } from "../lib/api.ts";
import { f } from "../lib/format.ts";

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
  const [a, setA] = useState(() => EMPTY());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof ReturnType<typeof EMPTY>) => (e: { target: { value: string } }) => setA({ ...a, [k]: e.target.value });
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); onChange(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const seasons = seasonTotals(field);
  const expected = typeof field.summary?.topCropYield === "number" ? field.summary.topCropYield : null;

  return (
    <div className="journal">
      <h3>Field journal · {field.name}
        <button className="link" onClick={onClose}>Close</button></h3>

      {seasons.length > 0 && (
        <div className="mini-stats">
          {seasons.slice(0, 4).map(([y, s]) => (
            <div key={y}>
              <b>{s.cost ? s.cost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "–"}</b>
              <span>{y} spend · {s.count} operation{s.count === 1 ? "" : "s"}</span>
              {s.harvests.length > 0 && <span>Harvest {f(Math.max(...s.harvests), 1)} t/ha{expected ? ` (model good year ${f(expected, 1)})` : ""}</span>}
            </div>
          ))}
        </div>
      )}

      <form className="form-row" onSubmit={(e) => {
        e.preventDefault();
        act(() => api.addActivity(field.id, a).then(() => setA(EMPTY(a.type))));
      }}>
        <label>Date <input type="date" required value={a.date} onChange={set("date")} /></label>
        <label>Operation
          <select value={a.type} onChange={(e) => { const type = e.target.value as ActivityType; setA({ ...a, type, unit: UNITS[type] ?? a.unit }); }}>
            {Object.entries(ACTIVITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Crop <input maxLength={80} value={a.crop} onChange={set("crop")} placeholder="e.g. Wheat" /></label>
        <label>Product / variety <input maxLength={120} value={a.product} onChange={set("product")} /></label>
        <label>Quantity <input inputMode="decimal" value={a.quantity} onChange={set("quantity")} /></label>
        <label>Unit <input maxLength={20} value={a.unit} onChange={set("unit")} style={{ width: 80 }} /></label>
        <label>Cost <input inputMode="decimal" value={a.cost} onChange={set("cost")} /></label>
        {a.type === "harvest" && <label>Yield t/ha <input inputMode="decimal" value={a.yieldTPerHa} onChange={set("yieldTPerHa")} /></label>}
        <label>Notes <input maxLength={1000} value={a.notes} onChange={set("notes")} /></label>
        <button className="primary" disabled={busy}>Add</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}

      {field.activities.length ? (
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th>Date</th><th>Operation</th><th>Crop</th><th>Product</th><th>Quantity</th><th>Cost</th><th>Yield</th><th>Notes</th><th></th></tr></thead>
            <tbody>{field.activities.map((x) => (
              <tr key={x.id}>
                <td>{x.date}</td>
                <td>{ACTIVITY_LABELS[x.type] ?? x.type}</td>
                <td>{x.crop || "–"}</td>
                <td>{x.product || "–"}</td>
                <td>{x.quantity != null ? `${x.quantity} ${x.unit}` : "–"}</td>
                <td>{x.cost != null ? x.cost.toLocaleString() : "–"}</td>
                <td>{x.yieldTPerHa != null ? `${x.yieldTPerHa} t/ha` : ""}</td>
                <td className="small notes">{x.notes}</td>
                <td><button className="icon danger" aria-label={`Delete ${x.type} on ${x.date}`} disabled={busy}
                  onClick={() => confirm(`Delete the ${x.date} ${x.type} entry?`) && act(() => api.deleteActivity(field.id, x.id))}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="muted small">No operations recorded yet. Log sowing, inputs, sprays and harvests to track this field's season, spend and yield.</p>}
    </div>
  );
}
