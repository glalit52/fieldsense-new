import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";
import type { Report } from "./engine/report.ts";

const client = config.anthropicKey ? new Anthropic({ apiKey: config.anthropicKey }) : null;

const SYSTEM = `You are Agris, the FieldSense farm assistant. You answer questions about ONE field, using the field report provided below as your source of truth.

How to answer:
- Reply in the language the farmer writes in. Plain words, short paragraphs, no jargon unless asked. Lead with the answer, then the reason.
- Quote the report's own numbers (pH, rain, scores, yields, dates, risks) and say when they are estimates with ranges. Never invent measurements that are not in the report.
- Soil values come from maps and satellites, not a lab. When a decision hinges on pH, nutrients or salinity, suggest a soil test, and offer to re-check the call if they share their lab values.
- Yields are attainable yields under good management for past seasons' weather, not forecasts. Say so if asked about "this year".
- The lime rate is a planning estimate, not a prescription.
- For pesticide or fertiliser product choices, give general guidance and point to the label and a local agronomist.
- If the report lacks what is needed, say what's missing and what would answer it.
- Keep answers under about 180 words unless the farmer asks for detail.`;

/** Report trimmed to what the assistant needs (drops long chart series). */
function compactReport(r: Report) {
  const { land, climate, crops, operations, ...rest } = r as any;
  return {
    ...rest,
    climate: { ...climate, years: undefined, recent: climate.recent },
    crops: crops.map((c: any) => ({ ...c, recentYears: c.recentYears.map((y: any) => `${y.year}:${y.score}`).join(" ") })),
    land: land && { ...land, series: undefined },
    operations: operations && { ...operations, days: operations.days.filter((d: any) => !d.past).map((d: any) => ({ date: d.date, tmax: d.tmax, tmin: d.tmin, rain: d.rain, sprayWindows: d.sprayWindows, diseaseRisk: d.diseaseRisk, frost: d.frost, workable: d.workable })) },
  };
}

interface Conversation { reportKey: string; context: string; messages: Anthropic.Beta.BetaMessageParam[]; touched: number }
const conversations = new Map<string, Conversation>();
setInterval(() => {
  for (const [k, v] of conversations) if (Date.now() - v.touched > 6 * 3600_000) conversations.delete(k);
}, 600_000).unref();

export function agrisMode() {
  return client ? `claude (${config.agrisModel})` : "built-in rules (set ANTHROPIC_API_KEY for Claude)";
}

/**
 * Streams an answer. The conversation is kept server-side and only ever appended to,
 * so Claude's own content blocks (including thinking) are returned unchanged each turn.
 */
export async function* ask(report: Report, question: string, conversationId?: string): AsyncGenerator<{ type: "meta"; conversationId: string; mode: string } | { type: "text"; text: string } | { type: "done" }> {
  const reportKey = `${report.location.lat},${report.location.lon},${report.generatedAt}`;
  let id = conversationId && conversations.has(conversationId) ? conversationId : randomUUID();
  let conv = conversations.get(id);
  if (!conv || conv.reportKey !== reportKey) {
    id = randomUUID();
    conv = { reportKey, context: JSON.stringify(compactReport(report)), messages: [], touched: Date.now() };
    conversations.set(id, conv);
  }
  conv.touched = Date.now();
  yield { type: "meta", conversationId: id, mode: client ? "claude" : "rules" };

  if (!client) {
    const text = ruleAnswer(report, question);
    conv.messages.push({ role: "user", content: question }, { role: "assistant", content: text });
    for (const chunk of text.match(/.{1,40}(\s|$)/gs) ?? [text]) yield { type: "text", text: chunk };
    yield { type: "done" };
    return;
  }

  conv.messages.push({ role: "user", content: question });
  const stream = client.beta.messages.stream({
    model: config.agrisModel,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: `FIELD REPORT (JSON):\n${conv.context}`, cache_control: { type: "ephemeral" } },
    ],
    messages: conv.messages,
  });
  try {
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { type: "text", text: ev.delta.text };
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      conv.messages.pop();
      yield { type: "text", text: "\n\nI can't help with that one. Ask me anything about this field's soil, crops, weather or risks." };
    } else {
      conv.messages.push({ role: "assistant", content: final.content as any });
    }
  } catch (e) {
    conv.messages.pop();
    const msg = e instanceof Anthropic.RateLimitError ? "Agris is busy right now. Try again in a moment."
      : e instanceof Anthropic.AuthenticationError ? "The Claude API key is invalid. Check ANTHROPIC_API_KEY."
      : e instanceof Anthropic.APIError ? `Agris hit an API error (${e.status}). Here's the built-in answer instead:\n\n${ruleAnswer(report, question)}`
      : `Connection problem. Here's the built-in answer instead:\n\n${ruleAnswer(report, question)}`;
    yield { type: "text", text: msg };
  }
  yield { type: "done" };
}

// ---------------- Rule-based fallback (no API key) ----------------

const f1 = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? "?" : n.toFixed(d));

