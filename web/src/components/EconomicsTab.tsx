import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Report } from "../lib/api.ts";
import { money, PRICES_AS_OF, usePrices } from "../lib/economics.ts";
import { f } from "../lib/format.ts";
import { useT } from "../lib/i18n.tsx";

/** Gross margin per hectare for each crop: modelled yields × your price, minus your cost of cultivation. */
export default function EconomicsTab({ r, onFertiliser }: { r: Report; onFertiliser: (cropId: string) => void }) {
  const t = useT();
  const { prices, cropPrice, cropCost, update, setCrop, reset } = usePrices();
  const [irrigated, setIrrigated] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ price: "", cost: "" });
  const area: number | null = r.location.areaHa ?? null;
  const cur = prices.currency;

  const rows = useMemo(() => r.crops.filter((c: any) => c.score > 0 || c.irrigatedScore > 0).map((c: any) => {
    const price = cropPrice(c.id), cost = cropCost(c.id, c.group);
    const water = irrigated ? c.irrigationMm * prices.waterPerMm : 0;
    const y = irrigated ? { poor: c.irrigatedYieldTPerHa, median: c.irrigatedYieldTPerHa, good: c.irrigatedYieldTPerHa } : c.yieldTPerHa;
    const margin = (yld: number) => yld * price - cost - water;
    return {
      c, price, cost: cost + water, water, y,
      dry: margin(y.poor), typical: margin(y.median), good: margin(y.good),
      breakEven: price > 0 ? (cost + water) / price : null,
    };
  }).sort((a: any, b: any) => b.typical - a.typical), [r, irrigated, prices]); // cropPrice/cropCost only read `prices`
  const chart = rows.slice(0, 12).map((x: any) => ({ name: x.c.name, margin: Math.round(x.typical) }));

  const startEdit = (id: string, price: number, cost: number) => { setEditing(id); setDraft({ price: String(price), cost: String(cost) }); };
  const saveEdit = (id: string) => {
    const p = Number(draft.price), c = Number(draft.cost);
    setCrop(id, Number.isFinite(p) && p >= 0 ? p : null, Number.isFinite(c) && c >= 0 ? c : null);
    setEditing(null);
  };

  return (
    <div className="card wide">
      <div className="toolbar">
        <div className="seg" role="group" aria-label={t("Water supply")}>
          <button className={!irrigated ? "active" : ""} onClick={() => setIrrigated(false)}>{t("Rainfed")}</button>
          <button className={irrigated ? "active" : ""} onClick={() => setIrrigated(true)}>{t("Irrigated")}</button>
        </div>
        <label className="small">{t("Currency")} <input value={cur} maxLength={4} style={{ width: 56 }} onChange={(e) => update({ currency: e.target.value })} /></label>
        {irrigated && <label className="small">{t("Water cost per mm·ha")} <input inputMode="decimal" style={{ width: 70 }} value={prices.waterPerMm}
          onChange={(e) => update({ waterPerMm: Math.max(0, Number(e.target.value) || 0) })} /></label>}
        <span className="toolbar-gap" />
        <button className="link" onClick={() => confirm(t("Reset all prices and costs to the defaults?")) && reset()}>{t("Reset prices")}</button>
      </div>
      <p className="muted small">{t("Gross margin = modelled yield × price − cost of cultivation{water}. Yields are this field's dry (1 year in 5), typical and good (1 in 5) seasons. Prices default to Indian MSP / mandi rates and costs to typical paid-out costs per hectare: click a row's numbers to use your own.", { water: irrigated ? t(" − irrigation water") : "" })}</p>

      {chart.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 40 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: any) => [money(v, cur), t("Typical margin / ha")]} />
            <ReferenceLine y={0} stroke="var(--muted)" />
            <Bar dataKey="margin">{chart.map((d: any) => <Cell key={d.name} fill={d.margin >= 0 ? "var(--good)" : "var(--bad)"} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      <div className="table-scroll">
        <table className="ops econ">
          <thead><tr>
            <th>{t("Crop")}</th><th>{t("Yield t/ha")}<br /><span className="small">{irrigated ? t("irrigated") : t("dry · typical · good")}</span></th>
            <th>{t("Price / t")}</th><th>{t("Cost / ha")}</th>
            <th>{t("Margin / ha")}<br /><span className="small">{t("dry · typical · good")}</span></th>
            <th>{t("Break-even")}</th>{area ? <th>{t("Whole field ({ha} ha)", { ha: f(area, 1) })}</th> : null}<th></th>
          </tr></thead>
          <tbody>{rows.map((x: any) => (
            <tr key={x.c.id}>
              <td><b>{x.c.name}</b> <span className="muted small">{x.c.product}</span>
                {!irrigated && x.dry < 0 && x.typical > 0 && <div className="small" style={{ color: "var(--warn)" }}>{t("loses money in dry years")}</div>}</td>
              <td>{irrigated ? f(x.y.median) : `${f(x.y.poor)} · ${f(x.y.median)} · ${f(x.y.good)}`}</td>
              {editing === x.c.id ? (
                <>
                  <td><input aria-label={t("Price / t")} inputMode="decimal" style={{ width: 90 }} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></td>
                  <td><input aria-label={t("Cost / ha")} inputMode="decimal" style={{ width: 90 }} value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} /></td>
                </>
              ) : (
                <>
                  <td className="editable" onClick={() => startEdit(x.c.id, x.price, x.cost - x.water)} title={t("Edit")}>{money(x.price, cur)}{prices.crop[x.c.id] != null && " ✎"}</td>
                  <td className="editable" onClick={() => startEdit(x.c.id, x.price, x.cost - x.water)} title={t("Edit")}>{money(x.cost, cur)}{prices.cost[x.c.id] != null && " ✎"}
                    {irrigated && x.water > 0 && <div className="muted small">{t("incl. {money} water", { money: money(x.water, cur) })}</div>}</td>
                </>
              )}
              <td>{irrigated ? <b style={{ color: x.typical >= 0 ? "var(--good)" : "var(--bad)" }}>{money(x.typical, cur)}</b> : <>
                <span style={{ color: x.dry >= 0 ? undefined : "var(--bad)" }}>{money(x.dry, cur)}</span> · <b style={{ color: x.typical >= 0 ? "var(--good)" : "var(--bad)" }}>{money(x.typical, cur)}</b> · {money(x.good, cur)}
              </>}</td>
              <td>{x.breakEven != null ? `${f(x.breakEven, 2)} t/ha` : "–"}</td>
              {area ? <td>{money(x.typical * area, cur)}</td> : null}
              <td className="actions">
                {editing === x.c.id
                  ? <><button className="primary" onClick={() => saveEdit(x.c.id)}>{t("Save")}</button><button onClick={() => setEditing(null)}>{t("Cancel")}</button>
                    <button className="link" onClick={() => { setCrop(x.c.id, null, null); setEditing(null); }}>{t("Default")}</button></>
                  : <button onClick={() => onFertiliser(x.c.id)} title={t("Fertiliser plan for this crop")}>🧪</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="muted small">{t("Margins exclude land rent, your own labour and price swings. Use them to compare crops on this field, not as a forecast of profit.")}</p>
      <p className="muted small">{t("Default prices: Government of India {basis}; other crops are indicative mandi prices.", { basis: PRICES_AS_OF })}</p>
    </div>
  );
}
