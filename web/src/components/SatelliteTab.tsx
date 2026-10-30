import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { f } from "../lib/format.ts";
import { useDateFormat, useT } from "../lib/i18n.tsx";

const axis = { tick: { fontSize: 11, fill: "var(--muted)" }, stroke: "var(--line)" };

export default function SatelliteTab({ sat }: { sat: any }) {
  const t = useT(), fmt = useDateFormat();
  if (!sat || sat.loading) return <div className="card"><h3>{t("Reading Sentinel-2…")}</h3><p className="muted">{t("Pulling cloud-free 10 m scenes over your field for the last year.")} {t("Without Earth Engine or Sentinel Hub keys, FieldSense reads the public Cloud-Optimised GeoTIFFs on AWS directly.")} {t("That takes about a minute the first time.")}</p></div>;
  if (sat.error) return <div className="card">{t("Satellite data unavailable: {error}", { error: sat.error })}</div>;
  const data = sat.series.map((p: any) => ({ ...p, t: new Date(p.date).getTime() }));
  const last = sat.series[sat.series.length - 1];
  return (
    <div className="grid">
      <div className="card wide">
        <h3>{t("Field condition, Sentinel-2")} <span className="muted small">{sat.source}</span></h3>
        {last ? (
          <div className="mini-stats">
            <div><b>{f(last.ndvi, 2)}</b><span>{t("NDVI ({date}), greenness", { date: last.date })}</span></div>
            <div><b>{f(last.ndmi, 2)}</b><span>{t("NDMI, canopy water")}</span></div>
            <div><b>{f(last.ndre, 2)}</b><span>{t("NDRE, chlorophyll / nitrogen")}</span></div>
            <div><b>{sat.series.length}</b><span>{t("clear observations")}</span></div>
          </div>
        ) : <p>{t("No clear scenes over this field in the period.")}</p>}
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmt(new Date(v).toISOString(), { month: "short", year: "2-digit" })} {...axis} />
            <YAxis {...axis} domain={[-0.2, 1]} width={40} />
            <Tooltip labelFormatter={(v: any) => fmt(new Date(v).toISOString(), {})} formatter={(v: any) => f(v, 3)} />
            <Legend />
            <Line dataKey="ndvi" name="NDVI" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="ndmi" name="NDMI" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="ndre" name="NDRE" stroke="var(--series-3)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
        {sat.errors?.length > 0 && <p className="muted small">{t("Notes:")} {sat.errors.join(" · ")}</p>}
        {sat.tiles && <p className="small">{t("A Sentinel-2 NDVI map layer has been added to the map (layers menu, top right).")}</p>}
      </div>
      <div className="card wide">
        <h3>{t("Recent scenes")} <span className="muted small">{t("last 120 days, true colour previews")}</span></h3>
        <div className="scenes">
          {sat.scenes.map((s: any) => (
            <figure key={s.id}>
              {s.thumbnail && <img src={s.thumbnail} alt={t("Sentinel-2 scene {date}", { date: s.date })} loading="lazy" />}
              <figcaption>{fmt(s.date, {})} · {t("{n}% cloud", { n: f(s.cloud, 0) })}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
