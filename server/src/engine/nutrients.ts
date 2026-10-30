import type { Crop } from "./crops.ts";
import { clamp } from "./stats.ts";

/**
 * Whole-crop nutrient uptake per tonne of harvested product (kg N, P₂O₅, K₂O), from IPNI / FAO
 * fertilizer-use guides and Indian ICAR package-of-practice figures. Units follow each crop's product
 * (cotton per t lint, sugarcane per t cane, forage per t dry matter).
 */
const UPTAKE: Record<string, [number, number, number]> = {
  wheat: [25, 10, 30], durum: [27, 10, 30], barley: [24, 10, 28], oats: [25, 10, 30], rye: [24, 10, 28], triticale: [25, 10, 30],
  maize: [22, 9, 22], sorghum: [25, 10, 25], pearl_millet: [30, 12, 30], finger_millet: [25, 10, 28], rice: [20, 10, 28], teff: [30, 12, 30],
  quinoa: [35, 15, 35], buckwheat: [30, 12, 30],
  chickpea: [50, 12, 30], lentil: [50, 12, 30], field_pea: [45, 12, 30], faba_bean: [50, 12, 30], lupin: [60, 12, 30], soybean: [60, 15, 35],
  common_bean: [50, 12, 30], cowpea: [50, 12, 30], mung_bean: [50, 12, 30], pigeon_pea: [50, 12, 30], groundnut: [55, 12, 25], vetch: [25, 6, 25],
  canola: [45, 20, 40], mustard: [45, 20, 40], sunflower: [40, 17, 45], safflower: [40, 15, 35], linseed: [40, 15, 30], sesame: [45, 18, 30],
  cotton: [110, 40, 100], potato: [4, 1.6, 6.5], sweet_potato: [3.5, 1.5, 6], cassava: [2.5, 1, 4.5], yam: [4, 1.5, 6], sugar_beet: [2, 0.9, 3],
  onion: [3, 1.2, 4], carrot: [2.5, 1, 5], garlic: [4, 1.5, 4], tomato: [2.5, 0.8, 4], cabbage: [3.5, 1.2, 4], chili: [4, 1.2, 5],
  watermelon: [2, 0.8, 3.5], pumpkin: [3, 1, 4], okra: [4, 1.2, 4], lettuce: [2.5, 1, 5], spinach: [4, 1.2, 5],
  tobacco: [40, 10, 60], hemp: [10, 4, 10], lucerne: [27, 6, 25], ryegrass: [25, 9, 25], rhodes: [20, 8, 22], sugarcane: [1.2, 0.5, 1.8],
  coffee: [40, 8, 45], tea: [45, 10, 25], cocoa: [40, 15, 45], oil_palm: [6, 1.5, 9], banana: [6, 1.5, 20], citrus: [2, 0.6, 3],
  grape: [3, 1, 5], olive: [10, 3, 10], apple: [1, 0.4, 1.8], mango: [2, 0.6, 3], almond: [60, 20, 70], avocado: [5, 2, 8],
};
const GROUP_DEFAULT: Record<string, [number, number, number]> = {
  Cereal: [25, 10, 28], "Pseudo-cereal": [30, 12, 30], Pulse: [50, 12, 30], Oilseed: [45, 18, 40], Fibre: [110, 40, 100],
  "Root & tuber": [3.5, 1.4, 6], Vegetable: [3, 1, 4.5], Industrial: [10, 4, 12], Forage: [25, 8, 25], "Tree crop": [4, 1.2, 6],
};
/** Crops that fix their own nitrogen: they get a small starter dose only. */
const LEGUMES = new Set(["chickpea", "lentil", "field_pea", "faba_bean", "lupin", "soybean", "common_bean", "cowpea", "mung_bean", "pigeon_pea", "groundnut", "vetch", "lucerne"]);

