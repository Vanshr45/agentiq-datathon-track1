# Metrics

How each number in the analytics layer is computed, and the decisions behind it. Everything below lives as a
DuckDB view in `pipeline/data/analytics.duckdb`, built by `pipeline/notebooks/analytics_layer.py` from the Stage 1 cleaned files.
Re-run the script to rebuild the database from scratch.

## Two things to know before reading any metric

**Most transactions cannot be joined to a customer or a merchant.** Only 32.4% of transaction `user_id`s exist in
the KYC file and 48.2% of `merchant_id`s exist in the merchant master. The same holds for chargebacks (31.6% and
46.4%). This is not a cleaning artefact: the number of distinct ids in the raw files is identical before and after
cleaning, so the ids are simply absent. I did not try to fuzzy-match ids to close the gap. Where a metric needs a
merchant attribute (name, category), unmatched merchants show up as `UNKNOWN` rather than being dropped, and the
metric says so.

**The chargeback `txn_id` link does not agree with the chargeback's own fields.** 93.1% of chargebacks point at a
`txn_id` that exists in the transactions table, which looks good until you compare the two rows: across all 2,607
linked pairs, zero agree on `merchant_id`, zero on `user_id`, and zero on amount. The chargeback's own
`transaction_timestamp` is also unrelated to the linked transaction's timestamp (median 26 days apart). Meanwhile
the chargeback's own `merchant_id` / `user_id` columns carry an obvious signal: a handful of merchants with 13 to 48
complaints each and users with 11 to 14 complaints, which is exactly the kind of concentration a fraud-ring dataset
would plant. So every merchant-level and user-level chargeback metric uses the chargeback's own `merchant_id` and
`user_id`. The `txn_id` link is only used to report how many chargebacks reference a known transaction.

The `*_id_conflicts.csv` files from Stage 1 are loaded into the database as `kyc_id_conflicts` and
`merchants_id_conflicts` for audit, but no view joins against them. They are the non-canonical records.

## Transaction metrics (`kpi_transactions`)

No joins here, every row of the cleaned transactions table counts.

`total_transaction_count` is the number of rows after Stage 1 dedup: 20,000.

`total_transaction_amount` is the sum of `amount` over transactions with `status = 'SUCCESS'` and a positive
amount. Failed and pending transactions did not move money, and the 420 negative amounts are flagged reversals
rather than revenue, so neither belongs in a headline number. `gross_amount_all_statuses` (the plain sum over every
row, negatives included) is kept next to it for anyone who wants the raw figure.

`avg_transaction_value` is the mean over the same successful, positive-amount population.

`failed_transaction_rate` is failed transactions divided by all transactions (1,955 / 20,000 = 9.8%).
`pending_transaction_rate` is the same with pending (992 / 20,000 = 5.0%). The denominator is all rows, not just
successful ones, because the question is "what share of attempts did not complete".

## Chargeback metrics (`kpi_chargebacks`)

`chargeback_count` is every row in the cleaned chargebacks table: 2,800. This includes the 179 complaints with a
blank `disputed_amount`, because a complaint was still raised even if the amount was not recorded.

`chargeback_amount` is the sum of `disputed_amount` where the amount is present and positive. The 179 missing
amounts are excluded rather than treated as zero (a zero would silently pull the average down), and the 220
negative amounts are excluded as well. Both counts are reported alongside so the exclusion is visible.

`chargeback_to_transaction_ratio` overall is 2,800 / 20,000 = 0.14. It is a ratio of counts, not of money.

## Chargeback ratio by merchant (`chargeback_ratio_by_merchant`)

Two aggregates are built first: transactions per `merchant_id` and chargebacks per `merchant_id`. They are combined
with a FULL OUTER JOIN so that a merchant with complaints but no transactions in the sample still appears (there
is one such merchant with 32 complaints). Its ratio is NULL rather than infinite or zero. The result is then
LEFT JOINed to the merchant master for name, category and status, and merchants that are not in the master get
`merchant_category = 'UNKNOWN'` with `in_merchant_master = false`.

`chargeback_to_transaction_ratio` per merchant is `chargeback_count / txn_count`. On this sample the ratio is
frequently above 1, which reads strangely until you remember the transactions file is a 20,000-row sample: a
merchant can easily have more complaints in the chargeback file than transactions in the sample. The ratio is still
the right shape for ranking, but should not be quoted as "1,400% of transactions were disputed".

`chargeback_ratio_by_category` is the same view aggregated by `merchant_category`, so the UNKNOWN bucket is the
roll-up of every merchant not in the master. Among known categories, restaurants (19.6%) and apparel (17.6%) sit
at the top and grocery (9.2%) at the bottom.

## Dispute rate by merchant category (`dispute_rate_by_merchant_category`)

Built on the merchant view above, so it inherits the same join choices. It reports three angles per category:
`dispute_rate_by_count` (chargebacks / transactions), `dispute_rate_by_amount` (disputed amount / successful
transaction amount), and `share_of_merchants_disputed` (fraction of the category's merchants with at least one
chargeback). The count-based rate is the one that matches `chargeback_to_transaction_ratio`; the amount-based rate
is lower everywhere (2 to 5%) because disputed amounts are on average smaller than transaction amounts.

## High-risk merchants (`high_risk_merchants`)

**Rule: `chargeback_count >= 5` and `chargeback_to_transaction_ratio >= 2 x overall ratio` (i.e. >= 0.28).**
A merchant with chargebacks but zero transactions in the sample also qualifies, since the ratio is undefined
rather than low.

