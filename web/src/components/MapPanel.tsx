import { useEffect, useState } from "react";
import L from "leaflet";
import { CircleMarker, LayersControl, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { api, type LonLat } from "../lib/api.ts";

interface Props {
  point: { lat: number; lon: number } | null;
  polygon: LonLat[] | null;
  onPoint: (lat: number, lon: number) => void;
  onPolygon: (ring: LonLat[] | null) => void;
  ndviTiles?: string | null;
  saved: any[];
  onOpenSaved: (f: any) => void;
}

function Clicks({ mode, onPoint, onVertex }: { mode: "pin" | "draw"; onPoint: Props["onPoint"]; onVertex: (ll: LonLat) => void }) {
  useMapEvents({
    click(e) {
      if (mode === "pin") onPoint(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5));
      else onVertex([+e.latlng.lng.toFixed(6), +e.latlng.lat.toFixed(6)]);
    },
  });
  return null;
}

/** Follow the active pin when it changes from outside the map (examples, saved fields). */
function Follow({ point }: { point: Props["point"] }) {
  const map = useMap();
  useEffect(() => {
    if (point && !map.getBounds().pad(-0.2).contains([point.lat, point.lon])) map.flyTo([point.lat, point.lon], Math.max(map.getZoom(), 14), { duration: 0.8 });
    else if (point && map.getZoom() < 10) map.flyTo([point.lat, point.lon], 14, { duration: 0.8 });
  }, [point, map]);
  return null;
}

function FlyTo({ target }: { target: { lat: number; lon: number; zoom?: number } | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo([target.lat, target.lon], target.zoom ?? Math.max(map.getZoom(), 14), { duration: 0.8 }); }, [target, map]);
  return null;
}

export default function MapPanel({ point, polygon, onPoint, onPolygon, ndviTiles, saved, onOpenSaved }: Props) {
  const [mode, setMode] = useState<"pin" | "draw">("pin");
  const [draft, setDraft] = useState<LonLat[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [fly, setFly] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);

  const finish = () => {
    if (draft.length >= 3) { onPolygon(draft); setMode("pin"); setDraft([]); }
  };
  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    const ll = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (ll && Math.abs(+ll[1]) <= 90 && Math.abs(+ll[2]) <= 180) { setFly({ lat: +ll[1], lon: +ll[2], zoom: 15 }); onPolygon(null); onPoint(+ll[1], +ll[2]); return; }
    const r = await api.geocode(q).catch(() => []);
    setResults(Array.isArray(r) ? r : []);
    if (r[0]) setFly({ lat: r[0].lat, lon: r[0].lon, zoom: 13 });
  };
  const locate = () => navigator.geolocation?.getCurrentPosition((p) => {
    const lat = +p.coords.latitude.toFixed(5), lon = +p.coords.longitude.toFixed(5);
    setFly({ lat, lon, zoom: 16 }); onPoint(lat, lon);
  });

  return (
    <div className="map-wrap">
      <MapContainer center={point ? [point.lat, point.lon] : [-36.63, 142.16]} zoom={point ? 14 : 4} className="map" worldCopyJump>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer attribution="Esri, Maxar, Earthstar Geographics" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Map">
            <TileLayer attribution="© OpenStreetMap" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Terrain">
            <TileLayer attribution="Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.Overlay checked name="Place names">
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
          </LayersControl.Overlay>
          {ndviTiles && (
            <LayersControl.Overlay checked name="Sentinel-2 NDVI (40 days)">
              <TileLayer url={ndviTiles} opacity={0.75} attribution="Copernicus Sentinel-2 via Google Earth Engine" />
            </LayersControl.Overlay>
          )}
        </LayersControl>
        <Clicks mode={mode} onPoint={(a, b) => { onPolygon(null); onPoint(a, b); }} onVertex={(ll) => setDraft((d) => {
          // A double-click lands twice on the same corner; a repeated corner doesn't outline anything.
          const last = d[d.length - 1];
          return last && last[0] === ll[0] && last[1] === ll[1] ? d : [...d, ll];
        })} />
        <FlyTo target={fly} />
        <Follow point={point} />
        {saved.map((s) => (
          <CircleMarker key={s.id} center={[s.lat, s.lon]} radius={6} pathOptions={{ color: "#fff", weight: 2, fillColor: "#f59e0b", fillOpacity: 1 }} eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onOpenSaved(s); } }}>
            <Tooltip>{s.name}</Tooltip>
          </CircleMarker>
        ))}
        {polygon && <Polygon positions={polygon.map(([x, y]) => [y, x] as [number, number])} pathOptions={{ color: "#a3e635", weight: 3, fillOpacity: 0.12 }} />}
        {draft.length > 0 && <Polyline positions={draft.map(([x, y]) => [y, x] as [number, number])} pathOptions={{ color: "#facc15", dashArray: "6 4", weight: 3 }} />}
        {draft.map(([x, y], i) => <CircleMarker key={i} center={[y, x]} radius={4} pathOptions={{ color: "#facc15", fillOpacity: 1 }} />)}
        {point && !polygon && <CircleMarker center={[point.lat, point.lon]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#22c55e", fillOpacity: 1 }} />}
      </MapContainer>

      <form className="map-search" onSubmit={doSearch}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a town, region or paste lat, lon" aria-label="Search location" />
        <button type="submit">Go</button>
        {results.length > 1 && (
          <ul className="search-results">
            {results.map((r) => <li key={r.name}><button type="button" onClick={() => { setFly({ lat: r.lat, lon: r.lon, zoom: 13 }); setResults([]); }}>{r.name}</button></li>)}
          </ul>
        )}
      </form>

      <div className="map-tools">
        <button className={mode === "pin" ? "active" : ""} onClick={() => { setMode("pin"); setDraft([]); }} title="Drop a pin">📍 Pin</button>
        <button className={mode === "draw" ? "active" : ""} onClick={() => { setMode("draw"); setDraft([]); }} title="Outline a field">✏️ Outline field</button>
        <button onClick={locate} title="Use my location">◎ Where I am</button>
        {mode === "draw" && (
          <>
            <button onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length}>Undo</button>
            <button className="primary" onClick={finish} disabled={draft.length < 3}>Finish ({draft.length})</button>
          </>
        )}
      </div>
      {mode === "draw" && <div className="map-hint">Click the field corners, then press Finish.</div>}
    </div>
  );
}
