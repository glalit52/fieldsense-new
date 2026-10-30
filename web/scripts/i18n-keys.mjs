// Lists every English string the UI translates: t("…") literals in src/, plus values that reach t() through
// variables (tab names, labels, server enums and stage names). Usage: node scripts/i18n-keys.mjs [--missing hi]
import fs from "node:fs";
import path from "node:path";

const src = new URL("../src/", import.meta.url).pathname;
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})(src);

const keys = new Set();
const literal = /\bt\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
for (const f of files) {
  const code = fs.readFileSync(f, "utf8");
  for (const m of code.matchAll(literal)) if (!m[2].includes("${")) keys.add(m[2].replace(/\\(["'`\\])/g, "$1"));
  // Constant tables whose values are translated at render time.
  for (const table of ["TABS", "ACTIVITY_LABELS", "SORTS", "EXAMPLES", "FACTOR_LABELS", "SUGGESTED"]) {
    const at = code.indexOf(`const ${table}`);
    if (at < 0) continue;
    const body = code.slice(at, code.indexOf(";\n", at));
    for (const m of body.matchAll(/"([^"]{2,})"/g)) if (/[A-Za-z]{2}/.test(m[1]) && !/^[a-z_]+$/.test(m[1])) keys.add(m[1]);
  }
  for (const m of code.matchAll(/\brow\("[a-zA-Z]+", "([^"]+)"\)/g)) keys.add(m[1]);
}
// Values from the server that the UI passes through t().
[
  "Reading weather, soil, terrain and satellite records", "Estimating soil", "Replaying 35 years of weather", "Scoring 67 crops season by season",
  "Projecting to 2045 with CMIP6 models", "Tracing land health since 2000",
  "Can't reach the FieldSense server. Check your connection and try again.", "Accounts are temporarily unavailable.",
  "None needed", "Borderline", "Likely needed", "low", "moderate", "high", "medium", "very high", "good", "marginal", "firm", "likely", "uncertain",
  "Basal, at transplanting", "Active tillering", "Panicle initiation", "Basal, at sowing", "Knee-high (6–8 leaves)", "Before tasselling",
  "Tillering / first irrigation", "Booting, before flowering", "Rosette / first irrigation", "Basal, at planting", "Squaring / tillering", "Peak growth",
  "Early growth / earthing up", "Flowering / bulking", "After establishment or grazing", "After the first cut", "Start of the growing flush", "Fruit set",
  "Fruit fill / after harvest", "Urea", "DAP", "MOP (potash)",
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
].forEach((k) => keys.add(k));

const sorted = [...keys].filter((k) => k.trim()).sort();
const miss = process.argv.indexOf("--missing");
if (miss > 0) {
  const lang = process.argv[miss + 1];
  const dict = JSON.parse(fs.readFileSync(path.join(src, "i18n", `${lang}.json`), "utf8"));
  const missing = sorted.filter((k) => !dict[k]);
  console.log(JSON.stringify(missing, null, 1));
  console.error(`${lang}: ${missing.length} of ${sorted.length} missing`);
} else console.log(JSON.stringify(sorted, null, 1));
