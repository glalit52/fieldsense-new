import { useCallback, useEffect, useState } from "react";
import MapPanel from "./components/MapPanel.tsx";
import Overview from "./components/Overview.tsx";
import SoilTab from "./components/SoilTab.tsx";
import CropsTab from "./components/CropsTab.tsx";
import ClimateTab from "./components/ClimateTab.tsx";
import LandTab from "./components/LandTab.tsx";
import SatelliteTab from "./components/SatelliteTab.tsx";
import OpsTab from "./components/OpsTab.tsx";
import FutureTab from "./components/FutureTab.tsx";
import Agris from "./components/Agris.tsx";
import Fields from "./components/Fields.tsx";
import { api, runReport, type CheckInput, type LonLat, type Report } from "./lib/api.ts";

const TABS = [
  ["overview", "Overview"], ["soil", "Soil & lime"], ["crops", "Crops"], ["ops", "Next 16 days"], ["climate", "Climate"],
  ["land", "Land health"], ["satellite", "Satellite"], ["future", "2045 outlook"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function App() {
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [polygon, setPolygon] = useState<LonLat[] | null>(null);
  const [opts, setOpts] = useState<Omit<CheckInput, "lat" | "lon" | "polygon">>({});
  const [report, setReport] = useState<Report | null>(null);
  const [reportId, setReportId] = useState<string>("");
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [land, setLand] = useState<any>(null);
  const [sat, setSat] = useState<any>(null);
  const [fields, setFields] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [view, setView] = useState<"check" | "fields">("check");
  const [chatOpen, setChatOpen] = useState(false);

  const refreshFields = useCallback(() => api.fields().then(setFields).catch(() => {}), []);
  useEffect(() => { api.health().then(setHealth).catch(() => {}); refreshFields(); }, [refreshFields]);

  const check = useCallback(async (override?: Partial<CheckInput>) => {
    const p = override?.lat != null ? { lat: override.lat, lon: override.lon! } : point;
    if (!p) return;
    const poly = override && "polygon" in override ? override.polygon : polygon ?? undefined;
    const o = { ...opts, ...override };
    setBusy(true); setError(""); setProgress([]); setLand(null); setSat(null);
    try {
      const { report, reportId } = await runReport({ ...o, lat: p.lat, lon: p.lon, polygon: poly ?? undefined }, (s) => setProgress((x) => [...x, s]));
      setReport(report); setReportId(reportId); setLand(report.land);
      if (report.landPending) {
        fetch("/api/land", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: p.lat, lon: p.lon, polygon: poly }) })
          .then((r) => r.json()).then((l) => setLand(l.error ? { error: l.error } : l)).catch((e) => setLand({ error: String(e) }));
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [point, polygon, opts]);

  useEffect(() => {
    if (tab !== "satellite" || !report || sat) return;
    setSat({ loading: true });
    api.satellite({ lat: report.location.lat, lon: report.location.lon, polygon: report.location.polygon ?? undefined, days: 400 })
      .then(setSat).catch((e) => setSat({ error: String(e) }));
  }, [tab, report, sat]);

  const rerun = (o: Partial<CheckInput>) => { setOpts((x) => ({ ...x, ...o })); check(o); };
  const openSaved = (f: any) => {
    setView("check");
    setPoint({ lat: f.lat, lon: f.lon }); setPolygon(f.polygon);
    const t = f.tests?.[0];
    const lab = t ? { ph: t.ph ?? undefined, organicCarbon: t.organic_carbon ?? undefined, clay: t.clay ?? undefined } : undefined;
    setOpts(lab ? { lab } : {});
    check({ lat: f.lat, lon: f.lon, polygon: f.polygon ?? undefined, lab });
  };
  const save = async () => {
    if (!report) return;
    const name = prompt("Name this field", report.location.place ? `${report.location.place} field` : "My field");
    if (!name) return;
    await api.saveField({ name, lat: report.location.lat, lon: report.location.lon, polygon: report.location.polygon, summary: { ...report.summary, headline: report.headline, checkedAt: report.generatedAt } });
    refreshFields();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> FieldSense
          <small>soil · crops · climate · satellites</small>
        </div>
        <nav>
          <button className={view === "check" ? "active" : ""} onClick={() => setView("check")}>Check a field</button>
          <button className={view === "fields" ? "active" : ""} onClick={() => setView("fields")}>My fields ({fields.length})</button>
          {report && <button className="agris-btn" onClick={() => setChatOpen((o) => !o)}>💬 Ask Agris</button>}
          <a href="mailto:lalit@sensegrass.com" className="contact-link" title="Contact Lalit Gautam - SenseGrass">
            ✉ lalit@sensegrass.com
          </a>
        </nav>
      </header>

      <main className={`layout ${view}`}>
        <section className="left">
          <MapPanel point={point} polygon={polygon} onPoint={(lat, lon) => setPoint({ lat, lon })} onPolygon={(r) => {
            setPolygon(r);
            if (r) setPoint({ lat: r.reduce((a, p) => a + p[1], 0) / r.length, lon: r.reduce((a, p) => a + p[0], 0) / r.length });
          }}
            ndviTiles={sat?.tiles} saved={fields} onOpenSaved={openSaved} />
          <div className="check-bar">
            <div className="coords">
              {polygon ? <>Field outline · {polygon.length} corners</> : point ? <>📍 {point.lat.toFixed(4)}, {point.lon.toFixed(4)}</> : <>Drop a pin or outline a field on the map</>}
            </div>
            <button className="primary big" disabled={!point || busy} onClick={() => check()}>{busy ? "Checking…" : "Check this field"}</button>
          </div>
        </section>

        <section className="right">
          {view === "fields" ? (
            <Fields fields={fields} onOpen={openSaved} onChange={refreshFields} />
          ) : busy ? (
            <div className="progress card">
              <h2>Reading your field…</h2>
              <ol>{progress.map((p, i) => <li key={i} className={i === progress.length - 1 ? "now" : "done"}>{p}</li>)}</ol>
              <p className="muted">First checks in a new area fetch 35 years of daily weather, soil maps and satellite records. Repeat checks are instant.</p>
            </div>
          ) : error ? (
            <div className="card error"><h2>Couldn't check this field</h2><p>{error}</p><button onClick={() => check()}>Try again</button></div>
          ) : report ? (
            <>
              <div className="report-head">
                <div>
                  <div className="place">{[report.location.place, report.location.region, report.location.country].filter(Boolean).join(", ") || "Your field"}
                    {report.location.areaHa ? ` · ${report.location.areaHa.toFixed(1)} ha` : ""} · {report.location.elevation?.toFixed(0)} m</div>
                  <h1>{report.headline}</h1>
                </div>
                <div className="head-actions">
                  <button onClick={save}>☆ Save field</button>
                  <button onClick={() => window.print()}>⎙ Print / PDF</button>
                  <button onClick={() => download(report)}>⤓ JSON</button>
                </div>
              </div>
              <div className="tabs" role="tablist">
                {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}
              </div>
              <div className="tab-body">
                {tab === "overview" && <Overview r={report} land={land} go={setTab} />}
                {tab === "soil" && <SoilTab r={report} onLab={(lab) => rerun({ lab })} onLime={(l) => rerun(l)} />}
                {tab === "crops" && <CropsTab r={report} onPick={(cropId) => rerun({ cropId })} />}
                {tab === "ops" && <OpsTab r={report} />}
                {tab === "climate" && <ClimateTab r={report} />}
                {tab === "land" && <LandTab land={land} />}
                {tab === "satellite" && <SatelliteTab sat={sat} />}
                {tab === "future" && <FutureTab r={report} />}
              </div>
            </>
          ) : (
            <Welcome health={health} onExample={(lat, lon) => { setPoint({ lat, lon }); setPolygon(null); check({ lat, lon, polygon: undefined }); }} />
          )}
        </section>
      </main>
      {report && chatOpen && <Agris reportId={reportId} r={report} onClose={() => setChatOpen(false)} mode={health?.agris} />}
    </div>
  );
}

function download(r: Report) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
  a.download = `fieldsense-${r.location.lat.toFixed(4)}_${r.location.lon.toFixed(4)}.json`;
  a.click();
}

const EXAMPLES: [string, number, number][] = [
  ["Wimmera wheat paddock, Australia", -36.63, 142.16], ["Punjab rice–wheat, India", 30.9, 75.85],
  ["Iowa corn belt, USA", 42.0, -93.75], ["Beauce, France", 48.3, 1.6], ["Rift Valley maize, Kenya", 0.52, 35.27], ["Mato Grosso soy, Brazil", -13.0, -55.9],
];

function Welcome({ health, onExample }: { health: any; onExample: (lat: number, lon: number) => void }) {
  const i = health?.integrations ?? {};
  const row = (k: string, label: string) => <li key={k} className={i[k] ? "on" : "off"}>{i[k] ? "●" : "○"} {label}</li>;
  return (
    <div className="welcome">
      <h1>Know your field before you plant.</h1>
      <p className="lead">Drop a pin or outline a field. FieldSense reads 35 years of daily weather, soil maps, terrain and 25 years of satellite greenness, then scores 67 crops season by season with a daily soil-water balance. You get soil pH and lime, the crops that fit, sowing windows, yields in good and dry years, frost, heat and waterlogging risk, a 16-day operations plan and a 2045 climate outlook.</p>
      <h3>Try an example</h3>
      <div className="examples">{EXAMPLES.map(([n, la, lo]) => <button key={n} onClick={() => onExample(la, lo)}>{n}</button>)}</div>
      <h3>Connected data</h3>
      <ul className="integrations">
        {row("openMeteo", "ERA5 history, forecast, SEAS5 seasonal & CMIP6 (Open-Meteo)")}
        {row("nasaPower", "NASA POWER agro-climatology")}
        {row("soilGrids", "ISRIC SoilGrids 2.0")}
        {row("modisOrnl", "MODIS NDVI since 2000 (NASA ORNL)")}
        {row("sentinelStac", "Sentinel-2 L2A on AWS (keyless)")}
        {row("sentinelHub", "Copernicus Data Space / Sentinel Hub")}
        {row("earthEngine", "Google Earth Engine (CHIRPS, WorldCover, JRC water, MERIT, S2, MODIS)")}
        {row("claude", "Agris assistant on Claude")}
      </ul>
      <p className="muted small">Grey items are optional. Add keys in <code>.env</code> to switch them on.</p>

      <div className="contact-banner">
        <div>
          <b>SenseGrass Precision Agriculture</b>
          <p className="muted small">Enterprise deployments, soil sensor calibration, custom API access & agronomy support:</p>
        </div>
        <a href="mailto:lalit@sensegrass.com" className="contact-pill">
          ✉ lalit@sensegrass.com
        </a>
      </div>
    </div>
  );
}
