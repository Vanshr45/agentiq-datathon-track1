"use client";
import { useMemo } from "react";
import Plot, { baseLayout, useChartColors } from "@/components/Plot";
import { Kpi, ClusterLabel, Section, Card } from "@/components/ui";
import { useQuery } from "@/lib/useQuery";
import { txSql, cbSql, useFilters } from "@/lib/filters";
import { money, num, pct, dayLabel } from "@/lib/format";
import { describeTrend } from "@/lib/trend";

const HIGH_RISK_MIN_CB = 5;

export default function Overview() {
  const { filters } = useFilters();
  const cc = useChartColors();
  const tx = txSql(filters), cb = cbSql(filters);
  const lit = (v: string[]) => v.map((x) => `'${x}'`).join(",") || "''";

  const kpi = useQuery(`
    select count(*) as txns,
           sum(case when status = 'SUCCESS' and amount > 0 then amount end) as amount,
           sum((status = 'SUCCESS')::int) as success,
           avg(case when status = 'SUCCESS' and amount > 0 then amount end) as avg_value,
           sum((status = 'FAILED')::int) as failed, sum((status = 'PENDING')::int) as pending,
           sum((status = 'FAILED')::int) * 1.0 / nullif(count(*), 0) as failed_rate,
           sum((status = 'PENDING')::int) * 1.0 / nullif(count(*), 0) as pending_rate
    from (${tx})`);
  const cbk = useQuery(`select count(*) as cbs, sum(case when disputed_amount > 0 then disputed_amount end) as amount, sum((event_ts is null)::int) as undated from (${cb})`);
  const kyc = useQuery(`
    select count(*) as users, sum((kyc_status = 'VERIFIED')::int) as verified, sum((kyc_status = 'REJECTED')::int) as rejected,
           sum((kyc_status = 'VERIFIED')::int) * 1.0 / nullif(count(*), 0) as completion,
           sum((kyc_status = 'REJECTED')::int) * 1.0 / nullif(count(*), 0) as rejection
    from kyc where kyc_status in (${lit(filters.kyc)}) and risk_segment in (${lit(filters.risk)})`);
  const hrm = useQuery(`select count(*) as n from high_risk_merchants where merchant_category in (${lit(filters.categories)})`);
  const overall = useQuery(`select chargeback_to_transaction_ratio as r from kpi_chargebacks`);
  const daily = useQuery(`
    select "timestamp"::date as day, count(*) as txns,
           sum(case when status = 'SUCCESS' and amount > 0 then amount end) as amount,
           sum((status = 'FAILED')::int) as failed, sum((status = 'FAILED')::int) * 1.0 / count(*) as failed_rate
    from (${tx}) group by 1 order by 1`);

  const k = kpi.rows?.[0] as Record<string, number> | undefined;
  const c = cbk.rows?.[0] as Record<string, number> | undefined;
  const y = kyc.rows?.[0] as Record<string, number> | undefined;
  const ratio = k && c && k.txns ? c.cbs / k.txns : NaN;
  const overallR = (overall.rows?.[0]?.r as number) ?? 0.14;

  const d = useMemo(() => {
    const rows = (daily.rows ?? []) as { day: number; txns: number; amount: number; failed: number; failed_rate: number }[];
    const days = rows.map((r) => new Date(r.day));
    const avgTx = rows.length ? rows.reduce((s, r) => s + r.txns, 0) / rows.length : 0;
    const avgRate = rows.length ? rows.reduce((s, r) => s + r.failed_rate, 0) / rows.length : 0;
    const peak = rows.reduce((p, r) => (r.failed_rate > (p?.failed_rate ?? -1) ? r : p), rows[0]);
    return { rows, days, avgTx, avgRate, peak };
  }, [daily.rows]);

  const oneIn = Number.isFinite(ratio) && ratio > 0 ? Math.round(1 / ratio) : null;

  return (
    <div>
      <ClusterLabel>Volume &amp; health</ClusterLabel>
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Total transactions" value={k ? num(k.txns) : "..."} note={k ? `${num(k.success)} succeeded, ${num(k.failed)} failed, ${num(k.pending)} still pending` : ""} />
        <Kpi label="Total value settled" value={k ? money(k.amount) : "..."} note={k ? `successful transactions only, averaging ${money(k.avg_value)} each` : ""} />
        <Kpi label="Failed transaction rate" value={k ? pct(k.failed_rate) : "..."} note={k ? `${num(k.failed)} of ${num(k.txns)} attempts did not go through, roughly 1 in ${k.failed ? Math.round(k.txns / k.failed) : "-"}` : ""} tone="red" />
        <Kpi label="KYC completion rate" value={y ? pct(y.completion) : "..."} note={y ? `${num(y.verified)} of ${num(y.users)} customers on file are verified` : ""} tone="green" />
      </div>
      <ClusterLabel>Risk &amp; compliance</ClusterLabel>
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Chargeback-to-transaction ratio" value={Number.isFinite(ratio) ? ratio.toFixed(3) : "..."}
          note={c && k ? `${num(c.cbs)} chargebacks against ${num(k.txns)} transactions${oneIn ? `, about 1 in ${oneIn} disputed` : ""}. Attributed by the chargeback's own merchant and user ids, not txn_id.` : ""} tone="red" />
        <Kpi label="Flagged high-risk merchants" value={hrm.rows ? num(hrm.rows[0].n as number) : "..."}
          note={`each has ${HIGH_RISK_MIN_CB}+ chargebacks and a ratio at least 2x the overall ${overallR.toFixed(2)}`} tone="red" />
        <Kpi label="KYC rejection rate" value={y ? pct(y.rejection) : "..."} note={y ? `${num(y.rejected)} customers on file were rejected at KYC, about 1 in ${y.rejected ? Math.round(y.users / y.rejected) : "-"}` : ""} tone="red" />
      </div>

      <Section title="Transaction trends">
        {d.rows.length === 0 ? (
          <Card>No transactions match the current filters.</Card>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <div className="font-semibold">Daily transaction volume and value</div>
              <div className="mb-2 text-sm text-muted">Daily transaction count {describeTrend(d.rows.map((r) => r.txns))}.</div>
              <div className="h-[380px]">
                <Plot
                  data={[
                    { x: d.days, y: d.rows.map((r) => r.txns), type: "scatter", mode: "lines", line: { color: cc.neutral }, name: "Transactions",
                      customdata: d.rows.map((r) => `${((r.txns - d.avgTx) / d.avgTx * 100).toFixed(0)}% vs the daily average of ${Math.round(d.avgTx)}`),
                      hovertemplate: "%{x|%d %b}: %{y:,} transactions<br>%{customdata}<extra></extra>", xaxis: "x", yaxis: "y" },
                    { x: d.days, y: d.rows.map((r) => r.amount), type: "scatter", mode: "lines", line: { color: cc.green }, name: "Amount",
                      customdata: d.rows.map((r) => `${r.txns.toLocaleString()} transactions that day`),
                      hovertemplate: "%{x|%d %b}: Rs %{y:,.0f}<br>%{customdata}<extra></extra>", xaxis: "x2", yaxis: "y2" },
                  ]}
                  layout={{ ...baseLayout, grid: { rows: 2, columns: 1, pattern: "independent", roworder: "top to bottom" }, showlegend: false, hovermode: "x",
                    yaxis: { title: { text: "count" } }, yaxis2: { title: { text: "Rs" } }, xaxis: { matches: "x2", showticklabels: false }, xaxis2: {},
                    annotations: [
                      { text: "Transactions per day", x: 0.5, y: 1.02, xref: "paper", yref: "paper", showarrow: false, font: { size: 12, color: cc.text } },
                      { text: "Successful value per day", x: 0.5, y: 0.44, xref: "paper", yref: "paper", showarrow: false, font: { size: 12, color: cc.text } },
                    ] }}
                />
              </div>
            </Card>
            <Card>
              <div className="font-semibold">Failed transactions by day</div>
              <div className="mb-2 text-sm text-muted">
                Failure rate averaged {pct(d.avgRate)} and {describeTrend(d.rows.map((r) => r.failed_rate))}; the worst day was {dayLabel(d.peak.day)} at {pct(d.peak.failed_rate)}.
              </div>
              <div className="h-[380px]">
                <Plot
                  data={[
                    { x: d.days, y: d.rows.map((r) => r.failed), type: "bar", marker: { color: cc.red }, opacity: 0.55, name: "Failed count",
                      customdata: d.rows.map((r) => `${r.failed} of ${r.txns} failed; period average is ${pct(d.avgRate)}`),
                      hovertemplate: "%{x|%d %b}: %{y} failed<br>%{customdata}<extra></extra>" },
                    { x: d.days, y: d.rows.map((r) => r.failed_rate), type: "scatter", mode: "lines", line: { color: cc.redDeep }, name: "Failed rate", yaxis: "y2",
                      hovertemplate: "%{x|%d %b}: %{y:.1%} failure rate<extra></extra>" },
                  ]}
                  layout={{ ...baseLayout, hovermode: "x", legend: { orientation: "h", y: -0.2 },
                    yaxis: { title: { text: "count" } }, yaxis2: { title: { text: "rate" }, overlaying: "y", side: "right", tickformat: ".0%" } }}
                />
              </div>
            </Card>
          </div>
        )}
      </Section>
    </div>
  );
}
