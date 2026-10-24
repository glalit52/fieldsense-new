import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { f } from "../lib/format.ts";

const axis = { tick: { fontSize: 11, fill: "var(--muted)" }, stroke: "var(--line)" };

export default function SatelliteTab({ sat }: { sat: any }) {
  if (!sat || sat.loading) return <div className="card"><h3>Reading Sentinel-2…</h3><p className="muted">Pulling cloud-free 10 m scenes over your field for the last year. Without Earth Engine or Sentinel Hub keys, FieldSense reads the public Cloud-Optimised GeoTIFFs on AWS directly. That takes about a minute the first time.</p></div>;
  if (sat.error) return <div className="card">Satellite data unavailable: {sat.error}</div>;
  const data = sat.series.map((p: any) => ({ ...p, t: new Date(p.date).getTime() }));
  const last = sat.series[sat.series.length - 1];
  return (
    <div className="grid">
      <div className="card wide">
        <h3>Field condition, Sentinel-2 <span className="muted small">{sat.source}</span></h3>
        {last ? (
          <div className="mini-stats">
            <div><b>{f(last.ndvi, 2)}</b><span>NDVI ({last.date}), greenness</span></div>
            <div><b>{f(last.ndmi, 2)}</b><span>NDMI, canopy water</span></div>
            <div><b>{f(last.ndre, 2)}</b><span>NDRE, chlorophyll / nitrogen</span></div>
            <div><b>{sat.series.length}</b><span>clear observations</span></div>
          </div>
        ) : <p>No clear scenes over this field in the period.</p>}
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" })} {...axis} />
            <YAxis {...axis} domain={[-0.2, 1]} width={40} />
            <Tooltip labelFormatter={(t: any) => new Date(t).toLocaleDateString()} formatter={(v: any) => f(v, 3)} />
            <Legend />
            <Line dataKey="ndvi" name="NDVI" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="ndmi" name="NDMI" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="ndre" name="NDRE" stroke="var(--series-3)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
        {sat.errors?.length > 0 && <p className="muted small">Notes: {sat.errors.join(" · ")}</p>}
        {sat.tiles && <p className="small">A Sentinel-2 NDVI map layer has been added to the map (layers menu, top right).</p>}
      </div>
      <div className="card wide">
        <h3>Recent scenes <span className="muted small">last 120 days, true colour previews</span></h3>
        <div className="scenes">
          {sat.scenes.map((s: any) => (
            <figure key={s.id}>
              {s.thumbnail && <img src={s.thumbnail} alt={`Sentinel-2 scene ${s.date}`} loading="lazy" />}
              <figcaption>{new Date(s.date).toLocaleDateString()} · {f(s.cloud, 0)}% cloud</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
