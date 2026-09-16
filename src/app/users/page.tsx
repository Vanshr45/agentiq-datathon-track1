"use client";
import { Kpi, Card, Section } from "@/components/ui";
import { useQuery } from "@/lib/useQuery";
import { NO_KYC, useFilters } from "@/lib/filters";
import { num } from "@/lib/format";

type User = { user_id: string; chargeback_count: number; disputed_amount: number | null; merchants_disputed: number; kyc_status: string; risk_segment: string; pan_valid: boolean | null; aadhaar_valid: boolean | null; risk_reason: string };
type Cluster = { user_id: string; txns_in_cluster: number; span_hours: number; total_amount: number; first_txn: number; txn_ids: string; kyc_status: string; risk_segment: string };

const Flag = ({ v }: { v: boolean | null }) => v == null ? <span className="text-slate-500">-</span> : v ? <span className="text-green-700">valid</span> : <span className="font-medium text-red-700">invalid</span>;

export default function UserRisk() {
  const { filters } = useFilters();
  const lit = (v: string[]) => v.map((x) => `'${x}'`).join(",") || "''";
  // identity documents: only the validity flags are exposed, never pan or aadhaar values
  const users = useQuery(`
    select user_id, chargeback_count, disputed_amount, merchants_disputed,
           coalesce(kyc_status, '${NO_KYC}') as kyc_status, coalesce(risk_segment, '${NO_KYC}') as risk_segment,
           pan_valid, aadhaar_valid, risk_reason
    from high_risk_users
    where coalesce(kyc_status, '${NO_KYC}') in (${lit(filters.kyc)}) and coalesce(risk_segment, '${NO_KYC}') in (${lit(filters.risk)})
    order by chargeback_count desc, disputed_amount desc nulls last`);
  const clusters = useQuery(`
    with c as (
      select s.user_id, count(*) as txns_in_cluster, min(s."timestamp") as first_txn, max(s.cluster_span_hours) as span_hours,
             sum(s.amount) as total_amount, string_agg(s.txn_id, ', ' order by s."timestamp") as txn_ids
      from suspicious_transaction_clusters s group by 1)
    select c.*, coalesce(k.kyc_status, '${NO_KYC}') as kyc_status, coalesce(k.risk_segment, '${NO_KYC}') as risk_segment
    from c left join kyc k using (user_id)
    where c.first_txn >= '${filters.start}' and c.first_txn < date '${filters.end}' + interval 1 day
      and coalesce(k.kyc_status, '${NO_KYC}') in (${lit(filters.kyc)}) and coalesce(k.risk_segment, '${NO_KYC}') in (${lit(filters.risk)})
    order by c.span_hours, c.total_amount desc`);

  const all = (users.rows ?? []) as User[];
  const count = (r: string) => all.filter((u) => u.risk_reason === r).length;
  const cl = (clusters.rows ?? []) as Cluster[];

  return (
    <div>
      <div className="mt-6 grid grid-cols-4 gap-4">
        <Kpi label="Flagged high-risk users" value={users.rows ? num(all.length) : "..."} note="2+ chargebacks, or 1+ with rejected KYC or invalid identity documents" tone="red" />
        <Kpi label="Repeat disputers" value={users.rows ? num(count("repeat_disputer")) : "..."} note="two or more chargebacks on record" tone="red" />
        <Kpi label="Rejected KYC" value={users.rows ? num(count("kyc_rejected")) : "..."} note="at least one chargeback and a rejected KYC" tone="red" />
        <Kpi label="Invalid identity documents" value={users.rows ? num(count("invalid_identity_docs")) : "..."} note="at least one chargeback and an invalid PAN or Aadhaar" tone="red" />
      </div>

      <Section title="High-risk users" sub="Top 20 by chargeback count. Only validity flags are shown for identity documents, never the values. Filtered by KYC status and risk segment.">
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr>
              {["User", "Chargebacks", "Disputed amount", "Merchants disputed", "KYC status", "Risk segment", "PAN", "Aadhaar", "Reason"].map((h, i) => (
                <th key={h} className={`px-3 py-2 text-xs font-medium text-slate-600 ${i >= 1 && i <= 3 ? "text-right" : "text-left"}`}>{h}</th>))}
            </tr></thead>
            <tbody>
              {all.slice(0, 20).map((u) => (
                <tr key={u.user_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{u.user_id}</td>
                  <td className="px-3 py-2 text-right">{u.chargeback_count}</td>
                  <td className="px-3 py-2 text-right">{u.disputed_amount == null ? "-" : num(u.disputed_amount)}</td>
                  <td className="px-3 py-2 text-right">{u.merchants_disputed}</td>
                  <td className="px-3 py-2">{u.kyc_status}</td>
                  <td className="px-3 py-2">{u.risk_segment}</td>
                  <td className="px-3 py-2"><Flag v={u.pan_valid} /></td>
                  <td className="px-3 py-2"><Flag v={u.aadhaar_valid} /></td>
                  <td className="px-3 py-2 text-xs">{u.risk_reason}</td>
                </tr>))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Suspicious transaction clusters"
        sub="Same user, 2+ transactions within 7 days with amounts within 10% of each other. Clusters spanning under 24 hours are highlighted. Filtered by date range (cluster start), KYC status and risk segment.">
        {cl.length === 0 ? <Card>No clusters in the current filter.</Card> : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr>
                {["User", "Transactions", "Span (hours)", "Total amount", "First transaction", "Transaction ids", "KYC status", "Risk segment"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 text-xs font-medium text-slate-600 ${i >= 1 && i <= 3 ? "text-right" : "text-left"}`}>{h}</th>))}
              </tr></thead>
              <tbody>
                {cl.map((c) => (
                  <tr key={c.user_id} className={`border-t border-slate-100 ${c.span_hours < 24 ? "font-semibold text-red-700" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs">{c.user_id}</td>
                    <td className="px-3 py-2 text-right">{c.txns_in_cluster}</td>
                    <td className="px-3 py-2 text-right">{c.span_hours}</td>
                    <td className="px-3 py-2 text-right">{num(c.total_amount)}</td>
                    <td className="px-3 py-2">{new Date(c.first_txn).toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.txn_ids}</td>
                    <td className="px-3 py-2">{c.kyc_status}</td>
                    <td className="px-3 py-2">{c.risk_segment}</td>
                  </tr>))}
              </tbody>
            </table>
          </Card>)}
        <div className="mt-2 text-xs text-slate-500">{cl.length} clusters, {cl.reduce((s, c) => s + c.txns_in_cluster, 0)} transactions; {cl.filter((c) => c.span_hours < 24).length} span under 24 hours.</div>
      </Section>
    </div>
  );
}
