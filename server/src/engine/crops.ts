/**
 * Crop parameter library. Values compiled from FAO-56 (Kc, rooting depth), FAO-33 (Ky),
 * FAO EcoCrop (temperature / pH limits) and regional agronomy guides. Daily-mean temperatures in °C.
 */
export interface Crop {
  id: string; name: string; group: string; product: string;
  tbase: number; toptLo: number; toptHi: number; tmax: number;
  vegFrost: number;     // tmin that kills / severely damages vegetative plants
  flowerFrost: number;  // tmin that damages flowers / grain set
  heat: number;         // tmax causing flowering heat stress
  gdd: number;          // thermal time sowing → maturity (base tbase); 0 for perennials
  root: number; kcIni: number; kcMid: number; kcEnd: number; ky: number;
  yMax: number;         // world-class attainable yield, no water limit, top management (t/ha) — common basis for all crops
  ph: [number, number, number, number];
  wlTol: number;        // waterlogging tolerance 0–1
  texture: "light" | "medium" | "heavy" | "any";
  perennial: boolean;
  chill: number;        // winter chill hours needed (<7.2 °C)
  limeTarget: number;   // pH to lime to
  wpT: number;          // yield (kg/ha of product) per mm transpired — caps yield by absolute water use
  humidSens: number;    // 0–1 loss to foliar disease in wet seasons (Ascochyta, Sclerotinia, Botrytis…)
}

type Row = [string, string, string, string, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, [number, number, number, number], number, Crop["texture"], number?, number?];

