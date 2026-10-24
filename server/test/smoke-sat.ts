const t = Date.now();
const r = await fetch("http://localhost:8787/api/satellite", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ polygon: [[142.155, -36.627], [142.165, -36.627], [142.165, -36.634], [142.155, -36.634]], days: 400 }) });
const j = await r.json();
console.log(`${((Date.now() - t) / 1000).toFixed(0)}s`, j.source, "| obs", j.series?.length, "| scenes", j.scenes?.length, "| errors", j.errors);
console.log(j.series?.map((s: any) => `${s.date} ndvi=${s.ndvi.toFixed(2)} ndmi=${s.ndmi.toFixed(2)} clear=${(s.validFraction * 100).toFixed(0)}%`).join("\n"));
