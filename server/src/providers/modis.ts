import { cached, cell, DAY } from "../lib/cache.ts";
import { getJson, pool } from "../lib/http.ts";

export interface NdviPoint { date: string; ndvi: number }

/**
 * MODIS MOD13Q1 (250 m, 16-day) NDVI from Feb 2000 via the ORNL DAAC web service — no key needed.
 * The service allows 10 composites per call, so each year is fetched in three windows.
 */
export function modisNdviOrnl(lat: number, lon: number): Promise<NdviPoint[]> {
  return cached(`modis:ornl:${cell(lat, lon, 3)}:${new Date().toISOString().slice(0, 7)}`, 30 * DAY, async () => {
    const thisYear = new Date().getUTCFullYear();
    const windows: [string, string][] = [];
    for (let y = 2000; y <= thisYear; y++) {
      windows.push([`A${y}001`, `A${y}144`], [`A${y}145`, `A${y}288`], [`A${y}289`, `A${y}366`]);
    }
    const chunks = await pool(windows, 8, async ([s, e]) => {
      try {
        const j = await getJson(
          `https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=${lat}&longitude=${lon}` +
          `&band=250m_16_days_NDVI&startDate=${s}&endDate=${e}&kmAboveBelow=0&kmLeftRight=0`,
          { timeoutMs: 45_000, retries: 2, source: "ORNL DAAC MODIS" });
        return (j.subset ?? []).map((r: any) => ({ date: r.calendar_date, ndvi: r.data[0] * 0.0001 }));
      } catch {
        return [] as NdviPoint[]; // future windows / transient failures leave a gap rather than failing the report
      }
    });
    const pts = chunks.flat().filter((p: NdviPoint) => p.ndvi > -0.2 && p.ndvi <= 1);
    if (pts.length < 50) throw new Error("ORNL MODIS returned too little data");
    return pts.sort((a: NdviPoint, b: NdviPoint) => a.date.localeCompare(b.date));
  });
}
