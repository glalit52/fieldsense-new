import fs from "node:fs";
// @ts-ignore — the Earth Engine client ships without types
import ee from "@google/earthengine";
import { config } from "../config.ts";
import { cached, cell, DAY } from "../lib/cache.ts";
import type { Ring } from "../lib/geo.ts";
import type { SoilLayer, SoilProfile } from "./soilgrids.ts";

let ready: Promise<void> | null = null;

export function geeEnabled() {
  return Boolean(config.gee.keyFile || config.gee.keyJson);
}

function init(): Promise<void> {
  if (!geeEnabled()) return Promise.reject(new Error("Earth Engine not configured"));
  ready ??= new Promise<void>((resolve, reject) => {
    const key = JSON.parse(config.gee.keyJson || fs.readFileSync(config.gee.keyFile, "utf8"));
    ee.data.authenticateViaPrivateKey(key, () => {
      ee.initialize(null, null, () => resolve(), (e: unknown) => reject(e), null, config.gee.project || key.project_id);
    }, (e: unknown) => reject(e));
  }).catch((e) => { ready = null; throw e; });
  return ready;
}

function evaluate<T>(obj: any): Promise<T> {
  return new Promise((resolve, reject) => obj.evaluate((v: T, err: string) => (err ? reject(new Error(err)) : resolve(v))));
}

function geom(ring: Ring, lat: number, lon: number) {
  return ring.length >= 3 ? ee.Geometry.Polygon([ring]) : ee.Geometry.Point([lon, lat]).buffer(60);
}

const key = (ring: Ring, lat: number, lon: number) => (ring.length >= 3 ? ring.map(([x, y]) => cell(y, x, 4)).join("|") : cell(lat, lon, 4));

/** MODIS MOD13Q1 NDVI (250 m) mean over the field, every 16 days since 2000. */
export function geeModisNdvi(ring: Ring, lat: number, lon: number) {
  return cached(`gee:modis:${key(ring, lat, lon)}:${new Date().toISOString().slice(0, 7)}`, 30 * DAY, async () => {
    await init();
    const g = geom(ring, lat, lon);
    const col = ee.ImageCollection("MODIS/061/MOD13Q1").select(["NDVI", "SummaryQA"]);
    const fc = col.map((img: any) => {
      const good = img.select("SummaryQA").lte(1);
      const v = img.select("NDVI").updateMask(good).multiply(0.0001).reduceRegion({ reducer: ee.Reducer.mean(), geometry: g, scale: 250, bestEffort: true });
      return ee.Feature(null, { date: img.date().format("YYYY-MM-dd"), ndvi: v.get("NDVI") });
    }).filter(ee.Filter.notNull(["ndvi"]));
    const rows = await evaluate<any>(fc.reduceColumns(ee.Reducer.toList(2), ["date", "ndvi"]));
    return (rows.list as [string, number][]).map(([date, ndvi]) => ({ date, ndvi }));
  });
}

/** Cloud-masked Sentinel-2 SR (harmonised) NDVI / NDMI / NDRE field means since 2017. */
export function geeS2Series(ring: Ring, lat: number, lon: number, fromIso = "2017-04-01") {
  return cached(`gee:s2:${key(ring, lat, lon)}:${fromIso}:${new Date().toISOString().slice(0, 10)}`, DAY, async () => {
    await init();
    const g = geom(ring, lat, lon);
    const col = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(g).filterDate(fromIso, ee.Date(Date.now()))
      .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 60));
    const fc = col.map((img: any) => {
      const scl = img.select("SCL");
      const m = scl.eq(4).or(scl.eq(5)).or(scl.eq(7));
      const s = img.updateMask(m).divide(10000);
      const idx = ee.Image.cat(
        s.normalizedDifference(["B8", "B4"]).rename("ndvi"),
        s.normalizedDifference(["B8", "B11"]).rename("ndmi"),
        s.normalizedDifference(["B8", "B5"]).rename("ndre"),
        m.rename("clear"),
      );
      const r = idx.reduceRegion({ reducer: ee.Reducer.mean(), geometry: g, scale: 10, bestEffort: true, maxPixels: 1e8 });
      return ee.Feature(null, { date: img.date().format("YYYY-MM-dd"), ndvi: r.get("ndvi"), ndmi: r.get("ndmi"), ndre: r.get("ndre"), clear: r.get("clear") });
    }).filter(ee.Filter.notNull(["ndvi"])).filter(ee.Filter.gt("clear", 0.3));
    const rows = await evaluate<any>(fc.reduceColumns(ee.Reducer.toList(5), ["date", "ndvi", "ndmi", "ndre", "clear"]));
    const byDate = new Map<string, any>();
    for (const [date, ndvi, ndmi, ndre, clear] of rows.list) byDate.set(date, { date, ndvi, ndmi, ndre, validFraction: clear, scene: "gee", cloud: NaN });
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
}

