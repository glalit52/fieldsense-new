// Translation review sheet for agronomists.
//   node scripts/i18n-sheet.mjs export review.csv   → every UI string with all translations side by side (opens in Excel / Google Sheets)
//   node scripts/i18n-sheet.mjs import review.csv   → writes reviewers' edits back into src/i18n/*.json
// Import refuses rows whose {placeholders} don't match the English, so a broken edit can't break the app.
import fs from "node:fs";
import path from "node:path";

const LANGS = ["hi", "mr", "pa", "bn", "ta", "te"];
const NAMES = { hi: "Hindi", mr: "Marathi", pa: "Punjabi", bn: "Bengali", ta: "Tamil", te: "Telugu" };
const dir = new URL("../src/i18n/", import.meta.url).pathname;
const [, , mode, file] = process.argv;
if (!["export", "import"].includes(mode) || !file) {
  console.error("usage: node scripts/i18n-sheet.mjs export|import <file.csv>");
  process.exit(1);
}
const load = (l) => JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), "utf8"));
const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ""));
}

if (mode === "export") {
  const dicts = Object.fromEntries(LANGS.map((l) => [l, load(l)]));
  const keys = Object.keys(dicts.hi).sort();
  const cell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [["English", ...LANGS.map((l) => `${NAMES[l]} (${l})`), "Reviewer notes"].map(cell).join(",")];
  for (const k of keys) lines.push([k, ...LANGS.map((l) => dicts[l][k] ?? ""), ""].map(cell).join(","));
  fs.writeFileSync(file, "﻿" + lines.join("\r\n") + "\r\n"); // BOM so Excel reads UTF-8
  console.log(`Wrote ${keys.length} strings × ${LANGS.length} languages to ${file}`);
} else {
  const [head, ...rows] = parseCsv(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const col = Object.fromEntries(LANGS.map((l) => [l, head.findIndex((h) => h.includes(`(${l})`))]));
  let changed = 0; const rejected = [];
  for (const l of LANGS) {
    if (col[l] < 0) continue;
    const dict = load(l);
    for (const r of rows) {
      const [en] = r, v = r[col[l]]?.trim();
      if (!en || !(en in dict) || !v || v === dict[en]) continue;
      if (placeholders(en) !== placeholders(v)) { rejected.push(`${l}: "${en}" → placeholders must be ${placeholders(en) || "none"}`); continue; }
      const lead = en.match(/^\s*/)[0], trail = en.match(/\s*$/)[0];
      dict[en] = lead + v + trail;
      changed++;
    }
    fs.writeFileSync(path.join(dir, `${l}.json`), JSON.stringify(Object.fromEntries(Object.entries(dict).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1) + "\n");
  }
  console.log(`Updated ${changed} translations.`);
  if (rejected.length) console.log(`Rejected ${rejected.length}:\n${rejected.join("\n")}`);
}