The count floor is what actually does the work. The distribution of chargebacks per merchant is bimodal: 8,207
merchants have between 0 and 4, then there is nothing at all between 5 and 12, and then a separate cluster of 28
merchants sits at 13 to 48 complaints. Any floor from 5 to 13 selects the same 28 merchants, so the choice is not
sensitive. I picked 5 because it is the lowest value that clears the bulk of ordinary merchants and would still be
a reasonable "repeat offender" line on a dataset without such a clean gap.

A pure ratio threshold (top decile, or 2x category average) does not work here. The median merchant has 2
transactions in the sample, so a single complaint already reads as a 50% ratio and the 90th percentile of the ratio
is 1.0. The ratio condition is kept in the rule so that it still means something on a denser sample, but on this
one it is redundant: all 28 merchants selected by the count floor have ratios between 4x and 214x the overall rate.

Of the 28 flagged merchants, 13 are in the merchant master and 15 are not (category UNKNOWN). Flagging does not
require a master record.

## High-risk users (`high_risk_users`)

Chargebacks are grouped by the chargeback's own `user_id`, then LEFT JOINed to KYC. A user qualifies if they have
2 or more chargebacks, or 1 or more combined with `kyc_status = 'REJECTED'`, `pan_valid = false` or
`aadhaar_valid = false`. The LEFT JOIN matters: a user with no KYC record (about two thirds of disputing users)
can still be flagged through the repeat-dispute branch, but cannot be flagged through the identity branch because
there is nothing to check. `risk_reason` records which branch fired, with repeat disputes taking precedence.

This yields 381 users: 125 repeat disputers (39 of them with a KYC record), 48 with rejected KYC and 208 with
invalid identity documents. The top of the list is dominated by users with 11 to 14 complaints spread across as
many different merchants, which is another planted pattern worth calling out on the dashboard.

## KYC metrics (`kpi_kyc`)

`kyc_completion_rate` is users with `kyc_status = 'VERIFIED'` divided by all users in the cleaned KYC table
(22,380 / 28,920 = 77.4%). `kyc_rejection_rate` is rejected / all users (2,356 / 28,920 = 8.1%). Pending users
make up the remaining 14.5%. The denominator is the KYC table, not transacting users, because the question is
about the customer base as a whole. `invalid_pan_rate` and `invalid_aadhaar_rate` are the Stage 1 validity flags
expressed as shares; note that `aadhaar_valid = false` includes the 2,322 records that arrived already masked,
which cannot be verified either way.

## Dispute reporting delay (`dispute_reporting_delay`, `kpi_dispute_delay`)

`delay_days` is `reported_timestamp - transaction_timestamp` in whole days, using the chargeback's own
transaction timestamp for the reason given at the top. Rows missing either timestamp are excluded, as are the 92
rows where the report predates the transaction (flagged `reported_before_txn` in Stage 1), which is impossible
rather than a zero-day delay. That leaves 2,296 chargebacks.

`avg_dispute_reporting_delay_days` is 6.8 days and the median is 3, so the mean is pulled up by a long tail:
24.1% of disputes are reported more than 7 days after the transaction (`share_reported_after_7_days`). The
per-row view keeps severity and reason category so the delay can be sliced on the dashboard.

## Merchant category performance (`merchant_category_performance`)

This is the one view built on an INNER JOIN between transactions and the merchant master, because a category only
exists for matched merchants. It therefore describes the 9,631 transactions (48.2%) with a master record, not all
20,000. Per category it gives transaction count, active merchants, successful amount, average ticket, failed and
pending rates, and then pulls in the chargeback figures from `dispute_rate_by_merchant_category` (which use the
chargeback's own merchant id, as everywhere else).

Categories are remarkably flat on the transaction side (average ticket 12.3k to 12.8k, failure rate 8 to 11%),
and separate mainly on disputes: restaurants have the highest dispute rate by both count and amount and the
highest share of merchants with a complaint, grocery the lowest.

## Suspicious transaction clusters (`suspicious_transaction_clusters`)

**Rule used: same `user_id`, two or more transactions within 7 days of each other, consecutive amounts within 10%
of each other.** Implemented with a `lag()` window over each user's transactions ordered by time; a transaction
joins a cluster if it or its predecessor satisfies the gap and amount conditions. The view lists every member
transaction with `cluster_size` and `cluster_span_hours`.

The brief asked for user + merchant, same day, 3 or more. That rule returns nothing on this data, and it is worth
being precise about why: the transactions file has 20,000 rows spread over 17,878 users and 8,051 merchants across
90 days. No user-merchant pair transacts more than once, no user has 3 transactions on the same day, and only 2
merchants have 3 transactions on any single day. The data is simply too thin for a burst rule at that granularity.
Relaxing to a 7-day window and 2+ transactions on the user side is the loosest rule that still expresses the same
idea (repeated, similarly-sized payments in a short period) and returns 25 users / 50 transactions. The script
prints the strict rule's match count (0) every time it runs so this stays visible.

## Join types at a glance

INNER JOIN: `merchant_category_performance` (transactions to merchants).
LEFT JOIN: `chargeback_ratio_by_merchant` (to merchant master), `high_risk_users` (to KYC).
FULL OUTER JOIN: `chargeback_ratio_by_merchant` (transaction aggregate to chargeback aggregate).
No join: `kpi_transactions`, `kpi_chargebacks`, `kpi_kyc`, `dispute_reporting_delay`, `suspicious_transaction_clusters`.
