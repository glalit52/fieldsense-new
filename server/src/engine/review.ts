import type { Activity } from "../stores/fields.ts";
import { CROPS, cropById } from "./crops.ts";
import { doyLabel } from "./simulate.ts";
import { mean } from "./stats.ts";

/** Common names farmers log that differ from the library's crop names (English and Hindi transliterations). */
const ALIASES: Record<string, string> = {
  corn: "maize", makka: "maize", makki: "maize", paddy: "rice", dhan: "rice", chawal: "rice", gehun: "wheat", gehu: "wheat",
  jowar: "sorghum", bajra: "pearl_millet", ragi: "finger_millet", chana: "chickpea", gram: "chickpea", masoor: "lentil",
  matar: "field_pea", pea: "field_pea", soy: "soybean", soya: "soybean", moong: "mung_bean", mung: "mung_bean", arhar: "pigeon_pea",
  tur: "pigeon_pea", toor: "pigeon_pea", peanut: "groundnut", moongphali: "groundnut", sarson: "mustard", rapeseed: "canola",
  til: "sesame", kapas: "cotton", ganna: "sugarcane", aloo: "potato", shakarkandi: "sweet_potato", pyaz: "onion", tamatar: "tomato", mirchi: "chili",
  chilli: "chili", alfalfa: "lucerne", flax: "linseed", alsi: "linseed", jau: "barley", rajma: "common_bean", bean: "common_bean",
};

/** Library crop for a free-text journal entry ("Wheat", "paddy", "Durum wheat"), or undefined. */
export function matchCrop(text: string) {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  const byId = cropById(t.replace(/\s+/g, "_")) ?? cropById(ALIASES[t] ?? "");
  if (byId) return byId;
  const words = new Set(t.split(/[^a-z]+/).filter(Boolean));
  const nameWords = (c: (typeof CROPS)[number]) =>
    c.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !["pasture", "forage", "rainfed", "lowland", "fibre"].includes(w));
  // Longest names first so "Durum wheat" beats "Wheat". Every word of a name present beats a single shared word,
  // so "green pea" (alias) is a field pea rather than a pigeon pea.
  const byLength = [...CROPS].sort((a, b) => b.name.length - a.name.length);
  return byLength.find((c) => { const n = nameWords(c); return n.length > 0 && n.every((w) => words.has(w)); })
    ?? [...words].map((w) => cropById(ALIASES[w] ?? "")).find(Boolean)
    ?? byLength.find((c) => nameWords(c).some((w) => words.has(w)));
}

export interface SeasonReview {
  harvestDate: string; year: number; crop: string; cropId: string | null;
  actual: number;
  /** Attainable yield the model simulated for this season's weather (best sowing date, good management). */
  modelled: number | null; typical: number | null; good: number | null; irrigated: number | null;
  /** actual vs modelled, in %: negative means below what this season allowed. */
  gapPct: number | null;
  verdict: "above" | "on par" | "below" | "no model";
  weather: { year: number; rain: number; rainNormal: number; rainPct: number; hotDays: number; hotDaysNormal: number; longestDrySpell: number; drySpellNormal: number } | null;
  inputs: { sowingDate: string | null; fertiliserEntries: number; irrigationMm: number; spend: number };
  reasons: string[];
}

const DAY = 86_400_000;
const doyOf = (iso: string) => Math.floor((Date.parse(iso) - Date.UTC(Number(iso.slice(0, 4)), 0, 1)) / DAY);
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Compares each harvest in the field journal with the yield the crop model simulated for that season.
 * The model's yield is what the season's weather allowed with good management, so a shortfall points at the
 * field or the management, while a poor modelled season points at the weather.
 */
