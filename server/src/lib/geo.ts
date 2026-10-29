export type LonLat = [number, number];
/** GeoJSON-style ring: [[lon, lat], ...] */
export type Ring = LonLat[];

export function bbox(ring: Ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
}

export function pointInRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Drops non-finite points, repeated consecutive corners and the GeoJSON closing corner: an open ring of distinct corners. */
export function cleanRing(ring: Ring): Ring {
  const same = (a: LonLat, b: LonLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const out: Ring = [];
  for (const p of ring) {
    if (!Number.isFinite(p?.[0]) || !Number.isFinite(p?.[1])) continue;
    if (!out.length || !same(out[out.length - 1], p)) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** True when an (open) ring has 3+ distinct corners enclosing at least 1 m², i.e. a valid GeoJSON polygon once closed. */
export function isArea(ring: Ring) {
  if (ring.length < 3) return false;
  // Collinear corners enclose nothing in lon/lat, yet areaHa's sin(lat) terms report a small area for them away
  // from the equator. Shoelace relative to the first corner, compared with the outline's extent, catches them.
  const [x0, y0] = ring[0], b = bbox(ring);
  let s = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    s += (ring[i][0] - x0) * (ring[i + 1][1] - y0) - (ring[i + 1][0] - x0) * (ring[i][1] - y0);
  }
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  return Math.abs(s) > 1e-9 * extent * extent && areaHa(ring) >= 1e-4;
}

/** GeoJSON geometry for a field: a closed Polygon when the outline encloses an area, otherwise a Point at its centre. */
export function toGeometry(ring: Ring): { type: "Polygon"; coordinates: Ring[] } | { type: "Point"; coordinates: LonLat } {
  const r = cleanRing(ring);
  if (isArea(r)) return { type: "Polygon", coordinates: [[...r, r[0]]] };
  if (!r.length) throw new Error("Field location is missing");
  return { type: "Point", coordinates: centroid(r) };
}

export function centroid(ring: Ring): LonLat {
  const b = bbox(ring);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** Geodesic polygon area in hectares (spherical excess approximation). */
export function areaHa(ring: Ring) {
  const R = 6378137, rad = Math.PI / 180;
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    s += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
  }
  return Math.abs((s * R * R) / 2) / 10_000;
}

/** WGS84 lon/lat → UTM easting/northing for the given EPSG (326xx / 327xx). */
export function toUtm(lon: number, lat: number, epsg: number): [number, number] {
  const zone = epsg % 100, south = Math.floor(epsg / 100) === 327;
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const rad = Math.PI / 180, phi = lat * rad, lam = lon * rad, lam0 = ((zone - 1) * 6 - 180 + 3) * rad;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (south) y += 10_000_000;
  return [x, y];
}