// id, name, group, product, tbase, toptLo, toptHi, tmax, vegFrost, flowerFrost, heat, gdd,
// root, kcIni, kcMid, kcEnd, ky, yMax, ph[min,optLo,optHi,max], wlTol, texture, chill?, perennial(1)?
const ROWS: Row[] = [
  ["wheat", "Wheat", "Cereal", "grain", 0, 12, 22, 32, -15, -2, 32, 2300, 1.5, 0.4, 1.15, 0.3, 1.15, 9, [5.0, 6.0, 7.5, 8.5], 0.3, "any"],
  ["durum", "Durum wheat", "Cereal", "grain", 0, 13, 23, 32, -10, -2, 33, 2300, 1.5, 0.4, 1.15, 0.3, 1.15, 8, [5.5, 6.5, 8.0, 8.8], 0.25, "medium"],
  ["barley", "Barley", "Cereal", "grain", 0, 11, 21, 32, -12, -2, 32, 2100, 1.3, 0.3, 1.15, 0.25, 1.05, 8, [5.2, 6.3, 8.0, 8.8], 0.25, "any"],
  ["oats", "Oats", "Cereal", "grain", 0, 10, 20, 30, -10, -2, 30, 2200, 1.2, 0.3, 1.15, 0.25, 1.05, 7.5, [4.5, 5.5, 7.0, 8.0], 0.45, "any"],
  ["rye", "Cereal rye", "Cereal", "grain", 0, 9, 19, 30, -25, -3, 31, 2200, 1.4, 0.4, 1.15, 0.3, 1.0, 8.5, [4.5, 5.5, 7.0, 8.0], 0.4, "light"],
  ["triticale", "Triticale", "Cereal", "grain", 0, 11, 21, 31, -15, -2, 32, 2300, 1.4, 0.4, 1.15, 0.3, 1.05, 9, [4.6, 5.5, 7.5, 8.3], 0.35, "any"],
  ["maize", "Maize", "Cereal", "grain", 10, 18, 30, 38, -1, 0, 36, 1400, 1.6, 0.3, 1.2, 0.5, 1.25, 13, [5.0, 5.8, 7.5, 8.5], 0.3, "medium"],
  ["sorghum", "Sorghum", "Cereal", "grain", 10, 22, 32, 40, 0, 1, 38, 1400, 1.7, 0.3, 1.0, 0.55, 0.9, 10, [5.0, 5.8, 7.8, 8.7], 0.45, "any"],
  ["pearl_millet", "Pearl millet", "Cereal", "grain", 10, 24, 33, 42, 0, 2, 40, 1100, 1.6, 0.3, 1.0, 0.3, 0.9, 6, [4.5, 5.5, 7.5, 8.5], 0.2, "light"],
  ["finger_millet", "Finger millet", "Cereal", "grain", 10, 20, 28, 36, 0, 2, 36, 1300, 1.0, 0.3, 1.0, 0.3, 0.9, 5, [4.5, 5.3, 7.0, 8.2], 0.4, "any"],
  ["rice", "Rice (rainfed lowland)", "Cereal", "paddy", 10, 22, 31, 38, 0, 2, 35, 1600, 0.6, 1.05, 1.2, 0.9, 1.3, 9, [4.5, 5.5, 7.0, 8.0], 1.0, "heavy"],
  ["teff", "Teff", "Cereal", "grain", 8, 16, 26, 34, -1, 0, 34, 1000, 0.6, 0.3, 1.0, 0.3, 1.0, 3.5, [5.0, 6.0, 7.5, 8.5], 0.5, "any"],
  ["quinoa", "Quinoa", "Pseudo-cereal", "grain", 3, 8, 18, 28, -6, -2, 30, 1700, 1.0, 0.3, 1.0, 0.5, 0.9, 4.5, [5.0, 6.0, 8.0, 8.8], 0.2, "light"],
  ["buckwheat", "Buckwheat", "Pseudo-cereal", "grain", 5, 15, 24, 32, -1, 0, 32, 1000, 0.8, 0.3, 1.0, 0.4, 1.0, 3, [4.5, 5.0, 6.5, 7.5], 0.2, "light"],
  ["chickpea", "Chickpea", "Pulse", "grain", 0, 15, 25, 34, -8, 0, 35, 2100, 1.2, 0.4, 1.0, 0.35, 0.95, 5, [5.5, 6.0, 8.0, 8.8], 0.1, "medium"],
  ["lentil", "Lentil", "Pulse", "grain", 0, 13, 23, 32, -10, -1, 32, 1900, 0.8, 0.4, 1.1, 0.3, 1.0, 3.5, [5.5, 6.0, 8.0, 8.8], 0.1, "medium"],
  ["field_pea", "Field pea", "Pulse", "grain", 0, 12, 20, 30, -10, -1, 30, 1800, 0.9, 0.5, 1.15, 0.4, 1.15, 5.5, [5.5, 6.0, 7.5, 8.3], 0.2, "medium"],
  ["faba_bean", "Faba bean", "Pulse", "grain", 0, 12, 21, 30, -10, -2, 30, 2300, 0.9, 0.5, 1.15, 0.4, 1.1, 6.5, [5.5, 6.3, 8.0, 8.6], 0.6, "heavy"],
  ["lupin", "Lupin", "Pulse", "grain", 0, 12, 22, 32, -8, -1, 32, 2300, 1.2, 0.4, 1.1, 0.3, 1.0, 4.5, [4.2, 4.8, 6.5, 7.5], 0.1, "light"],
  ["soybean", "Soybean", "Pulse", "grain", 10, 18, 30, 38, -1, 0, 36, 1300, 1.3, 0.4, 1.15, 0.5, 0.85, 5, [5.0, 6.0, 7.0, 8.0], 0.4, "medium"],
  ["common_bean", "Common bean", "Pulse", "dry bean", 8, 17, 26, 34, -0.5, 0, 32, 1100, 0.8, 0.4, 1.15, 0.35, 1.15, 4, [5.0, 6.0, 7.0, 8.0], 0.15, "medium"],
  ["cowpea", "Cowpea", "Pulse", "grain", 10, 22, 32, 40, 0, 2, 38, 1100, 1.0, 0.4, 1.05, 0.4, 0.9, 3.5, [4.8, 5.5, 7.0, 8.0], 0.2, "light"],
  ["mung_bean", "Mung bean", "Pulse", "grain", 10, 22, 32, 40, 0, 2, 38, 900, 0.8, 0.4, 1.05, 0.35, 1.0, 2.5, [5.0, 6.0, 7.5, 8.2], 0.2, "medium"],
  ["pigeon_pea", "Pigeon pea", "Pulse", "grain", 10, 20, 32, 40, -1, 1, 38, 2000, 1.5, 0.4, 1.0, 0.5, 0.9, 3.5, [4.8, 5.5, 7.5, 8.3], 0.2, "any"],
  ["groundnut", "Groundnut", "Oilseed", "pods", 10, 22, 30, 38, 0, 2, 36, 1500, 0.8, 0.4, 1.15, 0.6, 0.7, 6, [4.8, 5.5, 7.0, 8.0], 0.15, "light"],
  ["vetch", "Vetch (forage)", "Forage", "hay DM", 0, 10, 20, 30, -12, -2, 31, 1800, 0.8, 0.4, 1.0, 0.4, 1.0, 8, [5.0, 6.0, 7.5, 8.3], 0.5, "any"],
  ["canola", "Canola / rapeseed", "Oilseed", "seed", 0, 12, 22, 30, -12, -2, 30, 2100, 1.4, 0.35, 1.1, 0.35, 1.0, 4.5, [5.0, 6.0, 7.5, 8.3], 0.25, "medium"],
  ["mustard", "Mustard", "Oilseed", "seed", 0, 12, 23, 32, -8, -2, 32, 1900, 1.0, 0.35, 1.1, 0.35, 1.0, 3, [5.0, 6.0, 7.5, 8.3], 0.3, "any"],
  ["sunflower", "Sunflower", "Oilseed", "seed", 6, 18, 28, 36, -3, 0, 35, 1600, 1.6, 0.35, 1.1, 0.35, 0.95, 4.5, [5.2, 6.0, 7.5, 8.5], 0.2, "medium"],
  ["safflower", "Safflower", "Oilseed", "seed", 5, 16, 28, 36, -7, -1, 36, 2200, 1.8, 0.35, 1.1, 0.25, 0.8, 4, [5.5, 6.5, 8.0, 8.8], 0.1, "medium"],
  ["linseed", "Linseed / flax", "Oilseed", "seed", 3, 12, 22, 30, -8, -1, 30, 1700, 1.0, 0.35, 1.1, 0.25, 1.0, 3, [5.0, 6.0, 7.5, 8.2], 0.3, "medium"],
  ["sesame", "Sesame", "Oilseed", "seed", 12, 24, 32, 40, 1, 4, 38, 1100, 1.0, 0.35, 1.1, 0.25, 0.9, 2.5, [5.0, 5.5, 7.5, 8.2], 0.05, "light"],
  ["cotton", "Cotton", "Fibre", "lint", 12, 22, 32, 40, 0, 3, 38, 1800, 1.6, 0.35, 1.2, 0.6, 0.85, 2.8, [5.2, 6.0, 7.8, 8.7], 0.3, "heavy"],
  ["potato", "Potato", "Root & tuber", "tubers", 4, 14, 22, 30, -2, -1, 30, 1400, 0.5, 0.5, 1.15, 0.75, 1.1, 70, [4.5, 5.0, 6.5, 7.8], 0.2, "light"],
  ["sweet_potato", "Sweet potato", "Root & tuber", "roots", 10, 20, 30, 36, 1, 2, 36, 1600, 0.8, 0.5, 1.15, 0.65, 1.0, 50, [4.5, 5.5, 6.8, 7.8], 0.2, "light"],
  ["cassava", "Cassava", "Root & tuber", "roots", 12, 22, 32, 40, 2, 4, 40, 3500, 1.0, 0.3, 0.8, 0.3, 0.8, 60, [4.0, 5.0, 6.8, 8.0], 0.2, "any"],
  ["yam", "Yam", "Root & tuber", "tubers", 12, 24, 30, 38, 2, 4, 38, 2600, 0.8, 0.5, 1.1, 0.9, 1.0, 45, [4.5, 5.5, 6.5, 7.8], 0.2, "light"],
  ["sugar_beet", "Sugar beet", "Root & tuber", "roots", 3, 14, 24, 32, -5, -2, 34, 2600, 1.0, 0.35, 1.2, 0.7, 1.0, 90, [5.5, 6.3, 8.0, 8.8], 0.35, "medium"],
  ["onion", "Onion", "Vegetable", "bulbs", 4, 13, 24, 32, -6, -2, 34, 1800, 0.4, 0.7, 1.05, 0.75, 1.1, 70, [5.5, 6.0, 7.0, 8.0], 0.2, "light"],
  ["carrot", "Carrot", "Vegetable", "roots", 4, 13, 22, 30, -6, -2, 30, 1300, 0.7, 0.7, 1.05, 0.95, 1.0, 80, [5.2, 6.0, 7.0, 8.0], 0.2, "light"],
  ["garlic", "Garlic", "Vegetable", "bulbs", 2, 10, 22, 30, -12, -3, 32, 1600, 0.4, 0.7, 1.0, 0.7, 1.1, 20, [5.5, 6.0, 7.5, 8.2], 0.2, "medium"],
  ["tomato", "Tomato", "Vegetable", "fruit", 10, 20, 27, 35, 0, 2, 33, 1300, 0.9, 0.6, 1.15, 0.8, 1.05, 120, [5.2, 5.8, 7.0, 8.0], 0.15, "medium"],
  ["cabbage", "Cabbage", "Vegetable", "heads", 4, 12, 22, 30, -6, -3, 30, 1200, 0.6, 0.7, 1.05, 0.95, 0.95, 90, [5.5, 6.2, 7.5, 8.3], 0.35, "any"],
  ["chili", "Chilli / pepper", "Vegetable", "fruit", 10, 20, 30, 36, 0, 2, 34, 1500, 0.7, 0.6, 1.05, 0.9, 1.1, 40, [5.0, 5.8, 7.0, 8.0], 0.15, "medium"],
  ["watermelon", "Watermelon", "Vegetable", "fruit", 12, 22, 32, 40, 1, 3, 38, 1100, 1.0, 0.4, 1.0, 0.75, 1.1, 70, [5.0, 5.8, 7.0, 8.0], 0.1, "light"],
  ["pumpkin", "Pumpkin / squash", "Vegetable", "fruit", 10, 18, 28, 36, 0, 2, 35, 1100, 1.0, 0.5, 1.0, 0.8, 1.0, 50, [5.0, 6.0, 7.5, 8.2], 0.2, "any"],
  ["okra", "Okra", "Vegetable", "pods", 12, 22, 32, 40, 1, 4, 40, 1000, 0.8, 0.4, 1.0, 0.8, 1.0, 20, [5.5, 6.0, 7.5, 8.3], 0.3, "any"],
  ["lettuce", "Lettuce", "Vegetable", "heads", 4, 12, 20, 28, -3, -1, 28, 700, 0.4, 0.7, 1.0, 0.95, 1.0, 50, [5.6, 6.2, 7.2, 8.0], 0.3, "medium"],
  ["spinach", "Spinach", "Vegetable", "leaves", 2, 10, 20, 28, -8, -3, 28, 600, 0.4, 0.7, 1.0, 0.95, 1.0, 30, [6.0, 6.5, 7.5, 8.2], 0.3, "medium"],
  ["tobacco", "Tobacco", "Industrial", "cured leaf", 10, 20, 28, 35, 0, 2, 35, 1500, 0.8, 0.4, 1.1, 0.8, 0.9, 2.8, [5.0, 5.5, 6.8, 7.8], 0.1, "light"],
  ["hemp", "Hemp (fibre)", "Industrial", "stem DM", 5, 16, 27, 35, -4, -1, 35, 1800, 1.2, 0.4, 1.1, 0.5, 1.0, 16, [5.8, 6.2, 7.8, 8.5], 0.2, "medium"],
  ["lucerne", "Lucerne / alfalfa", "Forage", "hay DM", 5, 15, 28, 38, -15, -3, 38, 0, 1.8, 0.4, 0.95, 0.9, 1.1, 15, [6.0, 6.5, 8.0, 8.8], 0.1, "medium", 0, 1],
  ["ryegrass", "Ryegrass pasture", "Forage", "pasture DM", 3, 10, 20, 30, -12, -5, 30, 0, 0.8, 0.9, 1.0, 0.9, 1.0, 12, [5.0, 5.6, 7.0, 8.0], 0.7, "any", 0, 1],
  ["rhodes", "Rhodes grass pasture", "Forage", "pasture DM", 10, 20, 32, 40, -2, 0, 40, 0, 1.0, 0.9, 1.0, 0.9, 1.0, 12, [5.0, 5.8, 8.0, 8.8], 0.5, "any", 0, 1],
  ["sugarcane", "Sugarcane", "Industrial", "cane", 12, 24, 34, 40, 0, 1, 40, 0, 1.5, 0.4, 1.25, 0.75, 1.2, 150, [4.8, 5.5, 7.5, 8.5], 0.6, "any", 0, 1],
  ["coffee", "Coffee (arabica)", "Tree crop", "green beans", 10, 18, 23, 30, 1, 2, 32, 0, 1.5, 0.9, 0.95, 0.95, 1.0, 2, [4.5, 5.0, 6.2, 7.2], 0.2, "medium", 0, 1],
  ["tea", "Tea", "Tree crop", "made tea", 10, 18, 27, 33, -4, -1, 34, 0, 1.2, 0.95, 1.0, 1.0, 1.0, 3, [4.0, 4.5, 5.8, 6.5], 0.3, "medium", 0, 1],
  ["cocoa", "Cocoa", "Tree crop", "dry beans", 15, 22, 30, 34, 8, 10, 35, 0, 1.0, 1.0, 1.05, 1.05, 1.0, 1.5, [4.8, 5.5, 7.0, 7.8], 0.4, "medium", 0, 1],
  ["oil_palm", "Oil palm", "Tree crop", "fresh fruit bunches", 15, 24, 32, 36, 8, 10, 37, 0, 1.2, 0.95, 1.0, 1.0, 1.0, 30, [4.0, 4.8, 6.5, 7.5], 0.6, "any", 0, 1],
  ["banana", "Banana", "Tree crop", "fruit", 12, 24, 30, 36, 2, 6, 38, 0, 0.8, 0.5, 1.1, 1.0, 1.2, 70, [4.5, 5.5, 7.0, 8.0], 0.4, "medium", 0, 1],
  ["citrus", "Citrus", "Tree crop", "fruit", 10, 20, 30, 38, -3, -2, 40, 0, 1.2, 0.7, 0.65, 0.7, 1.1, 60, [5.0, 6.0, 7.5, 8.3], 0.2, "light", 0, 1],
  ["grape", "Wine grape", "Tree crop", "fruit", 8, 17, 28, 36, -15, -1, 38, 0, 1.5, 0.3, 0.7, 0.45, 0.85, 15, [5.0, 6.0, 7.8, 8.6], 0.3, "any", 150, 1],
  ["olive", "Olive", "Tree crop", "fruit", 7, 15, 28, 38, -8, -2, 40, 0, 1.5, 0.65, 0.7, 0.7, 0.6, 8, [5.5, 6.5, 8.0, 8.8], 0.15, "any", 300, 1],
  ["apple", "Apple", "Tree crop", "fruit", 4, 13, 23, 32, -25, -2, 35, 0, 1.5, 0.6, 0.95, 0.75, 1.0, 80, [5.0, 5.8, 7.0, 8.0], 0.3, "medium", 800, 1],
  ["mango", "Mango", "Tree crop", "fruit", 12, 24, 32, 40, 1, 4, 42, 0, 2.0, 0.8, 0.9, 0.85, 1.0, 15, [4.5, 5.5, 7.0, 8.0], 0.3, "any", 0, 1],
  ["almond", "Almond", "Tree crop", "kernels", 7, 16, 28, 38, -12, -2, 40, 0, 1.5, 0.4, 0.9, 0.65, 1.0, 3, [5.5, 6.5, 8.0, 8.6], 0.1, "light", 400, 1],
  ["avocado", "Avocado", "Tree crop", "fruit", 10, 18, 28, 34, -1, 0, 36, 0, 1.0, 0.6, 0.85, 0.75, 1.0, 15, [5.0, 5.5, 6.8, 7.8], 0.05, "light", 0, 1],
];

