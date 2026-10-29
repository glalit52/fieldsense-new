import { test } from "node:test";
import assert from "node:assert/strict";
import { saxtonRawls, summariseSoil, textureClass } from "../src/engine/soil.ts";
import { limeAdvice } from "../src/engine/lime.ts";
import { wetBulb } from "../src/engine/operations.ts";
import { mannKendall, quantile, senSlope, trapezoid } from "../src/engine/stats.ts";
import { areaHa, cleanRing, isArea, pointInRing, toGeometry, toUtm } from "../src/lib/geo.ts";
import { parseRing } from "../src/lib/validate.ts";
import { climateSoilEstimate } from "../src/providers/soilgrids.ts";
import { assessCrop, prepare, soilFactors } from "../src/engine/simulate.ts";
import { CROPS, cropById } from "../src/engine/crops.ts";
import { analyseLandHealth } from "../src/engine/landhealth.ts";

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("USDA texture triangle", () => {
  assert.equal(textureClass(90, 5), "Sand");
  assert.equal(textureClass(40, 20), "Loam");
  assert.equal(textureClass(10, 60), "Clay");
  assert.equal(textureClass(20, 10), "Silt loam");
  assert.equal(textureClass(65, 12), "Sandy loam");
});

test("Saxton–Rawls gives textbook water retention", () => {
  const loam = saxtonRawls(40, 20, 2.5);
  near(loam.fc, 0.29, 0.04); near(loam.wp, 0.14, 0.03);
  const sand = saxtonRawls(88, 5, 1);
  assert.ok(sand.fc - sand.wp < loam.fc - loam.wp, "sand holds less plant-available water than loam");
});

function soilWithPh(ph: number, clay = 25) {
  const prof = climateSoilEstimate(0.6, 15);
  for (const L of prof.layers) { L.ph = { p10: ph - 0.3, p50: ph, p90: ph + 0.3 }; L.clay = { p10: clay - 3, p50: clay, p90: clay + 3 }; }
  return summariseSoil(prof);
}

test("lime call follows pH and rate grows with clay (buffering)", () => {
  assert.equal(limeAdvice(soilWithPh(7.2)).call, "None needed");
  assert.equal(limeAdvice(soilWithPh(4.8)).call, "Likely needed");
  const sandy = limeAdvice(soilWithPh(4.8, 8)).rateTPerHa.mid, heavy = limeAdvice(soilWithPh(4.8, 45)).rateTPerHa.mid;
  assert.ok(heavy > sandy * 1.5, `heavy ${heavy} vs sandy ${sandy}`);
  assert.ok(sandy > 0.5 && heavy < 12);
});

test("lab test overrides the map estimate", () => {
  const s = summariseSoil(climateSoilEstimate(0.6, 15), { ph: 5.1 });
  assert.equal(s.topsoil.ph!.p50, 5.1);
  assert.equal(s.confidence, "high");
  assert.equal(limeAdvice(s).call, "Likely needed");
});

test("wet bulb (Stull) and Delta T", () => {
  near(wetBulb(20, 50), 13.7, 0.3);
  near(25 - wetBulb(25, 40), 8.4, 0.5);
});

test("robust trend statistics", () => {
  const xs = Array.from({ length: 20 }, (_, i) => 2000 + i);
  const ys = xs.map((x, i) => 0.3 + 0.01 * (x - 2000) + (i === 5 ? 0.5 : 0)); // one outlier
  near(senSlope(xs, ys).slope, 0.01, 1e-9);
  assert.ok(mannKendall(ys).p < 0.01);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(trapezoid(5, 0, 4, 6, 10), 1);
  assert.equal(trapezoid(2, 0, 4, 6, 10), 0.5);
});

test("geometry: UTM, area and point-in-polygon", () => {
  const [e, n] = toUtm(142.16, -36.63, 32754); // Wimmera, zone 54S
  near(e, 603_600, 2_000); near(n, 5_945_600, 2_000);
  const sq: [number, number][] = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]];
  near(areaHa(sq), 123.6, 2);
  assert.ok(pointInRing(0.005, 0.005, sq));
  assert.ok(!pointInRing(0.02, 0.005, sq));
});

test("geometry sent to STAC is always valid GeoJSON: a closed polygon or a point", () => {
  const sq: [number, number][] = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]];
  // A pin used to go out as a one-corner Polygon, which Earth Search rejects with HTTP 400.
  assert.deepEqual(toGeometry([[77.5, 12.9]]), { type: "Point", coordinates: [77.5, 12.9] });
  const poly = toGeometry([...sq, sq[0]]) as { type: string; coordinates: [number, number][][] };
  assert.equal(poly.type, "Polygon");
  assert.equal(poly.coordinates[0].length, 5);
  assert.deepEqual(poly.coordinates[0][0], poly.coordinates[0][4]);
  assert.equal(toGeometry([[1, 1], [1, 1], [1, 1]]).type, "Point");
  assert.equal(toGeometry([[0, 0], [0.01, 0.01], [0.02, 0.02]]).type, "Point"); // collinear
  assert.deepEqual(cleanRing([[0, 0], [0, 0], [1, 0], [1, 1], [0, 0]]), [[0, 0], [1, 0], [1, 1]]);
  assert.ok(isArea(sq) && !isArea([[0, 0], [1, 0], [0, 0]]));
});

