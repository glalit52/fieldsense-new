import { useCallback, useEffect, useRef, useState } from "react";
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
import Account from "./components/Account.tsx";
import AuthDialog from "./components/AuthDialog.tsx";
import AuthPage from "./components/AuthPage.tsx";
import Modal from "./components/Modal.tsx";
import Admin from "./components/Admin.tsx";
import AlertsBell from "./components/Alerts.tsx";
import NutrientTab from "./components/NutrientTab.tsx";
import EconomicsTab from "./components/EconomicsTab.tsx";
import { api, ApiError, LOCAL_USER, onUnauthorized, runReport, type CheckInput, type CheckMeta, type LonLat, type Report, type SavedField, type User } from "./lib/api.ts";
import { LanguagePicker, useDateFormat, useT } from "./lib/i18n.tsx";

const TABS = [
  ["overview", "Overview"], ["soil", "Soil & lime"], ["crops", "Crops"], ["fertiliser", "Fertiliser"], ["profit", "Profit"], ["ops", "Next 16 days"],
  ["climate", "Climate"], ["land", "Land health"], ["satellite", "Satellite"], ["future", "2045 outlook"],
] as const;
type Tab = (typeof TABS)[number][0];
type View = "check" | "fields" | "account" | "admin";

const DEFAULT_CONTACT = "lalit@sensegrass.com";

/** Shareable link state: ?lat=&lon= for a pin, plus p=lon,lat;… for an outline. */
function readLink(): { lat: number; lon: number; polygon?: LonLat[] } | null {
  const q = new URLSearchParams(location.search);
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (!q.has("lat") || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const polygon = q.get("p")?.split(";").map((pt) => pt.split(",").map(Number) as LonLat).filter((pt) => pt.length === 2 && pt.every(Number.isFinite));
  return { lat, lon, polygon: polygon && polygon.length >= 3 ? polygon : undefined };
}
function writeLink(lat: number, lon: number, polygon?: LonLat[] | null) {
  const q = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5) });
  if (polygon && polygon.length <= 80) q.set("p", polygon.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(";"));
  history.replaceState(null, "", `?${q}`);
}