// Transpiration productivity, kg product / ha / mm (C4 > C3 cereals > oilseeds/pulses; fresh-weight crops high).
const WP: Record<string, number> = {
  wheat: 18, durum: 17, barley: 18, oats: 15, rye: 15, triticale: 18, maize: 30, sorghum: 25, pearl_millet: 15, finger_millet: 13,
  rice: 18, teff: 9, quinoa: 10, buckwheat: 8, chickpea: 12, lentil: 11, field_pea: 15, faba_bean: 16, lupin: 12, soybean: 12,
  common_bean: 11, cowpea: 10, mung_bean: 9, pigeon_pea: 7, groundnut: 13, vetch: 30, canola: 13, mustard: 11, sunflower: 9,
  safflower: 7, linseed: 8, sesame: 5, cotton: 5, potato: 150, sweet_potato: 90, cassava: 60, yam: 70, sugar_beet: 150,
  onion: 120, carrot: 120, garlic: 40, tomato: 200, cabbage: 150, chili: 50, watermelon: 120, pumpkin: 90, okra: 30,
  lettuce: 150, spinach: 80, tobacco: 6, hemp: 25, lucerne: 22, ryegrass: 20, rhodes: 20, sugarcane: 90, coffee: 2.5, tea: 3,
  cocoa: 1.5, oil_palm: 22, banana: 50, citrus: 60, grape: 25, olive: 12, apple: 70, mango: 20, almond: 4, avocado: 20,
};

