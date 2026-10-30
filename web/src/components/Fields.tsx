import { useMemo, useRef, useState } from "react";
import { api, type CheckMeta, type Report, type SavedField } from "../lib/api.ts";
import { downloadFile, exportGeoJson, parseImportFile } from "../lib/fieldio.ts";
import { f } from "../lib/format.ts";
import { useT } from "../lib/i18n.tsx";
import FieldHistory from "./FieldHistory.tsx";
import FieldJournal, { seasonTotals } from "./FieldJournal.tsx";

type Sort = "updated" | "name" | "ph" | "rain" | "lime";
const SORTS: Record<Sort, [string, (a: SavedField, b: SavedField) => number]> = {
  updated: ["Recently updated", (a, b) => b.updated - a.updated],
  name: ["Name", (a, b) => a.name.localeCompare(b.name)],
  ph: ["Soil pH (lowest first)", (a, b) => (a.summary?.soilPh ?? 99) - (b.summary?.soilPh ?? 99)],
  rain: ["Rainfall (highest first)", (a, b) => (b.summary?.rainPerYear ?? -1) - (a.summary?.rainPerYear ?? -1)],
  lime: ["Lime needed first", (a, b) => limeRank(a) - limeRank(b)],
};
const limeRank = (x: SavedField) => ({ "Likely needed": 0, Borderline: 1, "None needed": 2 } as Record<string, number>)[x.summary?.limeCall] ?? 3;

const EMPTY_TEST = () => ({ date: new Date().toISOString().slice(0, 10), ph: "", organicCarbon: "", clay: "", p: "", k: "", notes: "" });

