import { fromUrl } from "geotiff";
import { config } from "../config.ts";
import { cached, cell, DAY } from "../lib/cache.ts";
import { bbox, pointInRing, toGeometry, toUtm, type Ring } from "../lib/geo.ts";
import { getJson, pool } from "../lib/http.ts";

export interface SceneIndex {
  date: string; scene: string; cloud: number; ndvi: number; ndmi: number; ndre?: number;
  validFraction: number; thumbnail?: string;
}

const EARTH_SEARCH = "https://earth-search.aws.element84.com/v1/search";

/** Sentinel-2 L2A scenes over a point/field from the AWS Open Data catalogue (Element 84 Earth Search, no key). */
export async function searchScenes(ring: Ring, days: number, maxCloud = 60, limit = 100) {
  const end = new Date(), start = new Date(Date.now() - days * DAY);
  const body = {
    collections: ["sentinel-2-l2a"],
    // A pin (no outline) searches as a Point: a one-corner Polygon is rejected by STAC with HTTP 400.
    intersects: toGeometry(ring),
    datetime: `${start.toISOString()}/${end.toISOString()}`,
    query: { "eo:cloud_cover": { lt: maxCloud } },
    sortby: [{ field: "properties.datetime", direction: "desc" }],
    limit,
  };
  const j = await getJson(EARTH_SEARCH, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, source: "Earth Search STAC" });
  return j.features as any[];
}

// SCL classes kept as clear land: vegetation, bare soil, water(6) excluded, unclassified(7) kept.
const CLEAR_SCL = new Set([4, 5, 7]);

/**
 * Field-mean NDVI / NDMI / NDRE for one scene, read directly from Cloud-Optimised GeoTIFFs with HTTP range
 * requests. Only the internal tiles covering the field are downloaded.
 */
async function sceneIndices(item: any, ring: Ring): Promise<SceneIndex | null> {
  const epsg = Number(item.properties["proj:epsg"] ?? String(item.properties["proj:code"] ?? "").split(":")[1]);
  if (!epsg) return null;
  const offset = item.properties["earthsearch:boa_offset_applied"] === false &&
    Number(item.properties["s2:processing_baseline"] ?? 0) >= 4 ? 1000 : 0;

  const b = bbox(ring);
  const corners = [[b.minX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY], [b.maxX, b.minY]].map(([x, y]) => toUtm(x, y, epsg));
  const ex = corners.map((c) => c[0]), ny = corners.map((c) => c[1]);
  const read = async (asset: string, res: number) => {
    const a = item.assets[asset];
    const [, , x0, , , y0] = a["proj:transform"];
    let c0 = Math.floor((Math.min(...ex) - x0) / res), c1 = Math.ceil((Math.max(...ex) - x0) / res);
    let r0 = Math.floor((y0 - Math.max(...ny)) / res), r1 = Math.ceil((y0 - Math.min(...ny)) / res);
    // Points/tiny fields: take a 3x3 window. Cap big fields at 2 km to bound download size.
    if (c1 - c0 < 3) { const m = Math.floor((c0 + c1) / 2); c0 = m - 1; c1 = m + 2; }
    if (r1 - r0 < 3) { const m = Math.floor((r0 + r1) / 2); r0 = m - 1; r1 = m + 2; }
    const cap = Math.round(2000 / res);
    c1 = Math.min(c1, c0 + cap); r1 = Math.min(r1, r0 + cap);
    const tif = await fromUrl(a.href);
    const img = await tif.getImage();
    const data = (await img.readRasters({ window: [c0, r0, c1, r1], interleave: true })) as unknown as ArrayLike<number>;
    return { data, c0, r0, w: c1 - c0, h: r1 - r0, x0, y0, res };
  };
  const [red, nir, swir, re, scl] = await Promise.all([
    read("red", 10), read("nir", 10), read("swir16", 20), read("rededge1", 20), read("scl", 20),
  ]);

  const isPoint = ring.length <= 2;
  let n = 0, clear = 0, sNdvi = 0, sNdmi = 0, sNdre = 0;
  for (let r = 0; r < red.h; r++) {
    for (let c = 0; c < red.w; c++) {
      const e = red.x0 + (red.c0 + c + 0.5) * 10, no = red.y0 - (red.r0 + r + 0.5) * 10;
      if (!isPoint && !inRingUtm(e, no, ring, epsg)) continue;
      n++;
      const c20 = Math.floor((e - scl.x0) / 20) - scl.c0, r20 = Math.floor((scl.y0 - no) / 20) - scl.r0;
      if (c20 < 0 || r20 < 0 || c20 >= scl.w || r20 >= scl.h) continue;
      if (!CLEAR_SCL.has(scl.data[r20 * scl.w + c20])) continue;
      const R = (red.data[r * red.w + c] - offset) / 1e4, N = (nir.data[r * nir.w + c] - offset) / 1e4;
      const S = (swir.data[r20 * swir.w + c20] - offset) / 1e4, E = (re.data[r20 * re.w + c20] - offset) / 1e4;
      if (N + R <= 0) continue;
      clear++;
      sNdvi += (N - R) / (N + R);
      sNdmi += (N - S) / (N + S || 1);
      sNdre += (N - E) / (N + E || 1);
    }
  }
  if (!n || clear / n < 0.3) return null; // mostly cloudy over the field
  return {
    date: item.properties.datetime.slice(0, 10), scene: item.id, cloud: item.properties["eo:cloud_cover"],
    ndvi: sNdvi / clear, ndmi: sNdmi / clear, ndre: sNdre / clear, validFraction: clear / n,
    thumbnail: item.assets.thumbnail?.href,
  };
}

