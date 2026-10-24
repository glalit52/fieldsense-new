import { useState } from "react";
import { api } from "../lib/api.ts";
import { f } from "../lib/format.ts";

export default function Fields({ fields, onOpen, onChange }: { fields: any[]; onOpen: (f: any) => void; onChange: () => void }) {
  const [testFor, setTestFor] = useState<string | null>(null);
  const [t, setT] = useState({ date: new Date().toISOString().slice(0, 10), ph: "", organicCarbon: "", clay: "", p: "", k: "" });
  if (!fields.length) return <div className="card"><h2>No saved fields yet</h2><p>Check a field, then press <b>☆ Save field</b> to add it here. Saved fields appear as orange dots on the map.</p></div>;
  return (
    <div className="grid">
      <div className="card wide">
        <h2>My fields</h2>
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th>Field</th><th>Last check</th><th>pH</th><th>Rain</th><th>Top crop</th><th>Lime</th><th>Lab tests</th><th></th></tr></thead>
            <tbody>{fields.map((x) => (
              <tr key={x.id}>
                <td><b>{x.name}</b><div className="muted small">{x.lat.toFixed(4)}, {x.lon.toFixed(4)}{x.polygon ? " · outlined" : ""}</div></td>
                <td className="small">{x.summary?.headline ?? "–"}<div className="muted">{x.summary?.checkedAt ? new Date(x.summary.checkedAt).toLocaleDateString() : ""}</div></td>
                <td>{f(x.summary?.soilPh, 1)}</td>
                <td>{f(x.summary?.rainPerYear, 0)} mm</td>
                <td>{x.summary?.topCrop ?? "–"}</td>
                <td>{x.summary?.limeCall ?? "–"}</td>
                <td className="small">{x.tests?.length ? x.tests.map((s: any) => <div key={s.id}>{s.date}: pH {s.ph ?? "–"}, OC {s.organic_carbon ?? "–"}%, clay {s.clay ?? "–"}%</div>) : <span className="muted">none</span>}</td>
                <td className="actions">
                  <button onClick={() => onOpen(x)}>Open</button>
                  <button onClick={() => setTestFor(testFor === x.id ? null : x.id)}>+ Lab test</button>
                  <button className="danger" onClick={async () => { if (confirm(`Delete ${x.name}?`)) { await api.deleteField(x.id); onChange(); } }}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {testFor && (
          <form className="form-row" onSubmit={async (e) => { e.preventDefault(); await api.addTest(testFor, t); setTestFor(null); onChange(); }}>
            <label>Date <input type="date" value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} /></label>
            <label>pH <input inputMode="decimal" value={t.ph} onChange={(e) => setT({ ...t, ph: e.target.value })} /></label>
            <label>OC % <input inputMode="decimal" value={t.organicCarbon} onChange={(e) => setT({ ...t, organicCarbon: e.target.value })} /></label>
            <label>Clay % <input inputMode="decimal" value={t.clay} onChange={(e) => setT({ ...t, clay: e.target.value })} /></label>
            <label>P mg/kg <input inputMode="decimal" value={t.p} onChange={(e) => setT({ ...t, p: e.target.value })} /></label>
            <label>K mg/kg <input inputMode="decimal" value={t.k} onChange={(e) => setT({ ...t, k: e.target.value })} /></label>
            <button className="primary">Save test</button>
          </form>
        )}
        <p className="muted small">Opening a field with a lab test re-runs the report using the most recent test.</p>
      </div>
    </div>
  );
}
