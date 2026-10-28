import { useState } from "react";
import { api, type SavedField } from "../lib/api.ts";
import { f } from "../lib/format.ts";

const EMPTY_TEST = () => ({ date: new Date().toISOString().slice(0, 10), ph: "", organicCarbon: "", clay: "", p: "", k: "", notes: "" });

export default function Fields({ fields, activeId, onOpen, onChange }: {
  fields: SavedField[]; activeId?: string; onOpen: (f: SavedField) => void; onChange: () => void;
}) {
  const [testFor, setTestFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; notes: string } | null>(null);
  const [t, setT] = useState(EMPTY_TEST);
  const [error, setError] = useState("");

  /** Runs a change, then reloads the list; failures are shown instead of silently ignored. */
  const act = (fn: () => Promise<unknown>) => async () => {
    setError("");
    try { await fn(); onChange(); } catch (e: any) { setError(e.message); }
  };

  if (!fields.length) return <div className="card"><h2>No saved fields yet</h2><p>Check a field, then press <b>☆ Save field</b> to add it here. Saved fields appear as orange dots on the map.</p></div>;
  return (
    <div className="grid">
      <div className="card wide">
        <h3>My fields <span className="muted small">{fields.length}</span>
          <button className="link" onClick={() => exportCsv(fields)}>⤓ CSV</button></h3>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th>Field</th><th>Last check</th><th>pH</th><th>Rain</th><th>Top crop</th><th>Lime</th><th>Lab tests</th><th></th></tr></thead>
            <tbody>{fields.map((x) => (
              <tr key={x.id} className={x.id === activeId ? "active-row" : undefined}>
                <td>
                  {editing?.id === x.id ? (
                    <form className="stack tight" onSubmit={(e) => { e.preventDefault(); act(() => api.updateField(x.id, { name: editing.name, notes: editing.notes }).then(() => setEditing(null)))(); }}>
                      <input aria-label="Field name" required maxLength={120} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                      <textarea aria-label="Notes" rows={2} maxLength={4000} placeholder="Notes" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                      <div className="actions"><button className="primary">Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
                    </form>
                  ) : (
                    <>
                      <b>{x.name}</b>
                      <div className="muted small">{x.lat.toFixed(4)}, {x.lon.toFixed(4)}{x.polygon ? " · outlined" : ""}</div>
                      {x.notes && <div className="small notes">{x.notes}</div>}
                    </>
                  )}
                </td>
                <td className="small">{x.summary?.headline ?? "–"}<div className="muted">{x.summary?.checkedAt ? new Date(x.summary.checkedAt).toLocaleDateString() : ""}</div></td>
                <td>{f(x.summary?.soilPh, 1)}</td>
                <td>{f(x.summary?.rainPerYear, 0)} mm</td>
                <td>{x.summary?.topCrop ?? "–"}</td>
                <td>{x.summary?.limeCall ?? "–"}</td>
                <td className="small">{x.tests.length ? x.tests.map((s) => (
                  <div key={s.id} className="test-line">
                    {s.date}: pH {s.ph ?? "–"}, OC {s.organicCarbon ?? "–"}%, clay {s.clay ?? "–"}%{s.p != null ? `, P ${s.p}` : ""}{s.k != null ? `, K ${s.k}` : ""}
                    <button className="icon danger" aria-label={`Delete lab test from ${s.date}`}
                      onClick={() => confirm(`Delete the ${s.date} lab test?`) && act(() => api.deleteTest(x.id, s.id))()}>✕</button>
                  </div>
                )) : <span className="muted">none</span>}</td>
                <td className="actions">
                  <button onClick={() => onOpen(x)}>Open</button>
                  <button onClick={() => { setTestFor(testFor === x.id ? null : x.id); setT(EMPTY_TEST()); }}>+ Lab test</button>
                  <button onClick={() => setEditing({ id: x.id, name: x.name, notes: x.notes })}>Edit</button>
                  <button className="danger" onClick={() => confirm(`Delete ${x.name} and its lab tests?`) && act(() => api.deleteField(x.id))()}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {testFor && (
          <form className="form-row" onSubmit={(e) => { e.preventDefault(); act(() => api.addTest(testFor, t).then(() => setTestFor(null)))(); }}>
            <b className="small">Lab test for {fields.find((x) => x.id === testFor)?.name}</b>
            <label>Date <input type="date" required value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} /></label>
            <label>pH <input inputMode="decimal" value={t.ph} onChange={(e) => setT({ ...t, ph: e.target.value })} /></label>
            <label>OC % <input inputMode="decimal" value={t.organicCarbon} onChange={(e) => setT({ ...t, organicCarbon: e.target.value })} /></label>
            <label>Clay % <input inputMode="decimal" value={t.clay} onChange={(e) => setT({ ...t, clay: e.target.value })} /></label>
            <label>P mg/kg <input inputMode="decimal" value={t.p} onChange={(e) => setT({ ...t, p: e.target.value })} /></label>
            <label>K mg/kg <input inputMode="decimal" value={t.k} onChange={(e) => setT({ ...t, k: e.target.value })} /></label>
            <button className="primary">Save test</button>
            <button type="button" onClick={() => setTestFor(null)}>Cancel</button>
          </form>
        )}
        <p className="muted small">Opening a field with a lab test re-runs the report using the most recent test.</p>
      </div>
    </div>
  );
}

function exportCsv(fields: SavedField[]) {
  const head = ["name", "lat", "lon", "outlined", "last_check", "headline", "soil_ph", "rain_mm_per_year", "top_crop", "lime", "latest_lab_date", "lab_ph", "lab_oc_pct", "lab_clay_pct", "notes"];
  const rows = fields.map((x) => {
    const s = x.summary ?? {}, t = x.tests[0];
    return [x.name, x.lat, x.lon, x.polygon ? "yes" : "no", s.checkedAt ?? "", s.headline, s.soilPh, s.rainPerYear, s.topCrop, s.limeCall, t?.date, t?.ph, t?.organicCarbon, t?.clay, x.notes];
  });
  // Text starting with = + - @ would run as a spreadsheet formula; numbers (negative coordinates) are left alone.
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return `"${(typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
  };
  const csv = [head, ...rows].map((row) => row.map(cell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `fieldsense-fields-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
