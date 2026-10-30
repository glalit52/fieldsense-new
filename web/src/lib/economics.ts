import { useCallback, useState } from "react";

/**
 * Indicative farm-gate prices per tonne of each crop's product, in ₹ (Indian MSP 2025-26 where there is one,
 * otherwise typical mandi prices). Users edit them; edits are kept per browser.
 */
export const DEFAULT_PRICE: Record<string, number> = {
  wheat: 24250, durum: 26000, barley: 19800, oats: 25000, rye: 20000, triticale: 20000, maize: 24000, sorghum: 36990,
  pearl_millet: 27750, finger_millet: 48860, rice: 23690, teff: 60000, quinoa: 80000, buckwheat: 50000,
  chickpea: 56500, lentil: 67000, field_pea: 45000, faba_bean: 40000, lupin: 30000, soybean: 53280, common_bean: 70000,
  cowpea: 60000, mung_bean: 87680, pigeon_pea: 80000, groundnut: 72630, vetch: 6000,
  canola: 59500, mustard: 59500, sunflower: 77210, safflower: 59400, linseed: 60000, sesame: 98460,
  cotton: 200000, potato: 12000, sweet_potato: 15000, cassava: 8000, yam: 20000, sugar_beet: 3500,
  onion: 15000, carrot: 15000, garlic: 60000, tomato: 10000, cabbage: 8000, chili: 30000, watermelon: 8000, pumpkin: 10000,
  okra: 25000, lettuce: 20000, spinach: 15000, tobacco: 250000, hemp: 15000, lucerne: 8000, ryegrass: 5000, rhodes: 5000,
  sugarcane: 3550, coffee: 350000, tea: 250000, cocoa: 500000, oil_palm: 20000, banana: 15000, citrus: 30000, grape: 40000,
  olive: 60000, apple: 60000, mango: 40000, almond: 800000, avocado: 150000,
};

/** Indicative paid-out cost of cultivation per hectare (seed, fertiliser, chemicals, hired labour, machinery), ₹. */
const GROUP_COST: Record<string, number> = {
  Cereal: 45000, "Pseudo-cereal": 30000, Pulse: 30000, Oilseed: 35000, Fibre: 70000, "Root & tuber": 90000,
  Vegetable: 100000, Industrial: 120000, Forage: 30000, "Tree crop": 120000,
};
const CROP_COST: Record<string, number> = {
  rice: 60000, maize: 50000, pearl_millet: 25000, finger_millet: 25000, sorghum: 28000, groundnut: 55000,
  sugarcane: 150000, potato: 140000, cotton: 70000, tobacco: 120000,
};
export const defaultCost = (id: string, group: string) => CROP_COST[id] ?? GROUP_COST[group] ?? 40000;

/** Fertiliser prices per kg of product, ₹ (subsidised retail: urea ₹242/45 kg, DAP ₹1,350/50 kg, MOP ₹1,700/50 kg). */
export const DEFAULT_FERT_PRICE: Record<string, number> = { Urea: 5.4, DAP: 27, "MOP (potash)": 34 };
/** Pumping cost for 1 mm of irrigation over a hectare (10 m³), ₹. */
export const DEFAULT_WATER_COST = 20;

export interface Prices {
  currency: string;
  crop: Record<string, number>;      // per tonne
  cost: Record<string, number>;      // per hectare
  fert: Record<string, number>;      // per kg of product
  waterPerMm: number;                // per mm per hectare
}
const EMPTY: Prices = { currency: "₹", crop: {}, cost: {}, fert: {}, waterPerMm: DEFAULT_WATER_COST };
const KEY = "fieldsense.prices";

function load(): Prices {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object") return { ...EMPTY, ...v };
  } catch {}
  return EMPTY;
}

/** Price settings with the user's overrides on top of the defaults, kept in this browser. */
export function usePrices() {
  const [p, setP] = useState<Prices>(load);
  const save = useCallback((next: Prices) => {
    setP(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  }, []);
  return {
    prices: p,
    cropPrice: (id: string) => p.crop[id] ?? DEFAULT_PRICE[id] ?? 20000,
    cropCost: (id: string, group: string) => p.cost[id] ?? defaultCost(id, group),
    fertPrice: (name: string) => p.fert[name] ?? DEFAULT_FERT_PRICE[name] ?? 0,
    update: (patch: Partial<Prices>) => save({ ...p, ...patch }),
    setCrop: (id: string, price: number | null, cost: number | null) => {
      const crop = { ...p.crop }, costs = { ...p.cost };
      if (price == null) delete crop[id]; else crop[id] = price;
      if (cost == null) delete costs[id]; else costs[id] = cost;
      save({ ...p, crop, cost: costs });
    },
    reset: () => save({ ...EMPTY, currency: p.currency }),
  };
}

export const money = (v: number, currency: string) =>
  `${v < 0 ? "−" : ""}${currency}${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
