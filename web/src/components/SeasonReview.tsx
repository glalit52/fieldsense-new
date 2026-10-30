import { useEffect, useState } from "react";
import { api, type SavedField, type SeasonReview as Season } from "../lib/api.ts";
import { f } from "../lib/format.ts";
import { useDateFormat, useT } from "../lib/i18n.tsx";

const VERDICT_COLOR: Record<Season["verdict"], string> = { above: "var(--good)", "on par": "var(--ok)", below: "var(--bad)", "no model": "var(--muted)" };

/** Each logged harvest against what the model says that season's weather allowed, and why. */
export default function SeasonReview({ field }: { field: SavedField }) {
  const t = useT(), fmt = useDateFormat();
  const [data, setData] = useState<{ checkedAt: string | null; seasons: Season[]; message?: string } | null>(null);
  const [error, setError] = useState("");
  const harvests = field.activities.filter((a) => a.type === "harvest" && a.yieldTPerHa != null).length;
  useEffect(() => {
    if (!harvests) return;
    setError("");
    api.review(field.id).then(setData).catch((e) => setError(e.message));
  }, [field.id, field.updated, harvests]);

  if (!harvests) return <p className="muted small">{t("Log a harvest with its yield (t/ha) and FieldSense compares it with what the season's weather allowed, so you can see whether the weather or the field held you back.")}</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted small">{t("Loading…")}</p>;
  if (!data.checkedAt) return <p className="muted small">{t("Check this field once (open it and run the check) so there is a model to compare harvests with.")}</p>;

  return (
    <div className="season-review">
      <h4>{t("Season review")} <span className="muted small">{t("model from the check of {date}", { date: fmt(data.checkedAt, { day: "numeric", month: "short", year: "numeric" }) })}</span></h4>
      {data.seasons.map((s) => {
        const max = Math.max(s.actual, s.modelled ?? 0, s.typical ?? 0, s.good ?? 0, s.irrigated ?? 0, 0.1);
        const bar = (label: string, v: number | null, color: string) => v == null ? null : (
          <div className="yield-bar" key={label}>
            <span>{label}</span>
            <span className="track"><span style={{ width: `${(v / max) * 100}%`, background: color }} /></span>
            <b>{f(v, 1)}</b>
          </div>
        );
        return (
          <div key={s.harvestDate + s.crop} className="season card">
            <div className="season-head">
              <b>{s.crop}</b> <span className="muted small">{t("harvested {date}", { date: fmt(s.harvestDate, { day: "numeric", month: "short", year: "numeric" }) })}</span>
              <span className="pill" style={{ background: VERDICT_COLOR[s.verdict] }}>
                {s.verdict === "no model" ? t("no model") : `${t(s.verdict === "on par" ? "on par" : s.verdict === "above" ? "above model" : "below model")}${s.gapPct != null ? ` ${s.gapPct > 0 ? "+" : ""}${s.gapPct}%` : ""}`}
              </span>
            </div>
            {s.verdict !== "no model" && (
              <div className="yield-bars">
                {bar(t("Your harvest"), s.actual, "var(--series-1)")}
                {bar(t("This season (model)"), s.modelled, "var(--series-3)")}
                {bar(t("Typical year"), s.typical, "var(--line)")}
                {bar(t("Good year"), s.good, "var(--line)")}
                {bar(t("Irrigated"), s.irrigated, "var(--line)")}
                <span className="muted small">t/ha</span>
              </div>
            )}
            {s.weather && (
              <p className="small muted">{t("{year}: {rain} mm rain ({pct}% of normal), {hot} days ≥ 35 °C (normal {hotNormal}), longest dry spell {dry} days.", {
                year: s.weather.year, rain: s.weather.rain, pct: s.weather.rainPct, hot: s.weather.hotDays, hotNormal: s.weather.hotDaysNormal, dry: s.weather.longestDrySpell,
              })}</p>
            )}
            <ul className="reasons">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        );
      })}
    </div>
  );
}
