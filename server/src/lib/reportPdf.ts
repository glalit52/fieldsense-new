import type { FastifyReply } from "fastify";
import { config } from "../config.ts";
import type { CheckMeta } from "../stores/checks.ts";
import { A4, PdfDoc, textWidth, wrap } from "./pdf.ts";

type RGB = [number, number, number];
const GREEN: RGB = [0.18, 0.49, 0.2], INK: RGB = [0.13, 0.15, 0.13], MUTED: RGB = [0.42, 0.45, 0.42], RULE: RGB = [0.85, 0.87, 0.85];
const LEVEL: Record<string, RGB> = { low: [0.3, 0.62, 0.32], moderate: [0.85, 0.6, 0.1], high: [0.8, 0.22, 0.18], danger: [0.8, 0.22, 0.18], warn: [0.85, 0.6, 0.1], info: [0.25, 0.45, 0.7] };
const M = 42; // page margin
const W = A4.w - 2 * M;

const f = (v: unknown, d = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "–");
const scoreColor = (s: number): RGB => (s >= 60 ? [0.3, 0.62, 0.32] : s >= 35 ? [0.85, 0.6, 0.1] : [0.8, 0.22, 0.18]);
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Lays out flowing content top-down and starts a new page when the next block doesn't fit. */
class Flow {
  y = A4.h - M;
  readonly doc: PdfDoc;
  private header: string;
  constructor(doc: PdfDoc, header: string) {
    this.doc = doc;
    this.header = header;
  }
  need(h: number) {
    if (this.y - h >= M + 24) return;
    this.doc.addPage();
    this.y = A4.h - M;
    this.doc.text(M, this.y, this.header, { size: 8, color: MUTED });
    this.y -= 18;
  }
  gap(h = 8) { this.y -= h; }
  heading(s: string) {
    this.need(40);
    this.gap(6);
    this.doc.text(M, this.y, s, { size: 13, bold: true, color: GREEN });
    this.y -= 6;
    this.doc.line(M, this.y, M + W, this.y, RULE, 0.8);
    this.y -= 14;
  }
  para(s: string, size = 9.5, color: RGB = INK, indent = 0, bold = false) {
    for (const line of wrap(s, W - indent, size, bold)) {
      this.need(size + 4);
      this.doc.text(M + indent, this.y, line, { size, color, bold });
      this.y -= size + 3.5;
    }
  }
  bullet(s: string, color: RGB = INK) {
    const lines = wrap(s, W - 14, 9.5);
    this.need(lines.length * 13);
    this.doc.rect(M + 2, this.y + 2, 3.5, 3.5, color);
    lines.forEach((line) => { this.doc.text(M + 12, this.y, line, { size: 9.5 }); this.y -= 13; });
  }
  /** Simple table: columns as [title, width share, align]. Long cells wrap. */
  table(cols: [string, number, ("left" | "right")?][], rows: string[][], rowColor?: (i: number) => RGB | undefined) {
    const total = cols.reduce((a, c) => a + c[1], 0);
    const xs: number[] = [];
    let x = M;
    for (const c of cols) { xs.push(x); x += (c[1] / total) * W; }
    const width = (i: number) => (cols[i][1] / total) * W - 6;
    const head = () => {
      this.need(30);
      this.doc.rect(M, this.y - 4, W, 15, [0.93, 0.95, 0.93]);
      cols.forEach((c, i) => this.doc.text(c[2] === "right" ? xs[i] + width(i) : xs[i] + 3, this.y, c[0], { size: 8.5, bold: true, color: MUTED, align: c[2] === "right" ? "right" : "left" }));
      this.y -= 16;
    };
    head();
    rows.forEach((r, ri) => {
      const cells = r.map((v, i) => wrap(v ?? "", width(i), 9));
      const h = Math.max(...cells.map((c) => c.length)) * 11.5 + 4;
      if (this.y - h < M + 24) { this.need(h + 40); head(); }
      const mark = rowColor?.(ri);
      if (mark) this.doc.rect(M, this.y - h + 9, 3, h - 2, mark);
      cells.forEach((lines, i) => lines.forEach((line, li) =>
        this.doc.text(cols[i][2] === "right" ? xs[i] + width(i) : xs[i] + 3 + (i === 0 && mark ? 3 : 0), this.y - li * 11.5, line, { size: 9, align: cols[i][2] === "right" ? "right" : "left" })));
      this.y -= h;
      this.doc.line(M, this.y + 7, M + W, this.y + 7, RULE, 0.4);
    });
    this.gap(4);
  }
  /** Row of headline numbers in boxes. */
  stats(items: [string, string, string?][]) {
    const h = 46, gap = 8, w = (W - gap * (items.length - 1)) / items.length;
    this.need(h + 8);
    items.forEach(([label, value, sub], i) => {
      const x = M + i * (w + gap);
      this.doc.rect(x, this.y - h + 10, w, h, [0.96, 0.97, 0.96], RULE);
      this.doc.text(x + 7, this.y - 1, label, { size: 7.5, color: MUTED });
      this.doc.text(x + 7, this.y - 18, value, { size: 14, bold: true });
      if (sub) this.doc.text(x + 7, this.y - 30, wrap(sub, w - 12, 7)[0], { size: 7, color: MUTED });
    });
    this.y -= h + 6;
  }
  /** Vertical bars with labels under them. */
  bars(values: number[], labels: string[], max: number, color: (v: number, i: number) => RGB, h = 70, caption?: string) {
    this.need(h + 30);
    const n = values.length, slot = W / n, bw = Math.min(28, slot * 0.7);
    const base = this.y - h;
    this.doc.line(M, base, M + W, base, RULE, 0.6);
    values.forEach((v, i) => {
      const bh = max > 0 ? Math.max(0.5, (Math.min(v, max) / max) * (h - 12)) : 0;
      const x = M + i * slot + (slot - bw) / 2;
      this.doc.rect(x, base, bw, bh, color(v, i));
      this.doc.text(x + bw / 2, base + bh + 3, Math.round(v).toString(), { size: 7, color: MUTED, align: "center" });
      // Labels alternate between two rows when slots are narrow, and are shortened to fit two slots.
      const twoRows = slot < 45, room = (twoRows ? 2 * slot : slot) - 4;
      let lab = labels[i];
      while (lab.length > 2 && textWidth(lab, 7) > room) lab = lab.slice(0, -2) + ".";
      this.doc.text(x + bw / 2, base - 10 - (twoRows && i % 2 ? 9 : 0), lab, { size: 7, color: MUTED, align: "center" });
    });
    this.y = base - (slot < 45 ? 34 : 24);
    if (caption) { this.para(caption, 8, MUTED); this.gap(6); }
  }
}

