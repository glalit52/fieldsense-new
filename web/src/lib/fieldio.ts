import type { LonLat, SavedField } from "./api.ts";

/** A field as the import endpoint takes it: a pin (lat/lon) or an outline. */
export interface ImportRow { name: string; lat?: number; lon?: number; polygon?: LonLat[]; notes?: string }

export function downloadFile(name: string, body: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Saved fields as a GeoJSON FeatureCollection (outlines as Polygons, pins as Points), for QGIS, Google Earth, farm software. */
export function exportGeoJson(fields: SavedField[]) {
  const features = fields.map((x) => ({
    type: "Feature",
    geometry: x.polygon
      ? { type: "Polygon", coordinates: [[...x.polygon, x.polygon[0]]] }
      : { type: "Point", coordinates: [x.lon, x.lat] },
    properties: {
      name: x.name, notes: x.notes, ...(x.summary ?? {}),
      latestLab: x.tests[0] ?? null, activities: x.activities.length,
    },
  }));
  downloadFile(`fieldsense-fields-${new Date().toISOString().slice(0, 10)}.geojson`,
    JSON.stringify({ type: "FeatureCollection", features }, null, 2), "application/geo+json");
}

/** RFC 4180-ish: quoted cells, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

function fromCsv(text: string): ImportRow[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) throw new Error("The CSV file is empty");
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const iName = col("name", "field", "field_name"), iLat = col("lat", "latitude", "y"), iLon = col("lon", "lng", "long", "longitude", "x"), iNotes = col("notes", "note", "description");
  if (iLat < 0 || iLon < 0) throw new Error("The CSV needs lat and lon columns (a name column is optional)");
  return rows.map((r, i) => ({
    name: (iName >= 0 ? r[iName]?.trim() : "") || `Imported field ${i + 1}`,
    lat: Number(r[iLat]), lon: Number(r[iLon]),
    // Our own CSV export guards formula-like text with a leading apostrophe; undo that.
    notes: iNotes >= 0 ? (r[iNotes] ?? "").replace(/^'(?=[=+\-@])/, "") : "",
  }));
}

function fromGeoJson(text: string): ImportRow[] {
  const gj = JSON.parse(text);
  const features: any[] = gj?.type === "FeatureCollection" ? gj.features : gj?.type === "Feature" ? [gj] : [];
  const rows: ImportRow[] = [];
  features.forEach((ft, i) => {
    const g = ft?.geometry, p = ft?.properties ?? {};
    const name = String(p.name ?? p.Name ?? p.NAME ?? p.title ?? `Imported field ${i + 1}`).slice(0, 120);
    const notes = typeof p.notes === "string" ? p.notes : typeof p.description === "string" ? p.description : "";
    // A MultiPolygon contributes its first part; GeoJSON rings repeat the first corner at the end, the API doesn't.
    const ring: LonLat[] | undefined = g?.type === "Polygon" ? g.coordinates?.[0] : g?.type === "MultiPolygon" ? g.coordinates?.[0]?.[0] : undefined;
    if (ring?.length) {
      const pts = ring.map((c) => [Number(c[0]), Number(c[1])] as LonLat);
      const [a, b] = [pts[0], pts[pts.length - 1]];
      if (pts.length > 3 && a[0] === b[0] && a[1] === b[1]) pts.pop();
      rows.push({ name, notes, polygon: pts });
    } else if (g?.type === "Point") {
      rows.push({ name, notes, lon: Number(g.coordinates[0]), lat: Number(g.coordinates[1]) });
    }
  });
  return rows;
}

/** Reads a .csv, .geojson or .json file into import rows. Validation of coordinates happens on the server. */
export async function parseImportFile(file: File): Promise<ImportRow[]> {
  const text = await file.text();
  const rows = /\.csv$/i.test(file.name) || !/^\s*[{[]/.test(text) ? fromCsv(text) : fromGeoJson(text);
  if (!rows.length) throw new Error("No fields found in the file (expected points or polygons)");
  return rows;
}