export default function App() {
  const t = useT(), fmt = useDateFormat();
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
  const [fields, setFields] = useState<SavedField[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [view, setView] = useState<View>("check");
  const [chatOpen, setChatOpen] = useState(false);
  /** Track URL pathname for route guards */
  const [pathname, setPathname] = useState(() => window.location.pathname);
  /** undefined while the session is being restored. */
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authFor, setAuthFor] = useState<{ reason?: string; then?: () => void } | null>(null);
  const [saving, setSaving] = useState(false);
  /** The saved field the current report belongs to, so re-checking it updates it instead of saving a duplicate. */
  const [activeFieldId, setActiveFieldId] = useState<string>();
  const [notice, setNotice] = useState("");
  /** Set while viewing an archived check of a saved field (rather than a fresh one). */
  const [archived, setArchived] = useState<CheckMeta | null>(null);
  /** The reportId already archived to the active field, so the button reflects it. */
  const [archivedId, setArchivedId] = useState("");
  const [fertCrop, setFertCrop] = useState<string>();
  /** Set when the server or the accounts database can't be reached at boot; the user can retry. */
  const [bootError, setBootError] = useState("");
  const [bootTry, setBootTry] = useState(0);

  const accountsOn = Boolean(health?.accounts?.enabled ?? true);
  const contact: string = health?.contact ?? DEFAULT_CONTACT;
  const canUseFields = Boolean(user);
  const activeField = fields.find((x) => x.id === activeFieldId);

  // Sync browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const goTo = (path: string) => {
    if (window.location.pathname !== path) window.history.replaceState(null, "", path + (path === "/" ? window.location.search : ""));
    setPathname(path);
  };

  // Restore session on boot. Health comes first: without accounts on the server there is nothing to sign in to.
  useEffect(() => {
    let cancelled = false;
    setBootError("");
    (async () => {
      let h: any;
      try { h = await api.health(); } catch {
        if (!cancelled) setBootError("Can't reach the FieldSense server. Check your connection and try again.");
        return;
      }
      if (cancelled) return;
      setHealth(h);
      if (!h?.accounts?.enabled) {
        setUser(LOCAL_USER);
        if (window.location.pathname === "/login" || window.location.pathname === "/signup") goTo("/");
        return;
      }
      try {
        const u = await api.me();
        if (cancelled) return;
        setUser(u);
        // If logged in, do not give access to login or signup!
        if (window.location.pathname === "/login" || window.location.pathname === "/signup") goTo("/");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          setUser(null);
          // If not logged in, redirect to login page
          if (window.location.pathname !== "/signup") goTo("/login");
        } else {
          setBootError(e instanceof Error ? e.message : "Accounts are temporarily unavailable.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [bootTry]);

  // A session that expires or is revoked mid-use sends the user back to sign-in instead of failing silently.
  useEffect(() => {
    onUnauthorized(() => {
      setUser(null); setFields([]); setActiveFieldId(undefined); setView("check");
      setNotice("Your session has ended. Please sign in again.");
      goTo("/login");
    });
    return () => onUnauthorized(null);
  }, []);


  const refreshFields = useCallback(() => {
    if (!canUseFields) return void setFields([]);
    api.fields().then(setFields).catch((e) => setNotice(`Couldn't load saved fields: ${e.message}`));
  }, [canUseFields]);
  useEffect(() => { if (user !== undefined) refreshFields(); }, [user, refreshFields]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Runs a check. With `archiveTo`, the finished report is archived to that saved field's history. */
  const check = useCallback(async (override?: Partial<CheckInput>, archiveTo?: string) => {
    const p = override?.lat != null ? { lat: override.lat, lon: override.lon! } : point;
    if (!p) return;
    const poly = override && "polygon" in override ? override.polygon : polygon ?? undefined;
    const o = { ...opts, ...override };
    setBusy(true); setError(""); setProgress([]); setLand(null); setSat(null); setArchived(null);
    try {
      const { report, reportId } = await runReport({ ...o, lat: p.lat, lon: p.lon, polygon: poly ?? undefined }, (s) => setProgress((x) => [...x, s]));
      setReport(report); setReportId(reportId); setLand(report.land);
      writeLink(p.lat, p.lon, poly);
      if (archiveTo) archive(archiveTo, reportId);
      if (report.landPending) {
        api.land({ lat: p.lat, lon: p.lon, polygon: poly ?? undefined }).then(setLand).catch((e) => setLand({ error: e.message }));
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [point, polygon, opts]);

  // Open a shared link once on load.
  const linkOpened = useRef(false);
  useEffect(() => {
    if (linkOpened.current) return;
    linkOpened.current = true;
    const link = readLink();
    if (!link) return;
    setPoint({ lat: link.lat, lon: link.lon }); setPolygon(link.polygon ?? null);
    check({ lat: link.lat, lon: link.lon, polygon: link.polygon });
  }, [check]);

  useEffect(() => {
    if (tab !== "satellite" || !report || sat) return;
    setSat({ loading: true });
    api.satellite({ lat: report.location.lat, lon: report.location.lon, polygon: report.location.polygon ?? undefined, days: 400 })
      .then(setSat).catch((e) => setSat({ error: e.message }));
  }, [tab, report, sat]);

  /** Re-checks with changed options. A new lab value is a new state of the field, so it is archived; a crop or lime choice isn't. */
  const rerun = (o: Partial<CheckInput>) => { setOpts((x) => ({ ...x, ...o })); check(o, o.lab ? activeFieldId : undefined); };
  const openSaved = (f: SavedField) => {
    setView("check");
    setActiveFieldId(f.id);
    setPoint({ lat: f.lat, lon: f.lon }); setPolygon(f.polygon);
    const t = f.tests[0];
    const lab = t ? { ph: t.ph ?? undefined, organicCarbon: t.organicCarbon ?? undefined, clay: t.clay ?? undefined } : undefined;
    setOpts(lab ? { lab } : {});
    check({ lat: f.lat, lon: f.lon, polygon: f.polygon ?? undefined, lab }, f.id);
  };
  /** Shows an archived check of a saved field. */
  const openArchived = (f: SavedField, r: Report, id: string, c: CheckMeta) => {
    setView("check"); setActiveFieldId(f.id); setArchived(c); setArchivedId(id);
    setPoint({ lat: f.lat, lon: f.lon }); setPolygon(f.polygon);
    setReport(r); setReportId(id); setLand(r.land); setSat(null); setError(""); setTab("overview");
    // Land health was still loading when this check was archived: fetch it now (it's cached server-side).
    if (r.landPending) api.land({ lat: r.location.lat, lon: r.location.lon, polygon: r.location.polygon ?? undefined }).then(setLand).catch((e) => setLand({ error: e.message }));
  };
  /** Gate an action behind sign-in when accounts are on; runs it straight after a successful sign-in. */
  const withAccount = (reason: string, fn: () => void) => (canUseFields ? fn() : setAuthFor({ reason, then: fn }));

  /** Adds a finished check to a saved field's history (and makes it the field's current summary). */
  async function archive(fieldId: string, id: string, quiet = true) {
    try {
      const { field } = await api.archiveCheck(fieldId, id);
      setArchivedId(id);
      setFields((list) => list.map((x) => (x.id === field.id ? field : x)));
      if (!quiet) setNotice(t("Saved to {name}'s history", { name: field.name }));
    } catch (e: any) { setNotice(t("Couldn't save this check to the field's history: {error}", { error: e.message })); }
  }
  const pdf = async () => {
    try { await api.reportPdf(reportId, activeField?.name); } catch (e: any) { setNotice(e.message); }
  };
  const signedOut = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setFields([]);
    setActiveFieldId(undefined);
    setView("check");
    goTo("/login");
  };

  // 0. Server or accounts database unreachable
  if (bootError && user === undefined) {
    return (
      <div className="session-loader">
        <span className="session-loader-diamond">◆</span>
        <h2>FieldSense</h2>
        <p className="form-error" role="alert">{t(bootError)}</p>
        <button className="primary" onClick={() => setBootTry((n) => n + 1)}>{t("Try again")}</button>
      </div>
    );
  }

  // 1. Session check in progress
  if (user === undefined) {
    return (
      <div className="session-loader">
        <span className="session-loader-diamond">◆</span>
        <h2>FieldSense</h2>
        <p className="muted small">{t("Checking secure session…")}</p>
      </div>
    );
  }

  // 2. Unauthenticated: Redirect/display dedicated Login & Signup
  if (user === null) {
    return (
      <AuthPage
        initialMode={pathname === "/signup" ? "signup" : "login"}
        contact={contact}
        notice={notice}
        onSuccess={(u) => {
          setUser(u);
          setNotice("");
          goTo("/");
        }}
      />
    );
  }

  // 3. Authenticated: Full access to FieldSense
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> FieldSense
          <small>{t("soil · crops · climate · satellites")}</small>
        </div>
        <nav>
          <button className={view === "check" ? "active" : ""} onClick={() => setView("check")}>{t("Check a field")}</button>
          <button className={view === "fields" ? "active" : ""} onClick={() => setView("fields")}>
            {t("My fields ({n})", { n: fields.length })}
          </button>
          {report && <button className="agris-btn" onClick={() => setChatOpen((o) => !o)}>💬 {t("Ask Agris")}</button>}
          <AlertsBell fieldsCount={fields.length} onOpenField={(id) => { const f = fields.find((x) => x.id === id); if (f) openSaved(f); }} />
          <LanguagePicker />
          {accountsOn ? (
            <>
              {user.role === "admin" && <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>{t("Admin")}</button>}
              <div className="user-profile-badge" title={user.email}>
                <span className="user-avatar-dot" />
                <span>{user.name}</span>
              </div>
              <button className={view === "account" ? "active" : ""} onClick={() => setView("account")} title={t("Account settings")}>⚙ {t("Settings")}</button>
              <button className="user-signout-btn" onClick={signedOut} title={t("Sign out of FieldSense")}>{t("Sign out")}</button>
            </>
          ) : (
            <div className="user-profile-badge" title={t("Accounts are off on this server: saved fields are shared by everyone using it")}>
              <span className="user-avatar-dot" />
              <span>{user.name}</span>
            </div>
          )}
          <a href={`mailto:${contact}`} className="contact-link" title="Contact SenseGrass">✉ {contact}</a>
        </nav>
      </header>

      <main className={`layout ${view}`}>
        <section className="left">
          <MapPanel point={point} polygon={polygon}

            onPoint={(lat, lon) => { setPoint({ lat, lon }); setActiveFieldId(undefined); }}
            onPolygon={(r) => {
              setPolygon(r); setActiveFieldId(undefined);
              if (r) setPoint({ lat: r.reduce((a, p) => a + p[1], 0) / r.length, lon: r.reduce((a, p) => a + p[0], 0) / r.length });
            }}
            ndviTiles={sat?.tiles} saved={fields} onOpenSaved={openSaved} />
          <div className="check-bar">
            <div className="coords">
              {polygon ? <>{t("Field outline · {n} corners", { n: polygon.length })}</> : point ? <>📍 {point.lat.toFixed(4)}, {point.lon.toFixed(4)}</> : <>{t("Drop a pin or outline a field on the map")}</>}
            </div>
            <button className="primary big" disabled={!point || busy} onClick={() => check(undefined, activeFieldId)}>{busy ? t("Checking…") : t("Check this field")}</button>
          </div>
        </section>

        <section className="right">
          {view === "admin" && user.role === "admin" ? (
            <Admin me={user} />
          ) : view === "account" && accountsOn ? (
            <Account user={user} onUser={setUser} onSignedOut={signedOut} />
          ) : view === "fields" && canUseFields ? (
            <Fields fields={fields} activeId={activeFieldId} onOpen={openSaved} onOpenArchived={openArchived} onChange={refreshFields} onNotice={setNotice} />
          ) : busy ? (
            <div className="progress card">
              <h2>{t("Reading your field…")}</h2>
              <ol>{progress.map((p, i) => <li key={i} className={i === progress.length - 1 ? "now" : "done"}>{t(p)}</li>)}</ol>
              <p className="muted">{t("First checks in a new area fetch 35 years of daily weather, soil maps and satellite records. Repeat checks are instant.")}</p>
            </div>
          ) : error ? (
            <div className="card error"><h2>{t("Couldn't check this field")}</h2><p>{error}</p><button onClick={() => check(undefined, activeFieldId)}>{t("Try again")}</button></div>
          ) : report ? (
            <>
              {archived && (
                <div className="archived-banner">
                  <span>🗂 {t("You're viewing the check from {date}.", { date: fmt(archived.checkedAt, { day: "numeric", month: "long", year: "numeric" }) })}</span>
                  <button className="primary" onClick={() => check(undefined, activeFieldId)}>{t("Run a fresh check")}</button>
                </div>
              )}
              <div className="report-head">
                <div>
                  <div className="place">{activeField ? <b>{activeField.name} · </b> : null}
                    {[report.location.place, report.location.region, report.location.country].filter(Boolean).join(", ") || "Your field"}
                    {report.location.areaHa ? ` · ${report.location.areaHa.toFixed(1)} ha` : ""} · {report.location.elevation?.toFixed(0)} m</div>
                  <h1>{report.headline}</h1>
                </div>
                <div className="head-actions">
                  {activeField
                    ? (archivedId === reportId
                      ? <button disabled title={t("Every check of a saved field is kept in its history")}>✓ {t("In field history")}</button>
                      : <button onClick={() => archive(activeField.id, reportId, false)} title={t("Keep this check in the field's history")}>↻ {t("Save to field history")}</button>)
                    : <button onClick={() => withAccount(t("Sign in to save fields and keep their lab tests."), () => setSaving(true))}>☆ {t("Save field")}</button>}
                  <button onClick={() => navigator.clipboard.writeText(location.href).then(() => setNotice(t("Link copied")), () => setNotice(t("Couldn't copy the link")))}>🔗 {t("Copy link")}</button>
                  <button onClick={pdf} title={t("Download the full report as a PDF")}>⤓ {t("PDF report")}</button>
                  <button onClick={() => window.print()}>⎙ {t("Print")}</button>
                  <button onClick={() => download(report)}>⤓ JSON</button>
                </div>
              </div>
              <div className="tabs" role="tablist">
                {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{t(l)}</button>)}
              </div>
              <div className="tab-body">
                {tab === "overview" && <Overview r={report} land={land} go={setTab} />}
                {tab === "soil" && <SoilTab r={report} onLab={(lab) => rerun({ lab })} onLime={(l) => rerun(l)} />}
                {tab === "crops" && <CropsTab r={report} onPick={(cropId) => rerun({ cropId })} />}
                {tab === "fertiliser" && <NutrientTab r={report} reportId={reportId} cropId={fertCrop} onCropId={setFertCrop} field={activeField} onLogged={refreshFields} />}
                {tab === "profit" && <EconomicsTab r={report} onFertiliser={(id) => { setFertCrop(id); setTab("fertiliser"); }} />}
                {tab === "ops" && <OpsTab r={report} />}
                {tab === "climate" && <ClimateTab r={report} />}
                {tab === "land" && <LandTab land={land} />}
                {tab === "satellite" && <SatelliteTab sat={sat} />}
                {tab === "future" && <FutureTab r={report} />}
              </div>
            </>
          ) : (
            <Welcome health={health} contact={contact} onExample={(lat, lon) => { setPoint({ lat, lon }); setPolygon(null); setActiveFieldId(undefined); check({ lat, lon, polygon: undefined }); }} />
          )}
        </section>
      </main>
      {report && chatOpen && <Agris reportId={reportId} r={report} onClose={() => setChatOpen(false)} mode={health?.agris} contact={contact} />}
      {authFor && (
        <AuthDialog reason={authFor.reason} onClose={() => setAuthFor(null)}
          onDone={(u) => { setUser(u); const then = authFor.then; setAuthFor(null); then?.(); }} />
      )}
      {saving && report && (
        <SaveDialog report={report} onClose={() => setSaving(false)} onSaved={(f) => {
          setSaving(false); setActiveFieldId(f.id); setNotice(t("Saved {name}", { name: f.name }));
          setFields((list) => [f, ...list]);
          archive(f.id, reportId).then(refreshFields);
        }} />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

function SaveDialog({ report, onClose, onSaved }: { report: Report; onClose: () => void; onSaved: (f: SavedField) => void }) {
  const t = useT();
  const [name, setName] = useState(report.location.place ? t("{place} field", { place: report.location.place }) : t("My field"));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={t("Save this field")} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError("");
        try {
          const { lat, lon, polygon } = report.location;
          onSaved(await api.saveField({ name, notes, lat, lon, polygon }));
        } catch (err: any) { setError(err.message); setBusy(false); }
      }}>
        <label>{t("Name")} <input required autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>{t("Notes")} <span className="muted small">({t("optional")})</span><textarea rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary big" disabled={busy}>{busy ? t("Saving…") : t("Save field")}</button>
      </form>
    </Modal>
  );
}

function download(r: Report) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
  a.download = `fieldsense-${r.location.lat.toFixed(4)}_${r.location.lon.toFixed(4)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const EXAMPLES: [string, number, number][] = [
  ["Wimmera wheat paddock, Australia", -36.63, 142.16], ["Punjab rice–wheat, India", 30.9, 75.85],
  ["Iowa corn belt, USA", 42.0, -93.75], ["Beauce, France", 48.3, 1.6], ["Rift Valley maize, Kenya", 0.52, 35.27], ["Mato Grosso soy, Brazil", -13.0, -55.9],
];

function Welcome({ health, contact, onExample }: { health: any; contact: string; onExample: (lat: number, lon: number) => void }) {
  const t = useT();
  const i = health?.integrations ?? {};
  const row = (k: string, label: string) => <li key={k} className={i[k] ? "on" : "off"}>{i[k] ? "●" : "○"} {t(label)}</li>;
  return (
    <div className="welcome">
      <h1>{t("Know your field before you plant.")}</h1>
      <p className="lead">{t("Drop a pin or outline a field. FieldSense reads 35 years of daily weather, soil maps, terrain and 25 years of satellite greenness, then scores 67 crops season by season with a daily soil-water balance. You get soil pH and lime, the crops that fit, sowing windows, yields in good and dry years, frost, heat and waterlogging risk, a 16-day operations plan and a 2045 climate outlook.")}</p>
      <p className="lead">{t("Save a field and FieldSense keeps every check in its history, plans its fertiliser, compares crop profits, reviews each harvest against the season, and alerts you to frost, heat, heavy rain and spray windows.")}</p>
      <h3>{t("Try an example")}</h3>
      <div className="examples">{EXAMPLES.map(([n, la, lo]) => <button key={n} onClick={() => onExample(la, lo)}>{t(n)}</button>)}</div>
      <h3>{t("Connected data")}</h3>
      <ul className="integrations">
        {row("openMeteo", "ERA5 history, forecast, SEAS5 seasonal & CMIP6 (Open-Meteo)")}
        {row("nasaPower", "NASA POWER agro-climatology")}
        {row("soilGrids", "ISRIC SoilGrids 2.0")}
        {row("modisOrnl", "MODIS NDVI since 2000 (NASA ORNL)")}
        {row("sentinelStac", "Sentinel-2 L2A on AWS (keyless)")}
        {row("sentinelHub", "Copernicus Data Space / Sentinel Hub")}
        {row("earthEngine", "Google Earth Engine (CHIRPS, WorldCover, JRC water, MERIT, S2, MODIS)")}
        {row("claude", "Agris assistant on Claude")}
        {row("accounts", "Accounts with private saved fields")}
        {row("alertEmails", "Emailed weather alerts (Resend)")}
      </ul>
      <p className="muted small">{t("Grey items are optional. Add keys in .env to switch them on.")}</p>

      <div className="contact-banner">
        <div>
          <b>SenseGrass Precision Agriculture</b>
          <p className="muted small">{t("Enterprise deployments, soil sensor calibration, custom API access & agronomy support:")}</p>
        </div>
        <a href={`mailto:${contact}`} className="contact-pill">✉ {contact}</a>
      </div>
    </div>
  );
}
