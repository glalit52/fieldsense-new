import { useEffect, useRef, useState } from "react";
import { askAgris, type Report } from "../lib/api.ts";

const SUGGESTED = [
  "Should I lime this paddock before sowing?", "When should I sow the top crop here?", "What happens to my crop in a dry year?",
  "Which crop is the safest bet on this soil?", "Will the low corner waterlog?", "Explain my soil report in plain words",
  "Is there a spray window this week?",
];

interface Msg { role: "user" | "agris"; text: string }

export default function Agris({ reportId, r, onClose, mode, contact }: { reportId: string; r: Report; onClose: () => void; mode?: string; contact: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const conv = useRef<string | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { conv.current = undefined; setMsgs([]); }, [reportId]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ(""); setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: question }, { role: "agris", text: "" }]);
    try {
      for await (const ev of askAgris(reportId, question, conv.current)) {
        if (ev.type === "meta") conv.current = ev.conversationId;
        if (ev.type === "text") setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: "agris", text: c[c.length - 1].text + ev.text }; return c; });
      }
    } catch (e: any) {
      setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: "agris", text: `Sorry, I couldn't answer: ${e.message}` }; return c; });
    } finally { setBusy(false); }
  };

  return (
    <aside className="agris" aria-label="Agris assistant">
      <header>
        <div><b>Agris</b> <span className="muted small">about {r.location.place || "this field"} · {mode?.startsWith("claude") ? "Claude" : "built-in"}</span></div>
        <button onClick={onClose} aria-label="Close">✕</button>
      </header>
      <div className="msgs">
        {!msgs.length && (
          <div className="intro">
            <p>Ask anything about this field, in your own words and your own language. Every number comes from this field's report.</p>
            <div className="chips">{SUGGESTED.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text || (busy && i === msgs.length - 1 ? "…" : "")}</div>)}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Agris…" disabled={busy} />
        <button className="primary" disabled={busy || !q.trim()}>Send</button>
      </form>
      <div className="agris-help-footer">
        SenseGrass Agronomy · Inquiries: <a href={`mailto:${contact}`}>{contact}</a>
      </div>
    </aside>
  );
}