// Cache polygon → UTM per epsg for the inner loop.
const ringCache = new WeakMap<Ring, Map<number, Ring>>();
function inRingUtm(e: number, n: number, ring: Ring, epsg: number) {
  let m = ringCache.get(ring);
  if (!m) ringCache.set(ring, (m = new Map()));
  let u = m.get(epsg);
  if (!u) m.set(epsg, (u = ring.map(([x, y]) => toUtm(x, y, epsg))));
  return pointInRing(e, n, u);
}

/** Keyless Sentinel-2 time series: recent clear scenes, one per date, read from AWS COGs. */
export function s2SeriesKeyless(ring: Ring, days = 365, maxScenes = 30): Promise<SceneIndex[]> {
  const key = `s2:aws:${ring.map(([x, y]) => cell(y, x, 4)).join("|")}:${days}:${new Date().toISOString().slice(0, 10)}`;
  return cached(key, DAY, async () => {
    const items = await searchScenes(ring, days, 50);
    const seen = new Set<string>();
    const picked = items.filter((it) => {
      const d = it.properties.datetime.slice(0, 10);
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });
    // Spread picks evenly across the window instead of only the latest scenes.
    const step = Math.max(1, picked.length / maxScenes);
    const sample = Array.from({ length: Math.min(maxScenes, picked.length) }, (_, i) => picked[Math.floor(i * step)]);
    const out = await pool(sample, 6, (it) => sceneIndices(it, ring).catch(() => null));
    return out.filter((x): x is SceneIndex => x !== null).sort((a, b) => a.date.localeCompare(b.date));
  });
}

// ---------------- Copernicus Data Space Ecosystem (Sentinel Hub APIs), optional ----------------

let token: { value: string; exp: number } | null = null;
async function cdseToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const res = await fetch("https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.cdse.clientId, client_secret: config.cdse.clientSecret }),
  });
  if (!res.ok) throw new Error(`CDSE auth failed: ${res.status}`);
  const j = await res.json();
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

const STATS_EVALSCRIPT = `//VERSION=3
function setup(){return{input:[{bands:["B04","B05","B08","B11","SCL","dataMask"]}],output:[{id:"ndvi",bands:1,sampleType:"FLOAT32"},{id:"ndmi",bands:1,sampleType:"FLOAT32"},{id:"ndre",bands:1,sampleType:"FLOAT32"},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){var clear=[4,5,7].indexOf(s.SCL)>=0?1:0;
return{ndvi:[(s.B08-s.B04)/(s.B08+s.B04)],ndmi:[(s.B08-s.B11)/(s.B08+s.B11)],ndre:[(s.B08-s.B05)/(s.B08+s.B05)],dataMask:[s.dataMask*clear]}}`;