export default function Fields({ fields, activeId, onOpen, onOpenArchived, onChange, onNotice }: {
  fields: SavedField[]; activeId?: string; onOpen: (f: SavedField) => void; onChange: () => void; onNotice?: (msg: string) => void;
  onOpenArchived: (f: SavedField, report: Report, reportId: string, check: CheckMeta) => void;
}) {
  const t = useT();
  const [testFor, setTestFor] = useState<string | null>(null);
  const [journalFor, setJournalFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return fields
      .filter((x) => !needle || [x.name, x.notes, x.summary?.topCrop, x.summary?.headline].some((v) => typeof v === "string" && v.toLowerCase().includes(needle)))
      .sort(SORTS[sort][1]);
  }, [fields, q, sort]);
  const compared = fields.filter((x) => picked.has(x.id));
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [editing, setEditing] = useState<{ id: string; name: string; notes: string } | null>(null);
  const [draft, setDraft] = useState(EMPTY_TEST);
  const [error, setError] = useState("");

  /** Runs a change, then reloads the list; failures are shown instead of silently ignored. */
  const act = (fn: () => Promise<unknown>) => async () => {
    setError("");
    try { await fn(); onChange(); } catch (e: any) { setError(e.message); }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setError(""); setImporting(true);
    try {
      const rows = await parseImportFile(file);
      if (!confirm(t("Import {n} fields from {file}?", { n: rows.length, file: file.name }))) return;
      const { created } = await api.importFields(rows);
      onNotice?.(t("Imported {n} fields", { n: created }));
      onChange();
    } catch (e: any) { setError(t("Import failed: {error}", { error: e.message })); } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const importInput = <input ref={fileRef} type="file" accept=".csv,.geojson,.json,text/csv,application/geo+json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />;

  if (!fields.length) return (
    <div className="card">
      <h2>{t("No saved fields yet")}</h2>
      <p>{t("Check a field, then press ☆ Save field to add it here. Saved fields appear as orange dots on the map.")}</p>
      <p className="muted small">{t("Already have field boundaries? Import a GeoJSON file (points or polygons) or a CSV with name, lat, lon columns.")}</p>
      {importInput}
      <button disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? t("Importing…") : `⤒ ${t("Import fields")}`}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
  const journalField = fields.find((x) => x.id === journalFor);
  const historyField = fields.find((x) => x.id === historyFor);
  return (
    <div className="grid">
      <Portfolio fields={fields} />
      <div className="card wide">
        <h3>{t("My fields")} <span className="muted small">{shown.length === fields.length ? fields.length : t("{n} of {total}", { n: shown.length, total: fields.length })}</span></h3>
        <div className="toolbar">
          <input type="search" aria-label={t("Search fields")} placeholder={t("Search name, notes, crop…")} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t("Sort fields")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {Object.entries(SORTS).map(([k, [l]]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
          <span className="toolbar-gap" />
          {importInput}
          <button disabled={importing} onClick={() => fileRef.current?.click()} title={t("Import from CSV (name, lat, lon) or GeoJSON")}>{importing ? t("Importing…") : `⤒ ${t("Import")}`}</button>
          <button onClick={() => exportCsv(fields)}>⤓ CSV</button>
          <button onClick={() => exportGeoJson(fields)} title="Outlines and pins for GIS and farm software">⤓ GeoJSON</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="table-scroll">
          <table className="ops">
            <thead><tr><th aria-label={t("Compare")}></th><th>{t("Field")}</th><th>{t("Last check")}</th><th>pH</th><th>{t("Rain")}</th><th>{t("Top crop")}</th><th>{t("Lime")}</th><th>{t("Lab tests")}</th><th></th></tr></thead>
            <tbody>{shown.map((x) => (
              <tr key={x.id} className={x.id === activeId ? "active-row" : undefined}>
                <td><input type="checkbox" aria-label={`Compare ${x.name}`} checked={picked.has(x.id)} onChange={() => togglePick(x.id)} /></td>
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
                      <div className="muted small">{x.lat.toFixed(4)}, {x.lon.toFixed(4)}{x.polygon ? " · outlined" : ""}{x.summary?.areaHa ? ` · ${f(x.summary.areaHa, 1)} ha` : ""}</div>
                      {x.notes && <div className="small notes">{x.notes}</div>}
                    </>
                  )}
                </td>
                <td className="small">{x.summary?.headline ?? "–"}<div className="muted">{x.summary?.checkedAt ? new Date(x.summary.checkedAt).toLocaleDateString() : ""}</div></td>
                <td>{f(x.summary?.soilPh, 1)}</td>
                <td>{f(x.summary?.rainPerYear, 0)} mm</td>
                <td>{x.summary?.topCrop ?? "–"}</td>
                <td>{x.summary?.limeCall ? t(x.summary.limeCall) : "–"}</td>
                <td className="small">{x.tests.length ? x.tests.map((s) => (
                  <div key={s.id} className="test-line">
                    {s.date}: pH {s.ph ?? "–"}, OC {s.organicCarbon ?? "–"}%, clay {s.clay ?? "–"}%{s.p != null ? `, P ${s.p}` : ""}{s.k != null ? `, K ${s.k}` : ""}
                    <button className="icon danger" aria-label={`Delete lab test from ${s.date}`}
                      onClick={() => confirm(`Delete the ${s.date} lab test?`) && act(() => api.deleteTest(x.id, s.id))()}>✕</button>
                  </div>
                )) : <span className="muted">{t("none")}</span>}</td>
                <td className="actions">
                  <button onClick={() => onOpen(x)}>{t("Open")}</button>
                  <button className={historyFor === x.id ? "active" : undefined} onClick={() => setHistoryFor(historyFor === x.id ? null : x.id)}>{t("History")}</button>
                  <button onClick={() => { setTestFor(testFor === x.id ? null : x.id); setDraft(EMPTY_TEST()); }}>+ {t("Lab test")}</button>
                  <button className={journalFor === x.id ? "active" : undefined} onClick={() => setJournalFor(journalFor === x.id ? null : x.id)}>
                    {t("Journal")}{x.activities.length ? ` (${x.activities.length})` : ""}</button>
                  <button onClick={() => setEditing({ id: x.id, name: x.name, notes: x.notes })}>{t("Edit")}</button>
                  <button className="danger" onClick={() => confirm(t("Delete {name}, its lab tests, journal and check history?", { name: x.name })) && act(() => api.deleteField(x.id))()}>{t("Delete")}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {testFor && (
          <form className="form-row" onSubmit={(e) => { e.preventDefault(); act(() => api.addTest(testFor, draft).then(() => setTestFor(null)))(); }}>
            <b className="small">{t("Lab test for {name}", { name: fields.find((x) => x.id === testFor)?.name ?? "" })}</b>
            <label>{t("Date")} <input type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
            <label>pH <input inputMode="decimal" value={draft.ph} onChange={(e) => setDraft({ ...draft, ph: e.target.value })} /></label>
            <label>OC % <input inputMode="decimal" value={draft.organicCarbon} onChange={(e) => setDraft({ ...draft, organicCarbon: e.target.value })} /></label>
            <label>Clay % <input inputMode="decimal" value={draft.clay} onChange={(e) => setDraft({ ...draft, clay: e.target.value })} /></label>
            <label>P mg/kg <input inputMode="decimal" value={draft.p} onChange={(e) => setDraft({ ...draft, p: e.target.value })} /></label>
            <label>K mg/kg <input inputMode="decimal" value={draft.k} onChange={(e) => setDraft({ ...draft, k: e.target.value })} /></label>
            <button className="primary">{t("Save test")}</button>
            <button type="button" onClick={() => setTestFor(null)}>{t("Cancel")}</button>
          </form>
        )}
        <p className="muted small">{t("Opening a field with a lab test re-runs the report using the most recent test. Tick two or more fields to compare them.")}</p>
      </div>
      {historyField && <div className="card wide"><FieldHistory field={historyField} onClose={() => setHistoryFor(null)} onNotice={(m) => onNotice?.(m)}
        onOpen={(r, id, c) => onOpenArchived(historyField, r, id, c)} /></div>}
      {journalField && <div className="card wide"><FieldJournal field={journalField} onChange={onChange} onClose={() => setJournalFor(null)} /></div>}
      {compared.length >= 2 && <Compare fields={compared} onClear={() => setPicked(new Set())} />}
    </div>
  );
}

/** Whole-farm headline: how many fields, how much land, what needs attention, and this year's recorded spend. */
function Portfolio({ fields }: { fields: SavedField[] }) {
  const t = useT();
  const year = String(new Date().getFullYear());
  const area = fields.reduce((a, x) => a + (typeof x.summary?.areaHa === "number" ? x.summary.areaHa : 0), 0);
  const phs = fields.map((x) => x.summary?.soilPh).filter((v): v is number => typeof v === "number");
  const lime = fields.filter((x) => x.summary?.limeCall === "Likely needed").length;
  const noLab = fields.filter((x) => !x.tests.length).length;
  const spend = fields.reduce((a, x) => a + (seasonTotals(x).find(([y]) => y === year)?.[1].cost ?? 0), 0);
  const stale = fields.filter((x) => !x.summary?.checkedAt || Date.now() - new Date(x.summary.checkedAt).getTime() > 180 * 86_400_000).length;
  const stat = (label: string, value: string, sub?: string) => (
    <div className="stat card"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="sub">{sub}</span>}</div>
  );
  return (
    <div className="stats">
      {stat(t("Fields"), String(fields.length), area ? t("{ha} ha outlined", { ha: f(area, 1) }) : t("pins only"))}
      {stat(t("Average soil pH"), phs.length ? f(phs.reduce((a, b) => a + b, 0) / phs.length, 1) : "–", phs.length ? t("range {min}–{max}", { min: f(Math.min(...phs), 1), max: f(Math.max(...phs), 1) }) : undefined)}
      {stat(t("Lime likely needed"), String(lime), lime ? t("sort by lime to see them") : t("none flagged"))}
      {stat(t("Without a lab test"), String(noLab), noLab ? t("map estimates only") : t("all tested"))}
      {stat(t("{year} spend", { year }), spend ? spend.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "–", t("from field journals"))}
      {stale > 0 && stat(t("Re-check due"), String(stale), t("not checked in 6 months"))}
    </div>
  );
}

function Compare({ fields, onClear }: { fields: SavedField[]; onClear: () => void }) {
  const t = useT();
  const rows: [string, (x: SavedField) => string][] = [
    [t("Area"), (x) => (x.summary?.areaHa ? `${f(x.summary.areaHa, 1)} ha` : t("pin"))],
    [t("Soil pH (map)"), (x) => f(x.summary?.soilPh, 1)],
    [t("Latest lab pH"), (x) => (x.tests[0]?.ph != null ? `${x.tests[0].ph} (${x.tests[0].date})` : "–")],
    [t("Lime"), (x) => (x.summary?.limeCall ? t(x.summary.limeCall) : "–")],
    [t("Rain per year"), (x) => `${f(x.summary?.rainPerYear, 0)} mm`],
    [t("Top crop"), (x) => x.summary?.topCrop ?? "–"],
    [t("Good-year yield"), (x) => (x.summary?.topCropYield != null ? `${f(x.summary.topCropYield, 1)} t/ha` : "–")],
    [t("Land health change"), (x) => (x.summary?.landChangePct != null ? `${f(x.summary.landChangePct, 1)}%` : "–")],
    [t("Operations logged"), (x) => String(x.activities.length)],
    [t("Last check"), (x) => (x.summary?.checkedAt ? new Date(x.summary.checkedAt).toLocaleDateString() : t("never"))],
  ];
  return (
    <div className="card wide">
      <h3>{t("Compare {n} fields", { n: fields.length })} <button className="link" onClick={onClear}>{t("Clear")}</button></h3>
      <div className="table-scroll">
        <table className="ops">
          <thead><tr><th></th>{fields.map((x) => <th key={x.id}>{x.name}</th>)}</tr></thead>
          <tbody>{rows.map(([label, get]) => <tr key={label}><th>{label}</th>{fields.map((x) => <td key={x.id}>{get(x)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function exportCsv(fields: SavedField[]) {
  const head = ["name", "lat", "lon", "outlined", "area_ha", "last_check", "headline", "soil_ph", "rain_mm_per_year", "top_crop", "lime", "latest_lab_date", "lab_ph", "lab_oc_pct", "lab_clay_pct", "notes"];
  const rows = fields.map((x) => {
    const s = x.summary ?? {}, t = x.tests[0];
    return [x.name, x.lat, x.lon, x.polygon ? "yes" : "no", s.areaHa ?? "", s.checkedAt ?? "", s.headline, s.soilPh, s.rainPerYear, s.topCrop, s.limeCall, t?.date, t?.ph, t?.organicCarbon, t?.clay, x.notes];
  });
  // Text starting with = + - @ would run as a spreadsheet formula; numbers (negative coordinates) are left alone.
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return `"${(typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
  };
  const csv = [head, ...rows].map((row) => row.map(cell).join(",")).join("\n");
  downloadFile(`fieldsense-fields-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
}
