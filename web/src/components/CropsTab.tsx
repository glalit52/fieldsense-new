import { Fragment, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { f, scoreColor } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";

const FACTOR_LABELS: Record<string, string> = {
  water: "Water", temperature: "Temperature", frost: "Frost", heat: "Heat at flowering", wetSeasons: "Wet seasons", chill: "Winter chill",
  maturity: "Season length", ph: "Soil pH", texture: "Soil texture", drainage: "Drainage",
};

export default function CropsTab({ r, onPick }: { r: Report; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("All");
  const [open, setOpen] = useState<string | null>(r.selectedCrop ?? null);
  const [irrigated, setIrrigated] = useState(false);
  const groups = useMemo(() => ["All", ...new Set<string>(r.crops.map((c: any) => c.group))], [r]);
  const ranked = irrigated ? [...r.crops].sort((a: any, b: any) => b.irrigatedScore - a.irrigatedScore) : r.crops;
  const list = ranked.filter((c: any) => (group === "All" || c.group === group) && c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="card wide">
      <div className="toolbar">
        <input placeholder="Find a crop" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value)}>{groups.map((g) => <option key={g}>{g}</option>)}</select>
        <div className="seg" role="group" aria-label="Water supply">
          <button className={!irrigated ? "active" : ""} onClick={() => setIrrigated(false)}>Rainfed</button>
          <button className={irrigated ? "active" : ""} onClick={() => setIrrigated(true)}>Irrigated</button>
        </div>
        <button onClick={() => exportCsv(r)}>⤓ CSV</button>
      </div>
      <p className="muted small">Each crop is simulated day by day for each of the last 30 seasons, using a soil-water balance, thermal-time development, frost and heat at flowering, waterlogging and your soil. The best sowing date is chosen from 37 options. Score = average share of a world-class yield for that crop reached here, so crops are compared on the same footing. {irrigated ? "Ranked assuming full irrigation." : "Ranked on rainfall alone."}</p>
      <table className="crops">
        <thead><tr><th>#</th><th>Crop</th><th>Score</th><th>Good years (of 10)</th><th>Yield t/ha<br /><span className="small">dry · typical · good</span></th><th>Irrigated</th><th>Sow</th><th>Held back by</th></tr></thead>
        <tbody>
          {list.map((c: any) => (
            <Fragment key={c.id}>
              <tr className={`row ${open === c.id ? "open" : ""}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <td>{ranked.indexOf(c) + 1}</td>
                <td><b>{c.name}</b> <span className="muted small">{c.product}</span> {c.firmness === "firm" && <span className="tag">firm</span>}</td>
                <td><span className="score-pill" style={{ background: scoreColor(irrigated ? c.irrigatedScore : c.score) }}>{irrigated ? c.irrigatedScore : c.score}</span></td>
                <td>{c.goodYearsInTen}</td>
                <td>{f(c.yieldTPerHa.poor)} · <b>{f(c.yieldTPerHa.median)}</b> · {f(c.yieldTPerHa.good)}</td>
                <td>{f(c.irrigatedYieldTPerHa)} <span className="muted small">+{f(c.irrigationMm, 0)} mm</span></td>
                <td>{c.sowing?.label ?? <span className="muted">perennial</span>}</td>
                <td className="small">{c.limiting.join(", ") || <span className="muted">nothing major</span>}</td>
              </tr>
              {open === c.id && (
                <tr className="detail"><td colSpan={8}>
                  <div className="detail-grid">
                    <div>
                      <h4>Last ten seasons</h4>
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={c.recentYears}>
                          <XAxis dataKey="year" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={28} />
                          <Tooltip formatter={(v: any) => [`${v}/100`, "score"]} />
                          <Bar dataKey="score">{c.recentYears.map((y: any) => <Cell key={y.year} fill={scoreColor(y.score)} />)}</Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <h4>What sets the score (1 = no limit)</h4>
                      <ul className="factors">{Object.entries(c.factors).map(([k, v]: any) => (
                        <li key={k}><span>{FACTOR_LABELS[k] ?? k}</span><span className="bar"><span style={{ width: `${v * 100}%`, background: v > 0.9 ? "var(--good)" : v > 0.7 ? "var(--warn)" : "var(--bad)" }} /></span><span>{f(v, 2)}</span></li>
                      ))}</ul>
                      <p className="small">About {c.seasonDays} days in the ground. <button className="link" onClick={() => onPick(c.id)}>Plan lime and the headline around {c.name} →</button></p>
                    </div>
                  </div>
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function exportCsv(r: Report) {
  const head = ["rank", "crop", "group", "score", "irrigated_score", "good_years_in_10", "yield_dry_t_ha", "yield_typical_t_ha", "yield_good_t_ha", "irrigated_t_ha", "irrigation_mm", "sowing", "limits"];
  const rows = r.crops.map((c: any, i: number) => [i + 1, c.name, c.group, c.score, c.irrigatedScore, c.goodYearsInTen, c.yieldTPerHa.poor, c.yieldTPerHa.median, c.yieldTPerHa.good, c.irrigatedYieldTPerHa, c.irrigationMm, c.sowing?.label ?? "perennial", c.limiting.join("; ")]);
  const csv = [head, ...rows].map((row) => row.map((v: any) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "fieldsense-crops.csv";
  a.click();
}
