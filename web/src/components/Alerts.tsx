import { useCallback, useEffect, useState } from "react";
import { api, type AlertsState, type FieldAlert } from "../lib/api.ts";
import { useDateFormat, useT } from "../lib/i18n.tsx";
import Modal from "./Modal.tsx";

const ICON: Record<FieldAlert["kind"], string> = {
  frost_hard: "❄️", frost_light: "🌡️", heat: "🔥", heavy_rain: "🌧️", gusts: "💨", blight: "🦠", disease: "🍂", spray: "💧",
};

/** Alert text in the interface language, built from the alert's kind and numbers. */
export function useAlertText() {
  const t = useT();
  return (a: FieldAlert) => {
    const v = a.value != null ? Math.round(a.value) : "";
    switch (a.kind) {
      case "frost_hard": return t("Hard frost ({value} °C). Protect seedlings and flowering crops.", { value: v });
      case "frost_light": return t("Light frost possible ({value} °C).", { value: v });
      case "heat": return t("Heat: {value} °C. Avoid afternoon spraying; irrigate ahead if you can.", { value: v });
      case "heavy_rain": return t("Heavy rain: about {value} mm. Hold fertiliser and chemical applications.", { value: v });
      case "gusts": return t("Damaging gusts up to {value} km/h.", { value: v });
      case "blight": return t("Late-blight weather (Smith period). Protect potato and tomato.");
      case "disease": return t("Long leaf wetness on {value} days this week favours fungal disease. Scout your crops.", { value: v });
      case "spray": return t("Good spray window {from}–{to} (light wind, Delta T 2–8, no rain for 4 h).", { from: a.detail?.from ?? "", to: a.detail?.to ?? "" });
    }
  };
}

/** Bell in the top bar with the unread count; opens the alert inbox. Polls every 15 minutes. */
export default function AlertsBell({ fieldsCount, onOpenField }: { fieldsCount: number; onOpenField: (fieldId: string) => void }) {
  const t = useT(), fmt = useDateFormat(), text = useAlertText();
  const [state, setState] = useState<AlertsState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api.alerts().then(setState).catch(() => {}), []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 15 * 60_000);
    return () => clearInterval(timer);
  }, [load, fieldsCount]);

  const refresh = async () => {
    setBusy(true); setError("");
    try { setState(await api.refreshAlerts()); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const readAll = async () => { await api.readAlerts().catch(() => {}); load(); };
  const toggleEmail = async (on: boolean) => {
    try { const r = await api.alertSettings(on); setState((s) => s && { ...s, email: r.email }); } catch (e: any) { setError(e.message); }
  };

  const days = new Map<string, FieldAlert[]>();
  for (const a of state?.alerts ?? []) (days.get(a.day) ?? days.set(a.day, []).get(a.day)!).push(a);
  const unread = state?.unread ?? 0;

  return (
    <>
      <button className="bell" onClick={() => setOpen(true)} aria-label={t("Alerts ({n} new)", { n: unread })} title={t("Weather and spray alerts")}>
        🔔{unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <Modal title={t("Weather and spray alerts")} onClose={() => { setOpen(false); if (unread) readAll(); }}>
          <div className="alerts-panel">
            <div className="toolbar">
              <span className="muted small">{t("Frost, heat, heavy rain, wind, disease and spray windows for your saved fields over the next 7 days. Checked daily.")}</span>
              <span className="toolbar-gap" />
              <button disabled={busy || !fieldsCount} onClick={refresh}>{busy ? t("Checking…") : t("↻ Check now")}</button>
            </div>
            {state?.email.available && (
              <label className="switch-row">
                <input type="checkbox" checked={state.email.enabled} onChange={(e) => toggleEmail(e.target.checked)} />
                {t("Email me new frost, heat, rain and disease alerts")}
              </label>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            {!fieldsCount ? <p className="muted">{t("Save a field to get alerts for it.")}</p>
              : !state?.alerts.length ? <p className="muted">{t("No alerts for the coming week. Press “Check now” to scan the latest forecast.")}</p>
              : [...days.entries()].map(([day, list]) => (
                <section key={day} className="alert-day">
                  <h4>{fmt(day, { weekday: "long", day: "numeric", month: "short" })}</h4>
                  <ul>{list.map((a) => (
                    <li key={a.id} className={`alert ${a.level}${a.read ? "" : " unread"}`}>
                      <span className="icon" aria-hidden>{ICON[a.kind]}</span>
                      <div>
                        <button className="link field-link" onClick={() => { setOpen(false); onOpenField(a.fieldId); }}>{a.fieldName}</button>
                        <div>{text(a)}</div>
                      </div>
                    </li>
                  ))}</ul>
                </section>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}