test("polygon validation rejects outlines that don't enclose an area", () => {
  const sq: [number, number][] = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]];
  assert.deepEqual(parseRing([...sq, sq[0]]), sq); // GeoJSON closing corner is dropped
  assert.throws(() => parseRing([[1, 1], [1, 1], [1, 1]]), /outline an area/);
  assert.throws(() => parseRing([[0, 0], [0.01, 0], [0, 0]]), /outline an area/);
  assert.throws(() => parseRing([[0, 0], [0.01, 0.01], [0.02, 0.02]]), /outline an area/);
  assert.throws(() => parseRing([[0, 0]]), /3–500/);
});

test("pH response is gentle near the optimum and severe outside the crop's range", () => {
  const soy = cropById("soybean")!;
  assert.ok(soilFactors(soy, soilWithPh(5.8)).ph > 0.9);
  assert.ok(soilFactors(soy, soilWithPh(4.2)).ph < 0.3);
  assert.ok(soilFactors(cropById("lupin")!, soilWithPh(5.0)).ph > soilFactors(cropById("lucerne")!, soilWithPh(5.0)).ph);
});

/** Synthetic climate: sinusoidal temperature, rain every 4th day. */
function synthetic(years: number, meanT: number, ampT: number, rainPerYear: number, south = false) {
  const time: string[] = [], tmax: number[] = [], tmin: number[] = [], tmean: number[] = [], rain: number[] = [], et0: number[] = [];
  const start = Date.UTC(1995, 0, 1);
  for (let d = 0; d < years * 365.25; d++) {
    const date = new Date(start + d * 86_400_000), doy = d % 365.25;
    const t = meanT - ampT * Math.cos((2 * Math.PI * (doy - (south ? 197 : 15))) / 365.25);
    time.push(date.toISOString().slice(0, 10)); tmean.push(t); tmax.push(t + 6); tmin.push(t - 6);
    rain.push(d % 4 === 0 ? rainPerYear / 91.3 : 0); et0.push(Math.max(0.5, 0.18 * t));
  }
  const nan = time.map(() => NaN);
  return { time, tmax, tmin, tmean, rain, et0, radiation: nan, wind: nan, rh: nan, sm0_7: nan, sm7_28: nan };
}

test("crop simulation responds to water and temperature sensibly", () => {
  const soil = soilWithPh(6.5);
  const wet = prepare(synthetic(12, 22, 6, 1100), soil, 10);
  const dry = prepare(synthetic(12, 22, 6, 250), soil, 10);
  const cold = prepare(synthetic(12, 4, 12, 700), soil, 55);
  const maize = cropById("maize")!;
  const mWet = assessCrop(wet, maize, soil, 10), mDry = assessCrop(dry, maize, soil, 10);
  assert.ok(mWet.score > mDry.score + 25, `wet ${mWet.score} vs dry ${mDry.score}`);
  assert.ok(mDry.irrigationMm > mWet.irrigationMm, `dry ${mDry.irrigationMm} vs wet ${mWet.irrigationMm} mm`);
  assert.ok(mDry.irrigatedYieldTPerHa > 3, `irrigated maize in a dry climate should still yield (${mDry.irrigatedYieldTPerHa})`);
  assert.ok(mWet.irrigatedYieldTPerHa >= mWet.yieldTPerHa.median - 0.01);
  assert.ok(assessCrop(cold, cropById("cocoa")!, soil, 10).score < 5, "cocoa fails in a cold climate");
  assert.ok(assessCrop(cold, cropById("rye")!, soil, 10).score > assessCrop(cold, maize, soil, 10).score, "rye beats maize in the cold");
  for (const c of CROPS) { const a = assessCrop(wet, c, soil, 10); assert.ok(a.score >= 0 && a.score <= 100, c.id); }
});

test("land health detects a greening trend and seasonality", () => {
  const obs = [];
  for (let y = 2001; y <= 2024; y++) for (let k = 0; k < 23; k++) {
    const doy = k * 16; const date = new Date(Date.UTC(y, 0, 1 + doy)).toISOString().slice(0, 10);
    obs.push({ date, ndvi: 0.35 + 0.004 * (y - 2001) + 0.2 * Math.sin((2 * Math.PI * (doy - 80)) / 365) });
  }
  const lh = analyseLandHealth(obs, "test");
  assert.equal(lh.verdict, "Improving");
  assert.ok(lh.changePct > 15 && lh.changePct < 40, String(lh.changePct));
  assert.equal(lh.croppingIntensity, 1);
});
