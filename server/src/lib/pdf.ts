/**
 * Minimal PDF 1.4 writer: A4 pages, Helvetica / Helvetica-Bold (WinAnsi), text, lines and filled boxes.
 * Enough for a printable field report without a PDF dependency. Text outside WinAnsi (e.g. Devanagari)
 * is transliterated to ASCII placeholders, so reports are produced in English.
 */

export const A4 = { w: 595.28, h: 841.89 };
type RGB = [number, number, number];

// Helvetica advance widths (1/1000 em) for ASCII 32–126, from the Adobe Core 14 AFM files.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** Unicode → WinAnsi (cp1252) byte, for the characters reports use; anything else becomes ASCII. */
const WIN: Record<string, number | string> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "•": 0x95, "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "™": 0x99,
  "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "↑": "^", "↓": "v", "≈": "~", "₂": "2", "₃": "3", "₹": "Rs ", "✓": "v", "✗": "x", "×": 0xd7, "÷": 0xf7,
  "−": "-", " ": " ", " ": " ", " ": " ",
};
function encode(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    const m = WIN[ch];
    if (typeof m === "number") out.push(m);
    else if (typeof m === "string") for (const c of m) out.push(c.charCodeAt(0));
    else if (code >= 0x20 && code <= 0x7e) out.push(code);
    else if (code >= 0xa0 && code <= 0xff) out.push(code);
    else if (code === 0x0a) out.push(0x20);
    else out.push(0x3f); // "?"
  }
  return out;
}

export function textWidth(s: string, size: number, bold = false) {
  const t = bold ? HELV_BOLD : HELV;
  let w = 0;
  for (const b of encode(s)) w += b >= 32 && b <= 126 ? t[b - 32] : 556;
  return (w * size) / 1000;
}

/** Splits text into lines no wider than `width`, breaking at spaces (or mid-word for very long words). */
export function wrap(s: string, width: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of s.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (textWidth(next, size, bold) <= width) { cur = next; continue; }
      if (cur) lines.push(cur);
      cur = word;
      while (textWidth(cur, size, bold) > width && cur.length > 1) {
        let i = cur.length - 1;
        while (i > 1 && textWidth(cur.slice(0, i), size, bold) > width) i--;
        lines.push(cur.slice(0, i));
        cur = cur.slice(i);
      }
    }
    lines.push(cur);
  }
  return lines;
}

const num = (v: number) => (Math.round(v * 100) / 100).toString();
const pdfString = (s: string) => {
  let out = "(";
  for (const b of encode(s)) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) out += "\\" + b.toString(8).padStart(3, "0");
    else out += String.fromCharCode(b);
  }
  return out + ")";
};

export interface TextOpts { size?: number; bold?: boolean; color?: RGB; align?: "left" | "right" | "center" }

export class PdfDoc {
  private pages: string[][] = [[]];
  private cur: string[] = this.pages[0];
  readonly info: { title: string; author: string };

  constructor(title: string, author = "FieldSense by SenseGrass") {
    this.info = { title, author };
  }
  get pageCount() { return this.pages.length; }

  addPage() {
    this.cur = [];
    this.pages.push(this.cur);
  }

  /** Text with its baseline at y (PDF coordinates: origin bottom-left). */
  text(x: number, y: number, s: string, o: TextOpts = {}) {
    const size = o.size ?? 10, w = o.align && o.align !== "left" ? textWidth(s, size, o.bold) : 0;
    const tx = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    const [r, g, b] = o.color ?? [0.13, 0.15, 0.13];
    this.cur.push(`BT ${num(r)} ${num(g)} ${num(b)} rg /${o.bold ? "F2" : "F1"} ${num(size)} Tf ${num(tx)} ${num(y)} Td ${pdfString(s)} Tj ET`);
  }

  rect(x: number, y: number, w: number, h: number, fill: RGB, stroke?: RGB) {
    const f = `${num(fill[0])} ${num(fill[1])} ${num(fill[2])} rg`;
    const s = stroke ? ` ${num(stroke[0])} ${num(stroke[1])} ${num(stroke[2])} RG 0.5 w` : "";
    this.cur.push(`q ${f}${s} ${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${stroke ? "B" : "f"} Q`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = [0.8, 0.82, 0.8], width = 0.5) {
    this.cur.push(`q ${num(color[0])} ${num(color[1])} ${num(color[2])} RG ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S Q`);
  }

  /** Serialises the document. `decorate` draws on every page once the page count is known (footers, page numbers). */
  toBuffer(decorate?: (page: number, total: number) => void): Buffer {
    if (decorate) this.pages.forEach((ops, i) => { this.cur = ops; decorate(i + 1, this.pages.length); });
    const pages = this.pages.map((ops) => ops.join("\n"));
    const objs: string[] = [];
    const add = (s: string) => (objs.push(s), objs.length);
    const catalog = add(""), pagesObj = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const content of pages) {
      const stream = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const infoObj = add(`<< /Title ${pdfString(this.info.title)} /Author ${pdfString(this.info.author)} /Producer (FieldSense) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);

    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}
