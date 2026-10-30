import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type CheckMeta, type Report, type SavedField } from "../lib/api.ts";
import { f, levelColor, signed } from "../lib/format.ts";
import { useDateFormat, useT } from "../lib/i18n.tsx";

/** Every archived check of a field: how its soil, crops, lime and risks moved, and each past report to reopen. */
export default function FieldHistory({ field, onOpen, onClose, onNotice }: {
  field: SavedField;
  onOpen: (report: Report, reportId: string, check: CheckMeta) => void;
  onClose: () => void;
  onNotice: (msg: string) => void;
}) {
  const t = useT(), fmt = useDateFormat();
  const [checks, setChecks] = useState<CheckMeta[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => api.checks(field.id).then(setChecks).catch((e) => setError(e.message));
  useEffect(() => { setChecks(null); load(); }, [field.id, field.updated]);

  const open = async (c: CheckMeta) => {
    setBusy(c.id);
    try { const r = await api.openCheck(field.id, c.id); onOpen(r.report, r.reportId, r.check); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const pdf = async (c: CheckMeta) => {
    setBusy(`pdf-${c.id}`);
    try { await api.fieldPdf(field.id, c.id); } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const remove = async (c: CheckMeta) => {
    if (!confirm(t("Delete the check from {date}?", { date: fmt(c.checkedAt, { day: "numeric", month: "short", year: "numeric" }) }))) return;
    try { await api.deleteCheck(field.id, c.id); onNotice(t("Check deleted")); load(); } catch (e: any) { setError(e.message); }
  };

  const series = [...(checks ?? [])].reverse().map((c) => ({
    date: fmt(c.checkedAt, { day: "numeric", month: "short", year: "2-digit" }),
    ph: c.soilPh != null ? Number(c.soilPh.toFixed(2)) : null,
    score: c.topCrops[0]?.score ?? null,
    land: c.landChangePct,
  }));
  const [latest, previous] = checks ?? [];

  return (
    <div className="history">
      <h3>{t("Check history")} · {field.name}
        <span className="muted small">{checks ? t("Checks archived: {n}", { n: checks.length }) : ""}</span>
        <button className="link" onClick={onClose}>{t("Close")}</button></h3>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!checks ? <p className="muted">{t("Loading…")}</p> : !checks.length ? (
        <p className="muted small">{t("No checks archived yet. Open this field and run a check: every check of a saved field is kept here, so you can see how the field changes over the seasons.")}</p>
      ) : (
        <>
          {latest && previous && <Changes latest={latest} previous={previous} />}
          {series.length >= 2 && (
            <div className="detail-grid">
              <div>
                <h4>{t("Soil pH")}</h4>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={series} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} />
                    <Tooltip /><Line dataKey="ph" name={t("Soil pH")} stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <h4>{t("Top crop score")}</h4>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={series} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip /><Line dataKey="score" name={t("Score")} stroke="var(--series-3)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="table-scroll">
            <table className="ops">
              <thead><tr><th>{t("Checked")}</th><th>{t("Soil pH")}</th><th>{t("Top crop")}</th><th>{t("Lime")}</th><th>{t("Land since 2000")}</th><th>{t("Risks")}</th><th></th></tr></thead>
              <tbody>{checks.map((c) => (
                <tr key={c.id}>
                  <td>{fmt(c.checkedAt, { day: "numeric", month: "short", year: "numeric" })}<div className="muted small">{c.labUsed ? t("with lab test") : t("map estimate")}</div></td>
                  <td>{f(c.soilPh, 1)}</td>
                  <td>{c.topCrops[0] ? <>{c.topCrops[0].name} <span className="muted small">{c.topCrops[0].score}/100</span></> : "–"}</td>
                  <td>{t(c.lime.call)}</td>
                  <td>{c.landChangePct != null ? `${signed(c.landChangePct)}%` : "–"}</td>
                  <td>{c.risks.filter((r) => r.level !== "low").map((r) => (
                    <span key={r.id} className="tag" style={{ borderColor: levelColor(r.level), color: levelColor(r.level) }}>{r.label}</span>
                  ))}</td>
                  <td className="actions">
                    <button disabled={busy === c.id} onClick={() => open(c)}>{busy === c.id ? t("Opening…") : t("Open")}</button>
                    <button disabled={busy === `pdf-${c.id}`} onClick={() => pdf(c)}>⤓ PDF</button>
                    <button className="danger" onClick={() => remove(c)} aria-label={t("Delete")}>✕</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** What moved between the two most recent checks. */
function Changes({ latest, previous }: { latest: CheckMeta; previous: CheckMeta }) {
  const t = useT(), fmt = useDateFormat();
  const items: { text: string; tone: "good" | "bad" | "plain" }[] = [];
  if (latest.soilPh != null && previous.soilPh != null && Math.abs(latest.soilPh - previous.soilPh) >= 0.1) {
    items.push({ text: t("Soil pH {from} → {to}", { from: f(previous.soilPh, 1), to: f(latest.soilPh, 1) }), tone: "plain" });
  }
  const [a, b] = [latest.topCrops[0], previous.topCrops[0]];
  if (a && b && a.id !== b.id) items.push({ text: t("Top crop changed: {from} → {to}", { from: b.name, to: a.name }), tone: "plain" });
  else if (a && b && Math.abs(a.score - b.score) >= 3) items.push({ text: t("{crop} score {from} → {to}", { crop: a.name, from: b.score, to: a.score }), tone: a.score > b.score ? "good" : "bad" });
  if (latest.lime.call !== previous.lime.call) items.push({ text: t("Lime: {from} → {to}", { from: t(previous.lime.call), to: t(latest.lime.call) }), tone: latest.lime.call === "None needed" ? "good" : "bad" });
  const was = new Map(previous.risks.map((r) => [r.id, r.level]));
  const rank = { low: 0, moderate: 1, high: 2 } as const;
  for (const r of latest.risks) {
    const before = was.get(r.id);
    if (before && rank[r.level] !== rank[before]) items.push({ text: t("{risk} risk {from} → {to}", { risk: r.label, from: t(before), to: t(r.level) }), tone: rank[r.level] > rank[before] ? "bad" : "good" });
  }
  if (latest.labUsed && !previous.labUsed) items.push({ text: t("Now using your lab test instead of the soil map"), tone: "good" });
  return (
    <div className="changes">
      <b>{t("Since {date}", { date: fmt(previous.checkedAt, { day: "numeric", month: "short", year: "numeric" }) })}</b>
      {items.length ? <ul>{items.map((x) => <li key={x.text} className={x.tone}>{x.text}</li>)}</ul> : <span className="muted"> {t("No material change.")}</span>}
    </div>
  );
}
