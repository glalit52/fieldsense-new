// End-to-end smoke test against a running server: node test/smoke-api.ts [baseUrl]
const base = process.argv[2] ?? "http://localhost:8787";
const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const health = await (await fetch(base + "/api/health")).json();
console.log("health:", health.agris, "crops", health.crops);

const res = await post("/api/report", { polygon: [[142.155, -36.627], [142.165, -36.627], [142.165, -36.634], [142.155, -36.634]] });
const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
const final = lines.at(-1);
if (final.type !== "report") throw new Error(final.error);
const r = final.report;
console.log("progress:", lines.filter((l) => l.type === "progress").length, "stages");
console.log("report:", r.headline, `| ${r.location.areaHa.toFixed(1)} ha | soil: ${r.soil.confidence} | errors: ${r.soil.errors.join("; ").slice(0, 80)}`);
console.log("top:", r.crops.slice(0, 5).map((c: any) => `${c.name} ${c.score} (${c.cultivar})`).join(", "));
const minSoc = Math.min(...r.soil.layers.map((l: any) => l.soc.p10));
console.log("min SOC p10 >= 0:", minSoc >= 0);

for (const q of ["Should I lime this paddock before sowing?", "When should I sow wheat here?", "What happens to my crop in a dry year?", "Is there a spray window this week?"]) {
  const a = await post("/api/agris", { reportId: final.reportId, question: q });
  let text = "", mode = "";
  for (const chunk of (await a.text()).split("\n\n")) {
    if (!chunk.startsWith("data: ")) continue;
    const e = JSON.parse(chunk.slice(6));
    if (e.type === "meta") mode = e.mode;
    if (e.type === "text") text += e.text;
  }
  console.log(`\nQ (${mode}): ${q}\nA: ${text}`);
}

const bad = await post("/api/report", { lat: 200, lon: 0 });
console.log("\nvalidation:", bad.status, (await bad.json()).error);
const batch = await (await post("/api/v1/batch", { fields: [{ id: "a", lat: -36.63, lon: 142.16 }, { id: "b", lat: 42.0, lon: -93.75 }] })).json();
console.log("batch:", batch.results.map((x: any) => `${x.id}: ${x.ok ? x.headline : x.error}`).join(" | "));
