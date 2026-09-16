"use client";
import { useMemo, useState } from "react";
import Plot, { baseLayout, NEUTRAL, LIGHT } from "@/components/Plot";
import { Callout, Card, Section } from "@/components/ui";
import { useQuery } from "@/lib/useQuery";
import { txSql, cbSql, useFilters } from "@/lib/filters";
import { num } from "@/lib/format";

const HIGH_RISK_MIN_CB = 5;
type Merchant = { merchant_id: string; merchant_name: string | null; merchant_category: string; txn_count: number; chargeback_count: number; chargeback_amount: number | null; ratio: number | null; merchant_status: string | null };
type SortKey = keyof Merchant;

export default function MerchantRisk() {
  const { filters } = useFilters();
  const lit = filters.categories.map((c) => `'${c}'`).join(",") || "''";
  const overall = useQuery(`select chargeback_to_transaction_ratio as r from kpi_chargebacks`);
  const overallR = (overall.rows?.[0]?.r as number) ?? 0.14;
  const threshold = 2 * overallR;

  const byCat = useQuery(`
    with t as (select merchant_category, count(*) as txns from (${txSql(filters)}) group by 1),
         c as (select merchant_category, count(*) as cbs from (${cbSql(filters)}) group by 1)
    select coalesce(t.merchant_category, c.merchant_category) as merchant_category,
           coalesce(txns, 0) as txns, coalesce(cbs, 0) as cbs, cbs * 1.0 / nullif(txns, 0) as ratio
    from t full outer join c using (merchant_category) order by ratio desc nulls last`);

  const hrm = useQuery(`
    select merchant_id, merchant_name, merchant_category, txn_count, chargeback_count, chargeback_amount,
           chargeback_to_transaction_ratio as ratio, merchant_status
    from high_risk_merchants where merchant_category in (${lit}) order by chargeback_count desc`);

  // chargebacks per merchant across every merchant seen in either file - this is the threshold evidence
  const dist = useQuery(`
    with m as (
      select coalesce(t.merchant_id, c.merchant_id) as merchant_id, coalesce(c.cbs, 0) as cbs
      from (select merchant_id, count(*) as txns from transactions group by 1) t
      full outer join (select merchant_id, count(*) as cbs from chargebacks group by 1) c using (merchant_id))
    select case when cbs <= 4 then cbs::varchar when cbs <= 12 then '5-12' else '13+' end as bucket,
           min(cbs) as lo, count(*) as merchants
    from m group by 1 order by lo`);

  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "chargeback_count", dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => {
    const r = [...((hrm.rows ?? []) as Merchant[])];
    r.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
    return r;
  }, [hrm.rows, sort]);
  const shown = showAll ? rows : rows.slice(0, 10);
  const th = (key: SortKey, label: string, right = false) => (
    <th onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : -1 })}
      className={`cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-600 ${right ? "text-right" : "text-left"}`}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  const cats = (byCat.rows ?? []) as { merchant_category: string; txns: number; cbs: number; ratio: number | null }[];
  const known = cats.filter((c) => c.merchant_category !== "UNKNOWN" && c.ratio != null);
  const title = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  const buckets = (dist.rows ?? []) as { bucket: string; merchants: number }[];
  const order = ["0", "1", "2", "3", "4", "5-12", "13+"];
  const distRows = order.map((b) => ({ bucket: b, merchants: buckets.find((x) => x.bucket === b)?.merchants ?? 0 }));

  return (
    <div>
      <Section title="Chargeback-to-transaction ratio by merchant category"
        sub={known.length >= 2 ? `${title(known[0].merchant_category)} has the highest dispute ratio (${known[0].ratio!.toFixed(3)}) and ${title(known[known.length - 1].merchant_category)} the lowest (${known[known.length - 1].ratio!.toFixed(3)}), a ${(known[0].ratio! / known[known.length - 1].ratio!).toFixed(1)}x spread across known categories.` : undefined}>
        <Card><div className="h-[380px]">
          <Plot data={[{ x: cats.map((c) => c.merchant_category), y: cats.map((c) => c.ratio), type: "bar",
              marker: { color: cats.map((c) => (c.merchant_category === "UNKNOWN" ? LIGHT : NEUTRAL)) },
              text: cats.map((c) => (c.ratio == null ? "" : c.ratio.toFixed(3))), textposition: "outside",
              customdata: cats.map((c) => `${num(c.cbs)} chargebacks against ${num(c.txns)} transactions`),
              hovertemplate: "%{x}: ratio %{y:.3f}<br>%{customdata}<extra></extra>" }]}
            layout={{ ...baseLayout, margin: { ...baseLayout.margin, b: 110 }, yaxis: { title: { text: "chargebacks / transactions" } }, xaxis: { tickangle: -30 } }} />
        </div></Card>
      </Section>

      <Section title="Why the threshold is 5 chargebacks"
        sub="Merchants counted by number of chargebacks (both files pooled). The 5 to 12 band is empty: the ordinary population stops at 4 and a separate cluster starts at 13.">
        <Card><div className="h-[300px]">
          <Plot data={[{ x: distRows.map((r) => r.bucket), y: distRows.map((r) => r.merchants), type: "bar",
              marker: { color: distRows.map((r) => (r.bucket === "13+" ? "#dc2626" : r.bucket === "5-12" ? LIGHT : NEUTRAL)) },
              text: distRows.map((r) => num(r.merchants)), textposition: "outside", hovertemplate: "%{x} chargebacks: %{y} merchants<extra></extra>" }]}
            layout={{ ...baseLayout, xaxis: { title: { text: "chargebacks per merchant" }, type: "category" }, yaxis: { title: { text: "merchants" }, type: "log" } }} />
        </div>
        <div className="mt-1 text-xs text-slate-500">Log scale. Any floor from 5 to 13 selects the same 28 merchants.</div></Card>
      </Section>

      <Section title="High-risk merchant ledger"
        sub={`Rule: ${HIGH_RISK_MIN_CB}+ chargebacks and a ratio at least 2x the overall rate of ${overallR.toFixed(2)}. Filtered by merchant category.`}>
        <Callout title="Reading the ratio column">
          A dispute ratio above 1.0 means the chargeback file recorded more disputes for that merchant than this transaction
          sample includes - not a calculation error. This happens for merchants with sparse sample coverage.
        </Callout>
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>{th("merchant_name", "Merchant")}{th("merchant_category", "Category")}{th("txn_count", "Sample transactions", true)}
                {th("chargeback_count", "Chargebacks", true)}{th("chargeback_amount", "Disputed amount", true)}{th("ratio", "Ratio", true)}</tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.merchant_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{m.merchant_name ?? <span className="text-slate-500">Not in merchant master ({m.merchant_id})</span>}</td>
                  <td className="px-3 py-2">{m.merchant_category}</td>
                  <td className="px-3 py-2 text-right">{m.txn_count}</td>
                  <td className="px-3 py-2 text-right">{m.chargeback_count}</td>
                  <td className="px-3 py-2 text-right">{m.chargeback_amount == null ? "-" : num(m.chargeback_amount)}</td>
                  <td className={`px-3 py-2 text-right ${m.ratio != null && m.ratio >= threshold ? "font-semibold text-red-700" : ""}`}>{m.ratio == null ? "n/a" : m.ratio.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
          {shown.length < rows.length
            ? <>Showing top {shown.length} of {rows.length} flagged merchants — <button className="underline" onClick={() => setShowAll(true)}>view all</button></>
            : <>Showing all {rows.length} flagged merchants{rows.length !== 28 ? " in the selected categories (28 in total)" : ""}.{rows.length > 10 && <button className="underline" onClick={() => setShowAll(false)}>show top 10</button>}</>}
          {rows.some((m) => m.txn_count === 0) && <span>Ratio shows n/a where the merchant has chargebacks but no transactions in this sample.</span>}
        </div>
      </Section>
    </div>
  );
}