export function ruleAnswer(r: Report, q: string): string {
  const s = q.toLowerCase();
  const top = r.crops.filter((c: any) => c.group !== "Forage").slice(0, 3);
  const ph = r.soil.topsoil.ph;
  const has = (...w: string[]) => w.some((x) => s.includes(x));
  const named = r.crops.find((c: any) => s.includes(c.name.toLowerCase().split(" ")[0].toLowerCase()) || s.includes(c.id.replace("_", " ")));

  if (has("lime", "acid", "ph")) {
    const l = r.lime;
    return `${l.call === "None needed" ? "No lime needed" : l.call === "Borderline" ? "Lime is borderline" : "Lime is likely needed"}, going by the scan. Topsoil pH is about ${f1(ph?.p50)} (likely between ${f1(ph?.p10)} and ${f1(ph?.p90)}), and the chance it is below ${l.threshold} is ${(l.probabilityBelowThreshold * 100).toFixed(0)}%.` +
      (l.call !== "None needed" ? ` To reach pH ${l.targetPh} in the top 10 cm, plan on roughly ${f1(l.rateTPerHa.mid)} t/ha of good-quality lime (range ${f1(l.rateTPerHa.low)}–${f1(l.rateTPerHa.high)}).` : "") +
      (l.subsoilAcidity ? " The subsoil also looks acidic, which surface lime is slow to fix." : "") +
      ` ${r.soil.labOverride ? "This uses your lab pH." : "Enter a lab or test-kit pH and I'll confirm the call."}`;
  }
  if (has("sow", "plant", "when")) {
    const c = named ?? top.find((x: any) => x.sowing) ?? top[0];
    return c.sowing ? `For ${c.name}, the best sowing window here is ${c.sowing.label}, based on replaying the last 30 seasons. Sown then it takes about ${c.seasonDays} days to mature and scores ${c.score}/100. ${c.limiting.length ? `Main limits: ${c.limiting.join(" and ")}.` : ""} Check the 16-day forecast in the Operations tab for soil moisture and a workable seedbed before you go.`
      : `${c.name} is a perennial crop here, so there's no sowing window. It scores ${c.score}/100.`;
  }
  if (has("dry", "drought", "rain")) {
    const c = named ?? top[0];
    return `Rain here averages ${f1(r.climate.normals.rain, 0)} mm a year, and ${r.climate.dryYearsInTen} of the last ten years ${r.climate.dryYearsInTen === 1 ? "was" : "were"} dry (under 80% of normal). In a dry year ${c.name} would yield about ${f1(c.yieldTPerHa.poor)} t/ha, against ${f1(c.yieldTPerHa.median)} t/ha in a typical year and ${f1(c.yieldTPerHa.good)} in a good one. With irrigation (about ${f1(c.irrigationMm, 0)} mm a season) it could reach ${f1(c.irrigatedYieldTPerHa)} t/ha.`;
  }
  if (has("waterlog", "wet", "flood", "drain", "corner")) {
    const w = r.risks.find((x: any) => x.id === "waterlogging")!;
    return `Waterlogging risk is ${w.level}. ${w.detail} Low corners and duplex soils collect water first in wet winters, so watch those spots and favour tolerant crops there (${r.crops.filter((c: any) => (c.factors.wetSeasons ?? 1) > 0.95).slice(0, 3).map((c: any) => c.name).join(", ") || "faba bean, oats, ryegrass"}).`;
  }
  if (has("frost", "heat", "spray", "forecast", "week")) {
    const a = r.operations?.alerts ?? [];
    return a.length ? `For the next 16 days: ${a.map((x: any) => x.text).join(" ")}` : "No frost, heat or disease alerts in the 16-day forecast.";
  }
  if (has("soil", "report", "explain", "texture", "clay")) {
    return `Your topsoil looks like ${r.soil.texture.toLowerCase()} over ${r.soil.textureSub.toLowerCase()} subsoil, with pH about ${f1(ph?.p50)}, organic carbon about ${f1((r.soil.topsoil.soc?.p50 ?? 0) / 10)}%, and ${r.soil.drainage} drainage. It holds about ${f1(r.soil.awcMmPerM, 0)} mm of plant-available water per metre. Source: ${r.soil.source}. These are estimates with ranges; a lab test pins them down.`;
  }
  if (named) {
    return `${named.name} scores ${named.score}/100 here, with ${named.goodYearsInTen} good seasons in the last ten. Attainable yield is ${f1(named.yieldTPerHa.median)} t/ha in a typical year (${f1(named.yieldTPerHa.poor)} dry, ${f1(named.yieldTPerHa.good)} good).${named.sowing ? ` Sow ${named.sowing.label}.` : ""}${named.limiting.length ? ` Held back by ${named.limiting.join(" and ")}.` : ""}`;
  }
  return `${top[0].name} is the strongest crop here (${top[0].score}/100), followed by ${top[1].name} (${top[1].score}) and ${top[2].name} (${top[2].score}). ${r.headline} Ask me about lime, sowing dates, dry years, waterlogging, the forecast, or any crop by name.`;
}
