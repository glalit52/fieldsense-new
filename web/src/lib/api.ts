export type LonLat = [number, number];
export type Report = any; // shape defined by server/src/engine/report.ts

export interface CheckInput {
  lat: number; lon: number; polygon?: LonLat[];
  lab?: { ph?: number; organicCarbon?: number; clay?: number };
  cropId?: string; limeTargetPh?: number; limeDepthCm?: number;
}

export async function runReport(input: CheckInput, onProgress: (s: string) => void): Promise<{ report: Report; reportId: string }> {
  const res = await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === "progress") onProgress(msg.stage);
      else if (msg.type === "report") return { report: msg.report, reportId: msg.reportId };
      else if (msg.type === "error") throw new Error(msg.error);
    }
  }
  throw new Error("Report stream ended unexpectedly");
}

export async function* askAgris(reportId: string, question: string, conversationId?: string) {
  const res = await fetch("/api/agris", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId, question, conversationId }) });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) yield JSON.parse(chunk.slice(6));
    }
  }
}

export const api = {
  health: () => fetch("/api/health").then((r) => r.json()),
  geocode: (q: string) => fetch(`/api/geocode?q=${encodeURIComponent(q)}`).then((r) => r.json()),
  satellite: (body: { lat: number; lon: number; polygon?: LonLat[]; days?: number }) =>
    fetch("/api/satellite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
  fields: () => fetch("/api/fields").then((r) => r.json()),
  saveField: (f: any) => fetch("/api/fields", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }).then((r) => r.json()),
  updateField: (id: string, f: any) => fetch(`/api/fields/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }).then((r) => r.json()),
  deleteField: (id: string) => fetch(`/api/fields/${id}`, { method: "DELETE" }).then((r) => r.json()),
  addTest: (id: string, t: any) => fetch(`/api/fields/${id}/tests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) }).then((r) => r.json()),
};
