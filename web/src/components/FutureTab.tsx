import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { f, signed } from "../lib/format.ts";
import type { Report } from "../lib/api.ts";
import { useT } from "../lib/i18n.tsx";

export default function FutureTab({ r }: { r: Report }) {
  const t = useT();
  const fu = r.future;
  if (!fu) return <div className="card">{t("Climate projections unavailable for this location right now.")}</div>;
  const data = [...fu.crops].sort((a: any, b: any) => b.future - a.future);
  return (
    <div className="grid">
      <div className="card">
        <h3>{t("Your field around 2045")}</h3>
        <p className="big-text">{t("About {temp} °C warmer, {rain}% rain.", { temp: signed(fu.warmingC, 1), rain: signed(fu.rainChangePct, 0) })}</p>
        <p className="small">{t("The 35-year daily weather record is shifted by the change between 1995–2014 and 2040–2049 averaged across {n} CMIP6 high-resolution models ({models}).", { n: fu.models.length, models: fu.models.join(", ").replaceAll("_", "-") })} {t("Every crop is then re-simulated, including evaporative demand rising about 3% per °C.")}</p>
        <ul className="small">
          {data.filter((c: any) => Math.abs(c.change) >= 3).map((c: any) => <li key={c.id}><b>{c.name}</b>: {c.now} → {c.future} ({signed(c.change, 0)})</li>)}
          {data.every((c: any) => Math.abs(c.change) < 3) && <li>{t("None of the top crops changes by more than 3 points.")} {t("The ranking holds.")}</li>}
        </ul>
      </div>
      <div className="card">
        <h3>{t("Top 15 crops, now vs 2045")}</h3>
        <ResponsiveContainer width="100%" height={Math.max(260, data.length * 26)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 40, bottom: 0 }} barGap={2}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "var(--text)" }} />
            <Tooltip formatter={(v: any) => `${f(v, 0)}/100`} /><Legend />
            <Bar dataKey="now" name={t("Today")} fill="var(--series-1)" radius={[0, 4, 4, 0]} />
            <Bar dataKey="future" name="~2045" fill="var(--series-2)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