export function reviewSeasons(report: any, activities: Activity[]): SeasonReview[] {
  const harvests = activities.filter((a) => a.type === "harvest" && a.yieldTPerHa != null);
  const years = new Map<number, any>((report.climate?.years ?? []).map((y: any) => [y.year, y]));
  const normals = report.climate?.normals;
  const recentYears: any[] = report.climate?.recent ?? [];
  const hotNormal = mean(recentYears.map((y) => y.hotDays));
  const drySpellNormal = mean(recentYears.map((y) => y.longestDrySpell));

  return harvests.map((h) => {
    const harvestMs = Date.parse(h.date);
    // The sowing that belongs to this harvest: the latest one before it, within a year, for the same crop if named.
    const sowings = activities.filter((a) => a.type === "sowing" && Date.parse(a.date) <= harvestMs && harvestMs - Date.parse(a.date) < 400 * DAY);
    const sowing = sowings.filter((a) => !h.crop || !a.crop || matchCrop(a.crop)?.id === matchCrop(h.crop)?.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const name = h.crop || sowing?.crop || "";
    const lib = matchCrop(name);
    const assessed = lib ? report.crops.find((c: any) => c.id === lib.id) : undefined;
    const seasonStart = sowing ? Date.parse(sowing.date) : harvestMs - (assessed?.seasonDays ?? 150) * DAY;
    const inSeason = activities.filter((a) => { const t = Date.parse(a.date); return t >= seasonStart && t <= harvestMs; });
    const inputs = {
      sowingDate: sowing?.date ?? null,
      fertiliserEntries: inSeason.filter((a) => a.type === "fertiliser").length,
      irrigationMm: inSeason.filter((a) => a.type === "irrigation" && /^mm$/i.test(a.unit)).reduce((s, a) => s + (a.quantity ?? 0), 0),
      spend: inSeason.reduce((s, a) => s + (a.cost ?? 0), 0),
    };

    const base: SeasonReview = {
      harvestDate: h.date, year: Number(h.date.slice(0, 4)), crop: assessed?.name ?? (name || "Unnamed crop"), cropId: assessed?.id ?? null,
      actual: h.yieldTPerHa!, modelled: null, typical: null, good: null, irrigated: null, gapPct: null, verdict: "no model", weather: null, inputs, reasons: [],
    };
    if (!assessed || !lib) {
      base.reasons.push(name ? `"${name}" isn't one of the 67 modelled crops, so there is no attainable yield to compare with.` : "Name the crop on the harvest entry to compare it with the model.");
      return base;
    }

    // The model labels a season by the calendar year it was sown in.
    const sownYear = sowing ? Number(sowing.date.slice(0, 4))
      : assessed.sowing && doyOf(h.date) < assessed.sowing.bestDoy ? base.year - 1 : base.year;
    const season = assessed.recentYears.find((y: any) => y.year === sownYear);
    const modelled = season ? (season.score / 100) * lib.yMax : null;
    Object.assign(base, {
      modelled: modelled != null ? r1(modelled) : null, typical: assessed.yieldTPerHa.median, good: assessed.yieldTPerHa.good,
      irrigated: assessed.irrigatedYieldTPerHa,
    });
    const ref = modelled ?? assessed.yieldTPerHa.median;
    if (ref > 0) {
      base.gapPct = Math.round(((h.yieldTPerHa! - ref) / ref) * 100);
      base.verdict = base.gapPct > 10 ? "above" : base.gapPct >= -10 ? "on par" : "below";
    }
    if (modelled == null) base.reasons.push(`The model has no simulated ${sownYear} season yet (it covers complete past seasons), so this compares with the typical year.`);

    const w = years.get(base.year);
    if (w && normals) {
      base.weather = {
        year: base.year, rain: Math.round(w.rain), rainNormal: Math.round(normals.rain), rainPct: Math.round((w.rain / normals.rain) * 100),
        hotDays: w.hotDays, hotDaysNormal: Math.round(hotNormal), longestDrySpell: w.longestDrySpell, drySpellNormal: Math.round(drySpellNormal),
      };
    }

    // Was it the weather?
    const typical = assessed.yieldTPerHa.median;
    if (modelled != null && typical > 0) {
      const seasonPct = Math.round((modelled / typical) * 100);
      if (seasonPct < 85) base.reasons.push(`A hard season: with this weather the model expected ${r1(modelled)} t/ha, ${100 - seasonPct}% below a typical year (${r1(typical)} t/ha).`);
      else if (seasonPct > 115) base.reasons.push(`A good season: the weather allowed ${r1(modelled)} t/ha, ${seasonPct - 100}% above a typical year.`);
    }
    const bw = base.weather;
    if (bw) {
      if (bw.rainPct < 80) base.reasons.push(`${bw.year} was dry: ${bw.rain} mm of rain, ${bw.rainPct}% of the ${bw.rainNormal} mm normal.`);
      else if (bw.rainPct > 125) base.reasons.push(`${bw.year} was wet: ${bw.rain} mm of rain, ${bw.rainPct}% of normal. Watch waterlogging and disease.`);
      if (bw.hotDays >= bw.hotDaysNormal + 5) base.reasons.push(`${bw.hotDays} days reached 35 °C, against about ${bw.hotDaysNormal} normally.`);
      if (bw.longestDrySpell >= bw.drySpellNormal * 1.5 && bw.longestDrySpell >= 20) base.reasons.push(`The longest dry spell was ${bw.longestDrySpell} days (normally about ${bw.drySpellNormal}).`);
    }

    // Was it the field or the management?
    if (base.verdict === "below") {
      base.reasons.push(`You harvested ${Math.abs(base.gapPct!)}% less than the ${modelled != null ? "season's" : "typical"} attainable ${r1(ref)} t/ha, so the weather alone doesn't explain it.`);
      if (sowing && assessed.sowing) {
        const d = doyOf(sowing.date), { fromDoy, toDoy } = assessed.sowing;
        const inWindow = fromDoy <= toDoy ? d >= fromDoy - 5 && d <= toDoy + 5 : d >= fromDoy - 5 || d <= toDoy + 5;
        if (!inWindow) base.reasons.push(`Sown ${sowing.date}, outside the best window (${assessed.sowing.label}). Sowing date is often worth 10–30% of yield.`);
      }
      if (!inputs.fertiliserEntries) base.reasons.push("No fertiliser is recorded for this season. If none went on, nutrients are a likely cause; if it did, log it so the review can rule it out.");
      if (assessed.factors.ph < 0.9) base.reasons.push(`Soil pH limits ${assessed.name} here (pH factor ${assessed.factors.ph}). Liming or a pH-tolerant crop would help.`);
      if (assessed.factors.drainage < 0.9) base.reasons.push("Drainage limits this crop on this ground in wet spells.");
      if (assessed.irrigatedYieldTPerHa > ref * 1.3 && !inputs.irrigationMm && (assessed.factors.water ?? 1) < 0.85) {
        base.reasons.push(`Water limits ${assessed.name} here: with irrigation the model reaches ${r1(assessed.irrigatedYieldTPerHa)} t/ha.`);
      }
      base.reasons.push("Other common causes the model can't see: weeds, pests and disease, seed quality, plant stand, lodging and harvest losses.");
    } else if (base.verdict === "above") {
      base.reasons.push(`You beat the model by ${base.gapPct}%${inputs.irrigationMm ? `, helped by ${Math.round(inputs.irrigationMm)} mm of irrigation` : ""}. Check the yield measurement; if it holds, this field and management are better than the soil map suggests.`);
    } else if (base.verdict === "on par") {
      base.reasons.push("Your yield matches what this season allowed: the gap that remains is the weather, not the management.");
    }
    if (assessed.sowing && !sowing) base.reasons.push(`Log the sowing date too; the best window here is ${assessed.sowing.label} (around ${doyLabel(assessed.sowing.bestDoy)}).`);
    return base;
  }).sort((a, b) => b.harvestDate.localeCompare(a.harvestDate));
}