/** Static land context: CHIRPS annual rain, ESA WorldCover, JRC surface water, MERIT Hydro terrain wetness. */
export function geeLandContext(ring: Ring, lat: number, lon: number) {
  return cached(`gee:ctx:${key(ring, lat, lon)}`, 90 * DAY, async () => {
    await init();
    const g = geom(ring, lat, lon);
    const pt = ee.Geometry.Point([lon, lat]);
    const thisYear = new Date().getUTCFullYear();
    const years = ee.List.sequence(1981, thisYear - 1);
    const chirps = ee.FeatureCollection(years.map((y: any) => {
      const tot = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").filter(ee.Filter.calendarRange(y, y, "year")).sum();
      return ee.Feature(null, { year: y, rain: tot.reduceRegion({ reducer: ee.Reducer.mean(), geometry: pt, scale: 5566 }).get("precipitation") });
    }));
    const wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
      .reduceRegion({ reducer: ee.Reducer.frequencyHistogram(), geometry: g, scale: 10, bestEffort: true }).get("Map");
    const gsw = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0)
      .reduceRegion({ reducer: ee.Reducer.max(), geometry: g, scale: 30, bestEffort: true }).get("occurrence");
    const merit = ee.Image("MERIT/Hydro/v1_0_1");
    const slope = ee.Terrain.slope(merit.select("elv"));
    const twi = merit.select("upa").multiply(1e6).divide(90).log().subtract(slope.multiply(Math.PI / 180).tan().max(0.001).log()).rename("twi");
    const terr = ee.Image.cat(slope.rename("slope"), twi, merit.select("hnd"))
      .reduceRegion({ reducer: ee.Reducer.mean(), geometry: g, scale: 90, bestEffort: true });
    const res = await evaluate<any>(ee.Dictionary({
      chirps: chirps.reduceColumns(ee.Reducer.toList(2), ["year", "rain"]).get("list"),
      worldcover: wc, waterOccurrence: gsw, terrain: terr,
    }));
    const WC: Record<string, string> = { 10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland", 50: "Built-up", 60: "Bare / sparse", 70: "Snow & ice", 80: "Water", 90: "Wetland", 95: "Mangroves", 100: "Moss & lichen" };
    const hist = res.worldcover ?? {};
    const tot = Object.values(hist).reduce((a: number, b: any) => a + b, 0) as number;
    return {
      chirpsAnnual: (res.chirps as [number, number][]).map(([year, rain]) => ({ year, rain })),
      landCover: Object.entries(hist).map(([k, v]) => ({ class: WC[k] ?? k, fraction: (v as number) / (tot || 1) })).sort((a, b) => b.fraction - a.fraction),
      maxWaterOccurrence: res.waterOccurrence ?? 0,
      slopeDeg: res.terrain?.slope ?? null, twi: res.terrain?.twi ?? null, heightAboveDrainage: res.terrain?.hnd ?? null,
    };
  });
}

/** SoilGrids 250 m means hosted on Earth Engine — fallback when the ISRIC REST API is down. */
export function geeSoilGrids(lat: number, lon: number): Promise<SoilProfile> {
  return cached(`gee:soil:${cell(lat, lon, 3)}`, 365 * DAY, async () => {
    await init();
    const props: [string, keyof SoilLayer, number][] = [
      ["phh2o", "ph", 10], ["soc", "soc", 10], ["clay", "clay", 10], ["sand", "sand", 10], ["silt", "silt", 10],
      ["cec", "cec", 10], ["nitrogen", "nitrogen", 100], ["bdod", "bdod", 100], ["cfvo", "cfvo", 10],
    ];
    const depths = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"];
    const img = ee.Image.cat(props.map(([p]) => ee.Image(`projects/soilgrids-isric/${p}_mean`)));
    const v = await evaluate<Record<string, number>>(img.reduceRegion({ reducer: ee.Reducer.first(), geometry: ee.Geometry.Point([lon, lat]), scale: 250 }));
    // Regional RMSE from SoilGrids validation, used to build 80% bands around the mean.
    const sd: Record<string, number> = { ph: 0.55, soc: 0.45, clay: 0.3, sand: 0.3, silt: 0.3, cec: 0.4, nitrogen: 0.45, bdod: 0.1, cfvo: 0.6 };
    const layers = depths.map((d) => {
      const [top, bottom] = d.replace("cm", "").split("-").map(Number);
      const L: any = { depth: d, top, bottom };
      for (const [p, k, scale] of props) {
        const raw = v[`${p}_${d}_mean`];
        if (raw == null) continue;
        const m = raw / scale, s = k === "ph" ? sd.ph : Math.abs(m) * sd[k as string];
        L[k] = { p10: m - 1.28 * s, p50: m, p90: m + 1.28 * s };
      }
      return L as SoilLayer;
    });
    if (!layers[0].ph) throw new Error("No SoilGrids pixel at this location");
    return { source: "ISRIC SoilGrids 2.0 via Google Earth Engine", confidence: "medium" as const, layers };
  });
}

/** XYZ tile URL for a recent cloud-free Sentinel-2 NDVI mosaic, for the map overlay. */
export function geeNdviTiles(lat: number, lon: number) {
  return cached(`gee:tiles:${cell(lat, lon, 1)}:${new Date().toISOString().slice(0, 10)}`, DAY / 2, async () => {
    await init();
    const region = ee.Geometry.Point([lon, lat]).buffer(20000);
    const img = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(region)
      .filterDate(ee.Date(Date.now()).advance(-40, "day"), ee.Date(Date.now()))
      .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 40)).median().normalizedDifference(["B8", "B4"]);
    const map = await new Promise<any>((resolve, reject) =>
      img.getMapId({ min: 0, max: 0.9, palette: ["a5542a", "edc973", "bfde6b", "45a945", "00632e"] }, (m: any, e: string) => (e ? reject(new Error(e)) : resolve(m))));
    return { url: map.urlFormat as string };
  });
}