type Split = [daysAfterSowing: number, nShare: number, stage: string];
function splits(c: Crop): Split[] {
  if (c.id === "rice") return [[0, 0.5, "Basal, at transplanting"], [21, 0.25, "Active tillering"], [45, 0.25, "Panicle initiation"]];
  if (c.id === "maize") return [[0, 0.3, "Basal, at sowing"], [30, 0.4, "Knee-high (6–8 leaves)"], [55, 0.3, "Before tasselling"]];
  if (LEGUMES.has(c.id)) return [[0, 1, "Basal, at sowing"]];
  switch (c.group) {
    case "Cereal": case "Pseudo-cereal": return [[0, 0.34, "Basal, at sowing"], [25, 0.33, "Tillering / first irrigation"], [50, 0.33, "Booting, before flowering"]];
    case "Oilseed": return [[0, 0.5, "Basal, at sowing"], [30, 0.5, "Rosette / first irrigation"]];
    case "Fibre": case "Industrial": return [[0, 0.25, "Basal, at planting"], [45, 0.35, "Squaring / tillering"], [90, 0.4, "Peak growth"]];
    case "Root & tuber": case "Vegetable": return [[0, 0.4, "Basal, at planting"], [30, 0.3, "Early growth / earthing up"], [55, 0.3, "Flowering / bulking"]];
    case "Forage": return [[0, 0.5, "After establishment or grazing"], [60, 0.5, "After the first cut"]];
    default: return [[0, 0.4, "Start of the growing flush"], [60, 0.3, "Fruit set"], [120, 0.3, "Fruit fill / after harvest"]];
  }
}

const PCLASS = (p: number) => (p < 10 ? "low" : p < 20 ? "medium" : p < 35 ? "high" : "very high");
const KCLASS = (k: number) => (k < 80 ? "low" : k < 150 ? "medium" : k < 250 ? "high" : "very high");
const round5 = (v: number) => Math.round(v / 5) * 5;

export interface NutrientInput {
  crop: Crop;
  targetYield: number;            // t/ha of the crop's product
  organicCarbonPct: number | null;
  ph: number | null;
  /** Olsen P and exchangeable (ammonium acetate) K from a lab test, mg/kg. */
  p?: number | null; k?: number | null;
  /** Calendar date of sowing (or the start of growth for perennials), YYYY-MM-DD. */
  sowingDate: string;
}

/**
 * Fertiliser plan by nutrient balance: crop uptake for the target yield, minus what the soil supplies,
 * adjusted for the lab's P and K status, then turned into urea / DAP / MOP and a split schedule.
 * A planning estimate for the agronomist to confirm, not a prescription.
 */