// Crops whose yield falls sharply to foliar disease when the season is wet.
const HUMID: Record<string, number> = {
  chickpea: 0.55, lentil: 0.45, safflower: 0.5, sesame: 0.3, quinoa: 0.3, sunflower: 0.25, field_pea: 0.25, mung_bean: 0.3,
  linseed: 0.2, durum: 0.25, onion: 0.2, garlic: 0.2, tomato: 0.25, potato: 0.15, grape: 0.25, almond: 0.3, olive: 0.2,
};

export const CROPS: Crop[] = ROWS.map((r) => ({
  id: r[0], name: r[1], group: r[2], product: r[3], tbase: r[4], toptLo: r[5], toptHi: r[6], tmax: r[7],
  vegFrost: r[8], flowerFrost: r[9], heat: r[10], gdd: r[11], root: r[12], kcIni: r[13], kcMid: r[14], kcEnd: r[15],
  ky: r[16], yMax: r[17], ph: r[18], wlTol: r[19], texture: r[20], chill: r[21] ?? 0, perennial: r[22] === 1,
  limeTarget: Math.min(6.5, Math.max(5.5, (r[18][1] + 0.3))),
  wpT: WP[r[0]] ?? 15,
  humidSens: HUMID[r[0]] ?? 0,
}));

export const cropById = (id: string) => CROPS.find((c) => c.id === id);
