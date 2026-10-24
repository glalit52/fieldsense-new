import { cached, cell, DAY } from "../lib/cache.ts";
import { getJson } from "../lib/http.ts";
import type { Range, SoilLayer, SoilProfile } from "./soilgrids.ts";

/** Rough CONUS / Alaska / Hawaii / PR envelope — SSURGO only covers US soil surveys. */
export function inUS(lat: number, lon: number) {
  return (lat > 24 && lat < 50 && lon > -125 && lon < -66) || (lat > 51 && lat < 72 && lon > -170 && lon < -129) ||
    (lat > 18.5 && lat < 22.5 && lon > -161 && lon < -154) || (lat > 17.8 && lat < 18.6 && lon > -67.4 && lon < -65.2);
}

const DRAIN: Record<string, SoilProfile["drainage"]> = {
  "Excessively drained": "excessive", "Somewhat excessively drained": "excessive", "Well drained": "well",
  "Moderately well drained": "moderate", "Somewhat poorly drained": "imperfect", "Poorly drained": "poor", "Very poorly drained": "poor",
};

/**
 * USDA NRCS SSURGO via Soil Data Access (keyless SQL over the national soil survey) — field-scale
 * (1:12,000–1:24,000) mapped soils with measured horizon data. Uses the dominant major component.
 */
export function ssurgo(lat: number, lon: number): Promise<SoilProfile> {
  return cached(`ssurgo:${cell(lat, lon, 4)}`, 365 * DAY, async () => {
    const q = `SELECT mu.muname, c.compname, c.comppct_r, c.drainagecl, ch.hzdept_r, ch.hzdepb_r,
      ch.ph1to1h2o_l, ch.ph1to1h2o_r, ch.ph1to1h2o_h, ch.om_l, ch.om_r, ch.om_h, ch.claytotal_l, ch.claytotal_r, ch.claytotal_h,
      ch.sandtotal_r, ch.silttotal_r, ch.cec7_r, ch.dbthirdbar_r, ch.awc_r
      FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lon.toFixed(6)} ${lat.toFixed(6)})') AS k
      INNER JOIN mapunit mu ON mu.mukey = k.mukey INNER JOIN component c ON c.mukey = mu.mukey
      INNER JOIN chorizon ch ON ch.cokey = c.cokey
      WHERE c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC, c.cokey, ch.hzdept_r`;
    const j = await getJson("https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "JSON+COLUMNNAME", query: q }),
      timeoutMs: 30_000, retries: 1, source: "USDA SSURGO",
    });
    const [head, ...rows] = (j.Table ?? []) as string[][];
    if (!head || !rows.length) throw new Error("No SSURGO map unit here");
    const recs = rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    const first = recs[0];
    const hz = recs.filter((r) => r.compname === first.compname && r.comppct_r === first.comppct_r && r.hzdept_r != null);
    const n = (v: string | null) => (v == null || v === "" ? NaN : Number(v));
    const DEPTHS: [string, number, number][] = [["0-5cm", 0, 5], ["5-15cm", 5, 15], ["15-30cm", 15, 30], ["30-60cm", 30, 60], ["60-100cm", 60, 100]];
    let awcSum = 0, awcCm = 0;
    const layers: SoilLayer[] = DEPTHS.map(([depth, top, bottom]) => {
      const L: any = { depth, top, bottom };
      const acc: Record<string, { w: number; lo: number; mid: number; hi: number }> = {};
      const add = (k: string, mid: number, lo = mid, hi = mid, w = 1) => {
        if (!Number.isFinite(mid)) return;
        const a = (acc[k] ??= { w: 0, lo: 0, mid: 0, hi: 0 });
        a.w += w; a.mid += mid * w; a.lo += (Number.isFinite(lo) ? lo : mid) * w; a.hi += (Number.isFinite(hi) ? hi : mid) * w;
      };
      for (const h of hz) {
        const ov = Math.max(0, Math.min(bottom, n(h.hzdepb_r)) - Math.max(top, n(h.hzdept_r)));
        if (!ov) continue;
        add("ph", n(h.ph1to1h2o_r), n(h.ph1to1h2o_l), n(h.ph1to1h2o_h), ov);
        add("soc", (n(h.om_r) / 1.724) * 10, (n(h.om_l) / 1.724) * 10, (n(h.om_h) / 1.724) * 10, ov);
        add("clay", n(h.claytotal_r), n(h.claytotal_l), n(h.claytotal_h), ov);
        add("sand", n(h.sandtotal_r), NaN, NaN, ov);
        add("silt", n(h.silttotal_r), NaN, NaN, ov);
        add("cec", n(h.cec7_r), NaN, NaN, ov);
        add("bdod", n(h.dbthirdbar_r), NaN, NaN, ov);
        if (Number.isFinite(n(h.awc_r))) { awcSum += n(h.awc_r) * ov; awcCm += ov; }
      }
      // SSURGO low/high are the range of the map unit's component; treat them as an ~80% band.
      for (const [k, a] of Object.entries(acc)) L[k] = { p10: a.lo / a.w, p50: a.mid / a.w, p90: a.hi / a.w } satisfies Range;
      return L as SoilLayer;
    });
    if (!layers[0].ph && !layers[0].clay) throw new Error("SSURGO component has no horizon data");
    return {
      source: `USDA SSURGO: ${first.muname} (${first.compname}, ${first.comppct_r}% of map unit)`,
      confidence: "high" as const, layers,
      drainage: DRAIN[first.drainagecl ?? ""] ?? undefined,
      awcMmPerM: awcCm ? (awcSum / awcCm) * 1000 : undefined,
    };
  });
}
