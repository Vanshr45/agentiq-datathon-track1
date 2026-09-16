// prompt text mirrored from agent/graph_agent.py
export const FINDINGS = `
Findings about this dataset that must shape every answer:
1. Chargebacks are attributed to merchants and users through the chargeback record's OWN merchant_id and user_id.
   The chargebacks.txn_id pointer resolves to a transaction 93% of the time but never agrees with the chargeback's
   own merchant, user or amount, so it is not used for attribution. Say this when a question touches chargeback
   attribution, merchant dispute counts or ratios.
2. Only 48% of transaction merchant_ids exist in the merchants master and only 32% of user_ids exist in kyc.
   A merchant with activity but no master record has merchant_name NULL / category 'UNKNOWN'. Never invent a
   name or category for it - say it has activity but no entry in the merchant master.
3. The transactions table is a 20,000-row sample. A merchant's chargeback_to_transaction_ratio can exceed 1.0
   because the chargeback file holds more complaints for that merchant than the sample holds transactions.
   That is sparse sampling, not an error, and must be said whenever a ratio above 1.0 is shown.
4. Amount totals use successful transactions with amount > 0. Negative amounts are flagged reversals.
   179 chargebacks have no disputed_amount and are excluded from amount sums but included in counts.
5. dispute_reporting_delay.delay_days = reported_timestamp - transaction_timestamp using the chargeback's own
   timestamps; rows where the report predates the transaction are already excluded.
`;

export const SQL_RULES = `
Write one DuckDB SELECT statement (a WITH clause is fine) against the tables and views listed. Rules:
- Read only. No DDL/DML, no file functions, no ATTACH.
- Prefer an existing view when it answers the question directly; otherwise query the base tables.
- Column names are case sensitive; quote "timestamp" (it is a keyword).
- For "which X has the highest ..." return the top 10 ordered descending so a bar chart can show the leader in context.
- Use a time axis (group by "timestamp"::date as day, order by day) only when the question asks for a trend,
  "over time", "by day" or "daily". Otherwise break the result down by a business dimension such as severity,
  reason_category, merchant_category, kyc_status or merchant.
- high_risk_users and high_risk_merchants are filtered subsets. For rankings such as "top users by disputed
  amount" aggregate the chargebacks table directly (group by user_id or merchant_id) so nothing is excluded.
- Amounts are Indian rupees.
- Always alias every output column with a short, plain name.
- Never return more than a few hundred rows.
Chart choice: line for anything over time, bar for comparing categories or ranking, scatter for a relationship
between two numeric variables. x is the column for the horizontal axis, y is the list of numeric columns to plot,
color is an optional column to split series by (use it for "compare A vs B by day" style questions with a long
format, or leave it empty and put both measures in y).
`;