/** Sentinel Hub Statistical API: 5-day field statistics (mean, p10, p90) for up to several years. */
export function s2SeriesCdse(ring: Ring, fromIso: string): Promise<SceneIndex[]> {
  const key = `s2:cdse:${ring.map(([x, y]) => cell(y, x, 4)).join("|")}:${fromIso}:${new Date().toISOString().slice(0, 10)}`;
  return cached(key, DAY, async () => {
    const tk = await cdseToken();
    const body = {
      input: {
        bounds: { geometry: toGeometry(ring), properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
        data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 60 } }],
      },
      aggregation: {
        timeRange: { from: `${fromIso}T00:00:00Z`, to: new Date().toISOString() },
        aggregationInterval: { of: "P5D" }, evalscript: STATS_EVALSCRIPT, resx: 10, resy: 10,
      },
      calculations: { default: { statistics: { default: { percentiles: { k: [10, 90] } } } } },
    };
    const j = await getJson("https://sh.dataspace.copernicus.eu/api/v1/statistics", {
      method: "POST", body: JSON.stringify(body), timeoutMs: 120_000, source: "Sentinel Hub Statistical API",
      headers: { "content-type": "application/json", authorization: `Bearer ${tk}` },
    });
    return (j.data as any[]).map((d) => {
      const st = (k: string) => d.outputs[k]?.bands?.B0?.stats;
      const nd = st("ndvi");
      if (!nd || nd.sampleCount === nd.noDataCount || nd.mean == null || Number.isNaN(nd.mean)) return null;
      return {
        date: d.interval.from.slice(0, 10), scene: "sentinelhub", cloud: NaN,
        ndvi: nd.mean, ndmi: st("ndmi")?.mean, ndre: st("ndre")?.mean,
        validFraction: 1 - nd.noDataCount / nd.sampleCount,
      } as SceneIndex;
    }).filter((x): x is SceneIndex => x !== null && x.validFraction > 0.3);
  });
}

const PNG_EVALSCRIPT = `//VERSION=3
function setup(){return{input:["B04","B08","SCL","dataMask"],output:{bands:4}}}
function evaluatePixel(s){var v=(s.B08-s.B04)/(s.B08+s.B04);var cl=[3,8,9,10].indexOf(s.SCL)>=0;
var c=colorBlend(v,[0,0.2,0.4,0.6,0.8],[[0.65,0.33,0.16],[0.93,0.79,0.45],[0.75,0.87,0.42],[0.27,0.66,0.27],[0.0,0.39,0.18]]);
return cl?[0.6,0.6,0.6,0.6]:[c[0],c[1],c[2],s.dataMask]}`;

/** Sentinel Hub Process API: latest least-cloudy NDVI map for the field as PNG. */
export async function ndviPngCdse(ring: Ring): Promise<{ png: Buffer; bbox: number[] }> {
  const tk = await cdseToken();
  const b = bbox(ring);
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.15 || 0.003;
  const bb = [b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad];
  const body = {
    input: {
      bounds: { bbox: bb, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
      data: [{ type: "sentinel-2-l2a", dataFilter: { timeRange: { from: new Date(Date.now() - 45 * DAY).toISOString(), to: new Date().toISOString() }, mosaickingOrder: "leastCC" } }],
    },
    output: { width: 512, height: 512, responses: [{ identifier: "default", format: { type: "image/png" } }] },
    evalscript: PNG_EVALSCRIPT,
  };
  const res = await fetch("https://sh.dataspace.copernicus.eu/api/v1/process", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk}` }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sentinel Hub process: ${res.status} ${await res.text()}`);
  return { png: Buffer.from(await res.arrayBuffer()), bbox: bb };
}
