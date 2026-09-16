"use client";
import { Callout, Card, Section } from "@/components/ui";
import { useQuery } from "@/lib/useQuery";
import { num, pct } from "@/lib/format";

export default function DataQuality() {
  const cov = useQuery(`select left_table, key, right_table, left_rows, matched_rows, match_rate from join_coverage`);
  const agree = useQuery(`
    select count(*) as linked, sum((c.merchant_id = t.merchant_id)::int) as same_merchant, sum((c.user_id = t.user_id)::int) as same_user,
           sum((abs(c.disputed_amount - t.amount) < 0.01)::int) as same_amount,
           median(abs(date_diff('day', t."timestamp", c.transaction_timestamp))) as median_days_apart
    from chargebacks c join transactions t using (txn_id)`);
  const ids = useQuery(`
    select (select count(*) from kyc) as users, (select count(*) from merchants) as merchants,
           (select count(*) from high_risk_users) as hru,
           (select count(*) from high_risk_users where risk_reason = 'repeat_disputer') as rep,
           (select count(*) from high_risk_users where risk_reason = 'kyc_rejected') as rej,
           (select count(*) from high_risk_users where risk_reason = 'invalid_identity_docs') as docs`);

  const rows = (cov.rows ?? []) as { left_table: string; key: string; right_table: string; left_rows: number; matched_rows: number; match_rate: number }[];
  const rate = (l: string, r: string) => rows.find((x) => x.left_table === l && x.right_table === r)?.match_rate;
  const a = agree.rows?.[0] as Record<string, number> | undefined;
  const i = ids.rows?.[0] as Record<string, number> | undefined;

  return (
    <div>
      <Section title="What to know before trusting the numbers">
        <div className="grid grid-cols-3 gap-4">
          <Callout kind="info" title="Join coverage">
            Only <b>{pct(rate("transactions", "kyc"))}</b> of transactions could be matched to a KYC record, and <b>{pct(rate("transactions", "merchants"))}</b> to a
            merchant record. This reflects gaps in the raw sample, not a flaw in the cleaning: the number of distinct ids is identical before and after
            cleaning ({i ? num(i.users) : "..."} users, {i ? num(i.merchants) : "..."} merchants). Unmatched rows are kept and labelled UNKNOWN or NO_KYC_RECORD.
          </Callout>
          <Callout kind="info" title="Transaction id links are unreliable">
            Chargeback records link to a transaction id and {pct(rate("chargebacks", "transactions"))} of those pointers resolve, but the link does not agree with the
            chargeback's own merchant, user or amount in any of the {a ? num(a.linked) : "..."} cases checked ({a ? a.same_merchant : "..."} merchant matches,
            {" "}{a ? a.same_user : "..."} user matches, {a ? a.same_amount : "..."} amount matches; timestamps a median of {a ? Math.round(a.median_days_apart) : "..."} days apart).
            This dashboard attributes chargebacks using the chargeback record's own merchant and user ids instead.
          </Callout>
          <Callout kind="info" title="Duplicate ids and high-risk users">
            The same merchant or user id sometimes described two different entities. The most complete record per id was kept and the rest
            written to <span className="font-mono text-xs">*_id_conflicts.csv</span> rather than deleted, so no entity was lost.
            On the cleaned data <b>{i ? num(i.hru) : "..."}</b> users are flagged high-risk: {i ? i.rep : "..."} repeat disputers, {i ? i.rej : "..."} with rejected KYC
            and {i ? i.docs : "..."} with invalid identity documents.
          </Callout>
        </div>
      </Section>

      <Section title="Join coverage by key" sub="Share of rows in the left table that find a match in the right table, computed in the browser when the data loads.">
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr>
              {["Left table", "Key", "Right table", "Left rows", "Matched rows", "Match rate"].map((h, k) => (
                <th key={h} className={`px-3 py-2 text-xs font-medium text-slate-600 ${k >= 3 ? "text-right" : "text-left"}`}>{h}</th>))}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.left_table + r.right_table} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.left_table}</td><td className="px-3 py-2 font-mono text-xs">{r.key}</td><td className="px-3 py-2">{r.right_table}</td>
                  <td className="px-3 py-2 text-right">{num(r.left_rows)}</td><td className="px-3 py-2 text-right">{num(r.matched_rows)}</td>
                  <td className={`px-3 py-2 text-right ${r.match_rate < 0.5 ? "font-semibold text-red-700" : ""}`}>{pct(r.match_rate)}</td>
                </tr>))}
            </tbody>
          </table>
        </Card>
      </Section>
    </div>
  );
}