export function nutrientPlan(x: NutrientInput) {
  const c = x.crop;
  const [nPerT, pPerT, kPerT] = UPTAKE[c.id] ?? GROUP_DEFAULT[c.group] ?? [25, 10, 25];
  const t = x.targetYield;
  const notes: string[] = [];
  const legume = LEGUMES.has(c.id);

  // Nitrogen: uptake minus soil mineralisation (~10 kg + 25 kg per 1% organic carbon each season), at the 50% recovery
  // typical of farm practice (40% for flooded rice, where losses are higher).
  const oc = x.organicCarbonPct;
  const nSupply = clamp(10 + 25 * (oc ?? 0.6), 10, 80);
  const recovery = c.id === "rice" ? 0.4 : 0.5;
  const n = legume ? (c.group === "Forage" ? 0 : 20) : clamp(round5((nPerT * t - nSupply) / recovery), 0, 300);
  if (legume) notes.push(`${c.name} fixes its own nitrogen: only a ${c.group === "Forage" ? "zero" : "20 kg"} N starter. Use rhizobium seed inoculant where the crop is new to the field.`);
  if (oc == null) notes.push("Soil organic carbon is unknown, so a typical 0.6% was assumed for nitrogen supply.");

  // Phosphorus and potassium: replace what the crop takes up, more on poor soil, less or none on rich soil.
  const pFactor = x.p == null ? 1 : { low: 1.5, medium: 1, high: 0.5, "very high": 0 }[PCLASS(x.p)]!;
  // Most crop K sits in the straw; with residues returned only part of it leaves the field.
  const kFactor = x.k == null ? 0.4 : { low: 1, medium: 0.4, high: 0.2, "very high": 0 }[KCLASS(x.k)]!;
  const p2o5 = round5(pPerT * t * pFactor + (x.p != null && x.p < 10 ? 20 : 0));
  const k2o = round5(kPerT * t * kFactor + (x.k != null && x.k < 80 ? 30 : 0));
  if (x.p == null || x.k == null) notes.push(`No lab ${x.p == null && x.k == null ? "P or K" : x.p == null ? "P" : "K"} value: rates assume a medium soil. Add a lab test to the field to tighten them.`);
  else notes.push(`Lab test: Olsen P ${x.p} mg/kg (${PCLASS(x.p)}), exchangeable K ${x.k} mg/kg (${KCLASS(x.k)}).`);
  if (x.ph != null && x.ph < 5.5) notes.push(`Acid soil (pH ${x.ph.toFixed(1)}) locks up phosphorus: lime first, and band P near the seed rather than broadcasting it.`);
  if (x.ph != null && x.ph > 7.5) notes.push(`Alkaline soil (pH ${x.ph.toFixed(1)}): zinc and iron are often short. Zinc sulphate at about 25 kg/ha every two to three seasons is cheap insurance.`);
  if (["Oilseed", "Pulse"].includes(c.group)) notes.push("Oilseeds and pulses also need sulphur: single super phosphate (SSP) in place of DAP supplies it (about 12% S).");

  // Products: DAP covers the P (and some N), MOP the K, urea the rest of the N.
  const dap = round5(p2o5 / 0.46), mop = round5(k2o / 0.6);
  const dapN = dap * 0.18;
  const schedule = splits(c);
  let carry = 0; // DAP nitrogen beyond the first dose's share comes off later urea doses
  const sow = Date.parse(x.sowingDate);
  const applications = schedule.map(([das, share, stage], i) => {
    let nDose = n * share;
    let ureaN = nDose - (i === 0 ? dapN : 0);
    if (i === 0 && ureaN < 0) { carry = -ureaN; ureaN = 0; nDose = dapN; }
    else if (i > 0 && carry > 0) { const use = Math.min(carry, ureaN); ureaN -= use; carry -= use; nDose -= use; }
    const products = [
      ...(i === 0 && dap ? [{ name: "DAP", grade: "18-46-0", kgPerHa: dap }] : []),
      ...(i === 0 && mop ? [{ name: "MOP (potash)", grade: "0-0-60", kgPerHa: mop }] : []),
      ...(ureaN > 2 ? [{ name: "Urea", grade: "46-0-0", kgPerHa: round5(ureaN / 0.46) }] : []),
    ];
    return {
      date: new Date(sow + das * 86_400_000).toISOString().slice(0, 10), daysAfterSowing: das, stage,
      n: Math.round(nDose), p2o5: i === 0 ? p2o5 : 0, k2o: i === 0 ? k2o : 0, products,
    };
  }).filter((a) => a.products.length);

  const totals = new Map<string, { name: string; grade: string; kgPerHa: number }>();
  for (const a of applications) for (const p of a.products) {
    const cur = totals.get(p.name);
    if (cur) cur.kgPerHa += p.kgPerHa; else totals.set(p.name, { ...p });
  }
  return {
    crop: { id: c.id, name: c.name, product: c.product }, targetYield: t,
    basis: {
      uptakePerTonne: { n: nPerT, p2o5: pPerT, k2o: kPerT }, nSupplyKgHa: Math.round(nSupply), nRecovery: recovery, legume,
      organicCarbonPct: oc, ph: x.ph, p: x.p ?? null, k: x.k ?? null,
      pClass: x.p != null ? PCLASS(x.p) : null, kClass: x.k != null ? KCLASS(x.k) : null,
    },
    nutrients: { n, p2o5, k2o },
    products: [...totals.values()],
    applications,
    notes,
  };
}
export type NutrientPlan = ReturnType<typeof nutrientPlan>;

/** Next sowing date for a crop from its best day of year: this season's if it's still ahead (or under two weeks past), else next year's. */
export function nextSowingDate(bestDoy: number | null | undefined, today = new Date()) {
  if (bestDoy == null) return new Date(today.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const y = today.getUTCFullYear();
  let d = Date.UTC(y, 0, 1) + bestDoy * 86_400_000;
  if (d < today.getTime() - 14 * 86_400_000) d = Date.UTC(y + 1, 0, 1) + bestDoy * 86_400_000;
  return new Date(d).toISOString().slice(0, 10);
}