export interface PdfExtras { fieldName?: string; history?: CheckMeta[] }

/** The field report as a printable A4 PDF (English). */
export function reportPdf(r: any, extra: PdfExtras = {}) {
  const loc = r.location ?? {};
  const place = [loc.place, loc.region, loc.country].filter(Boolean).join(", ") || `${f(loc.lat, 4)}, ${f(loc.lon, 4)}`;
  const title = extra.fieldName ? `${extra.fieldName}: ${place}` : place;
  const checked = new Date(r.generatedAt);
  const doc = new PdfDoc(`FieldSense report – ${title}`);
  const flow = new Flow(doc, `FieldSense · ${title} · ${checked.toISOString().slice(0, 10)}`);

  // Header band
  doc.rect(0, A4.h - 92, A4.w, 92, GREEN);
  doc.text(M, A4.h - 40, "FieldSense", { size: 22, bold: true, color: [1, 1, 1] });
  doc.text(M, A4.h - 56, "Precision agro-climatic field report · SenseGrass", { size: 9.5, color: [0.88, 0.95, 0.88] });
  doc.text(A4.w - M, A4.h - 40, checked.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), { size: 10, color: [1, 1, 1], align: "right" });
  doc.text(A4.w - M, A4.h - 56, config.contactEmail, { size: 9, color: [0.88, 0.95, 0.88], align: "right" });
  flow.y = A4.h - 120;

  flow.para(title, 15, INK, 0, true);
  flow.para([
    `${f(loc.lat, 4)}, ${f(loc.lon, 4)}`, loc.areaHa ? `${f(loc.areaHa, 1)} ha outlined` : "pin (no outline)",
    loc.elevation != null ? `${f(loc.elevation, 0)} m elevation` : "", r.climate?.normals?.climateClass ?? "",
  ].filter(Boolean).join(" · "), 9, MUTED);
  flow.gap(8);
  const head = wrap(r.headline ?? "", W - 20, 12, true);
  const boxH = head.length * 16 + 12;
  flow.need(boxH + 10);
  doc.rect(M, flow.y - boxH, W, boxH, [0.92, 0.96, 0.92]);
  head.forEach((line, i) => doc.text(M + 10, flow.y - 17 - i * 16, line, { size: 12, bold: true, color: GREEN }));
  flow.y -= boxH + 18;

  const ph = r.soil?.topsoil?.ph, top = r.crops?.[0];
  flow.stats([
    ["Soil pH (topsoil)", f(ph?.p50, 1), ph ? `range ${f(ph.p10, 1)}–${f(ph.p90, 1)}${r.soil.labOverride ? " · lab" : ""}` : ""],
    ["Rain per year", `${f(r.climate?.normals?.rain, 0)} mm`, `${r.climate?.dryYearsInTen ?? "–"} dry years in 10`],
    ["Top crop", top?.name ?? "–", top ? `score ${top.score}/100 · ${f(top.yieldTPerHa?.median)} t/ha typical` : ""],
    ["Lime", r.lime?.call ?? "–", r.lime?.call && r.lime.call !== "None needed" ? `~${f(r.lime.rateTPerHa?.mid)} t/ha to pH ${f(r.lime.targetPh, 1)}` : "no lime needed"],
  ]);

  // Crops
  flow.heading("Crops that fit this field");
  flow.para("Each crop is simulated day by day for the last 30 seasons with a soil-water balance, frost and heat at flowering, and this soil. Score = average share of a world-class yield reached here. Yields are attainable with good management, in t/ha of the crop's product.", 8.5, MUTED);
  flow.gap(4);
  const crops = (r.crops ?? []).slice(0, 15);
  flow.bars(crops.map((c: any) => c.score), crops.map((c: any) => c.name), 100, (v) => scoreColor(v), 80, "Rainfed score out of 100, top 15 crops.");
  flow.table(
    [["Crop", 2.2], ["Score", 0.8, "right"], ["Dry · typical · good (t/ha)", 2.2, "right"], ["Irrigated", 1, "right"], ["Sow", 1.8], ["Held back by", 2.6]],
    crops.map((c: any) => [c.name, String(c.score), `${f(c.yieldTPerHa.poor)} · ${f(c.yieldTPerHa.median)} · ${f(c.yieldTPerHa.good)}`, f(c.irrigatedYieldTPerHa), c.sowing?.label ?? "perennial", c.limiting?.join(", ") || "nothing major"]),
    (i) => scoreColor(crops[i].score),
  );

  // Soil & lime
  flow.heading("Soil and lime");
  const s = r.soil ?? {};
  flow.table([["Property", 2], ["Topsoil 0–30 cm", 1.4, "right"], ["Subsoil 30–100 cm", 1.4, "right"]], [
    ["pH (water)", f(s.topsoil?.ph?.p50, 1), f(s.subsoil?.ph?.p50, 1)],
    ["Organic carbon %", f(s.topsoil?.soc?.p50 != null ? s.topsoil.soc.p50 / 10 : null, 2), f(s.subsoil?.soc?.p50 != null ? s.subsoil.soc.p50 / 10 : null, 2)],
    ["Clay %", f(s.topsoil?.clay?.p50, 0), f(s.subsoil?.clay?.p50, 0)],
    ["Sand %", f(s.topsoil?.sand?.p50, 0), f(s.subsoil?.sand?.p50, 0)],
  ]);
  flow.para(`Texture ${s.texture ?? "–"} over ${s.textureSub ?? "–"}; drainage ${s.drainage ?? "–"}; plant-available water ${f(s.awcMmPerM, 0)} mm per metre; carbon stock ${f(s.carbonStockTPerHa30, 0)} t/ha (0–30 cm). Source: ${s.source ?? "–"} (${s.confidence ?? "–"} confidence).`, 9);
  flow.gap(4);
  const lime = r.lime ?? {};
  flow.para(`Lime: ${lime.call ?? "–"}${lime.call && lime.call !== "None needed" ? `. About ${f(lime.rateTPerHa?.mid)} t/ha (range ${f(lime.rateTPerHa?.low)}–${f(lime.rateTPerHa?.high)}) of good agricultural lime to reach pH ${f(lime.targetPh, 1)}.` : "."}`, 9.5, INK, 0, true);
  for (const n of lime.notes ?? []) flow.bullet(n, GREEN);

  // Risks
  flow.heading("Risks");
  flow.table([["Risk", 1.4], ["Level", 0.9], ["Why", 5]], (r.risks ?? []).map((x: any) => [x.label, x.level, x.detail ?? ""]), (i) => LEVEL[r.risks[i].level]);

  // Next 16 days
  if (r.operations) {
    flow.heading("Next 16 days");
    const ops = r.operations;
    flow.para(`Soil water ${ops.soilWaterPct != null ? `${f(ops.soilWaterPct, 0)}% of capacity` : "unknown"} · next 7 days: ${f(ops.waterBalance7d?.rain, 0)} mm rain vs ${f(ops.waterBalance7d?.et0, 0)} mm crop water use.`, 9);
    flow.gap(2);
    for (const a of ops.alerts ?? []) flow.bullet(a.text, LEVEL[a.level] ?? GREEN);
    const days = (ops.days ?? []).filter((d: any) => !d.past).slice(0, 10);
    flow.table([["Day", 1.3], ["Temp °C", 1.1, "right"], ["Rain mm", 0.9, "right"], ["Wind km/h", 0.9, "right"], ["Spray", 1.6], ["Disease", 0.9], ["Workable", 0.9]],
      days.map((d: any) => [new Date(d.date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
        `${f(d.tmin, 0)} / ${f(d.tmax, 0)}`, f(d.rain, 1), f(d.windMax, 0),
        d.sprayWindows?.length ? d.sprayWindows.map((w: any) => `${w.from}–${w.to}`).join(", ") : "–", d.diseaseRisk, d.workable ? "yes" : "no"]));
  }

  // Climate
  flow.heading("Climate (1991 – present)");
  const n = r.climate?.normals ?? {}, tr = r.climate?.trends ?? {};
  flow.stats([
    ["Mean temperature", `${f(n.tmean, 1)} °C`, `${tr.tempPerDecade >= 0 ? "+" : ""}${f(tr.tempPerDecade, 2)} °C per decade`],
    ["Crop water demand", `${f(n.et0, 0)} mm`, `aridity index ${f(n.aridityIndex, 2)}`],
    ["Frost nights / yr", f(n.frostNights, 0), `${n.frostFreeDays ?? "–"} frost-free days`],
    ["Days ≥ 35 °C / yr", f(n.hotDays, 0), `${tr.hotDaysPerDecade >= 0 ? "+" : ""}${f(tr.hotDaysPerDecade, 1)} per decade`],
  ]);
  const monthly = r.climate?.monthly ?? [];
  if (monthly.length === 12) flow.bars(monthly.map((m: any) => m.rain), MONTHS, Math.max(...monthly.map((m: any) => m.rain), 1), () => [0.25, 0.45, 0.7], 60, "Average monthly rainfall, mm.");

  // Land, satellite and future
  if (r.land) {
    flow.heading("Land health since 2000");
    flow.para(`Green cover ${r.land.verdict?.toLowerCase() ?? "–"}: ${r.land.changePct >= 0 ? "+" : ""}${f(r.land.changePct, 1)}% since ${r.land.firstYear} (trend p = ${f(r.land.pValue, 2)}). Peak green in month ${r.land.peakMonth ?? "–"}, ${f(r.land.croppingIntensity, 0)} cropping season(s) a year. Source: ${r.land.source}.`, 9.5);
  }
  if (r.future?.crops?.length) {
    flow.heading("2045 outlook (CMIP6)");
    flow.para(`${r.future.horizon}: about ${f(r.future.warmingC, 1)} °C warmer, rainfall ${r.future.rainChangePct >= 0 ? "+" : ""}${f(r.future.rainChangePct, 0)}%, across ${r.future.models.length} climate models.`, 9.5);
    flow.table([["Crop", 2], ["Score now", 1, "right"], ["Score 2045", 1, "right"], ["Change", 1, "right"]],
      r.future.crops.slice(0, 10).map((c: any) => [c.name, String(c.now), String(c.future), `${c.change >= 0 ? "+" : ""}${c.change}`]));
  }

  // History
  if (extra.history && extra.history.length > 1) {
    flow.heading("Check history");
    flow.table([["Checked", 1.3], ["Soil pH", 0.8, "right"], ["Top crop", 1.6], ["Score", 0.7, "right"], ["Lime", 1.2], ["Land change", 1, "right"]],
      extra.history.slice(0, 15).map((h) => [new Date(h.checkedAt).toISOString().slice(0, 10), f(h.soilPh, 1), h.topCrops[0]?.name ?? "–", String(h.topCrops[0]?.score ?? "–"), h.lime.call, h.landChangePct != null ? `${f(h.landChangePct, 1)}%` : "–"]));
  }

  // Sources and disclaimer
  flow.heading("Sources and notes");
  for (const [k, v] of Object.entries(r.sources ?? {})) flow.para(`${k}: ${v}`, 8, MUTED);
  flow.gap(6);
  flow.para("Soil values come from maps and satellites unless a lab test is shown. Yields are attainable yields under good management for past seasons' weather, not forecasts. Lime and fertiliser rates are planning estimates; confirm with a soil test and a local agronomist.", 8, MUTED);

  return doc.toBuffer((page, total) => {
    doc.text(M, 24, `FieldSense by SenseGrass · ${config.contactEmail}`, { size: 7.5, color: MUTED });
    doc.text(A4.w - M, 24, `Page ${page} of ${total}`, { size: 7.5, color: MUTED, align: "right" });
  });
}

/** Sends a PDF as a download with a safe ASCII filename. */
export function sendPdf(reply: FastifyReply, pdf: Buffer, name: string) {
  const file = `fieldsense-${name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 80)}.pdf`;
  return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename="${file}"`).send(pdf);
}
