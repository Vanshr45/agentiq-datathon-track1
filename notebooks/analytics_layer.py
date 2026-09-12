# builds data/analytics.duckdb from the cleaned files: base tables, join validation, metric views
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parent.parent
CLEANED = ROOT / "data" / "cleaned"
DB_PATH = ROOT / "data" / "analytics.duckdb"

# the *_id_conflicts files are loaded for audit only - nothing below joins against them
TABLES = {
    "transactions": "upi_transactions_clean.csv",
    "kyc": "kyc_records_clean.csv",
    "merchants": "merchants_master_clean.csv",
    "chargebacks": "chargebacks_clean.csv",
    "kyc_id_conflicts": "kyc_records_id_conflicts.csv",
    "merchants_id_conflicts": "merchants_master_id_conflicts.csv",
}

JOINS = [
    ("transactions", "user_id", "kyc"),
    ("transactions", "merchant_id", "merchants"),
    ("chargebacks", "txn_id", "transactions"),
    ("chargebacks", "user_id", "kyc"),
    ("chargebacks", "merchant_id", "merchants"),
]


def load_tables(con):
    for name, fname in TABLES.items():
        con.execute(f"create or replace table {name} as select * from read_csv('{CLEANED / fname}', header=true)")
        n = con.execute(f"select count(*) from {name}").fetchone()[0]
        print(f"{name:24s} {n:6d} rows")


def validate_joins(con):
    con.execute("create or replace table join_coverage (left_table varchar, key varchar, right_table varchar, left_rows bigint, matched_rows bigint, match_rate double)")
    print("\njoin coverage (share of left rows with a match on the right):")
    for left, key, right in JOINS:
        left_rows, matched = con.execute(f"""
            select count(*), count(r.{key})
            from {left} l left join (select distinct {key} from {right}) r using ({key})
        """).fetchone()
        rate = matched / left_rows
        con.execute("insert into join_coverage values (?, ?, ?, ?, ?, ?)", [left, key, right, left_rows, matched, rate])
        print(f"  {left:12s} -> {right:12s} on {key:12s} {matched:6d}/{left_rows:<6d} {rate:6.1%}")

    # the chargeback's own merchant/user fields never agree with the transaction its txn_id points to
    agree = con.execute("""
        select count(*), sum((c.merchant_id = t.merchant_id)::int), sum((c.user_id = t.user_id)::int),
               sum((abs(c.disputed_amount - t.amount) < 0.01)::int)
        from chargebacks c join transactions t using (txn_id)
    """).fetchone()
    print(f"\nFINDING: user/merchant coverage is low because most transaction ids simply do not exist in the master files. "
          f"Coverage is left as-is; no fuzzy matching of ids.")
    print(f"FINDING: of {agree[0]} chargebacks that link to a transaction via txn_id, {agree[1]} agree on merchant_id, "
          f"{agree[2]} on user_id and {agree[3]} on amount. The txn_id link is unreliable for attribution, so merchant- and "
          f"user-level chargeback metrics use the chargeback's own merchant_id / user_id.")


def create_views(con):
    # ---- transactions ---------------------------------------------------------------------------
    # no join. total_transaction_amount only counts successful, positive-amount transactions;
    # gross_amount_all_statuses is there for reference. rates use all rows as the denominator.
    con.execute("""
    create or replace view kpi_transactions as
    select
        count(*)                                                       as total_transaction_count,
        sum(case when status = 'SUCCESS' and amount > 0 then amount end) as total_transaction_amount,
        avg(case when status = 'SUCCESS' and amount > 0 then amount end) as avg_transaction_value,
        sum(amount)                                                    as gross_amount_all_statuses,
        sum((status = 'FAILED')::int)                                  as failed_txns,
        sum((status = 'PENDING')::int)                                 as pending_txns,
        sum((status = 'FAILED')::int)  * 1.0 / count(*)                as failed_transaction_rate,
        sum((status = 'PENDING')::int) * 1.0 / count(*)                as pending_transaction_rate,
        sum(is_negative_flag::int)                                     as negative_amount_txns,
        sum((not utr_valid)::int)                                      as missing_utr_txns
    from transactions
    """)

    # ---- chargebacks ----------------------------------------------------------------------------
    # chargeback_count includes rows with a missing disputed_amount (a complaint still happened);
    # chargeback_amount excludes them rather than treating them as zero. Negative disputed amounts
    # are also excluded from the sum but counted separately.
    con.execute("""
    create or replace view kpi_chargebacks as
    select
        count(*)                                                           as chargeback_count,
        sum(case when disputed_amount > 0 then disputed_amount end)        as chargeback_amount,
        sum(disputed_amount_missing::int)                                  as chargebacks_amount_missing,
        sum(disputed_amount_negative::int)                                 as chargebacks_amount_negative,
        sum((txn_id in (select txn_id from transactions))::int)            as chargebacks_linked_to_txn,
        count(*) * 1.0 / (select count(*) from transactions)               as chargeback_to_transaction_ratio
    from chargebacks
    """)

    # per-merchant ratio. FULL OUTER JOIN between the two aggregates so a merchant with chargebacks
    # but no transactions in the sample still shows up (ratio is NULL there, not zero or infinity).
    # LEFT JOIN to merchants master for name/category - unmatched merchants get category UNKNOWN.
    con.execute("""
    create or replace view chargeback_ratio_by_merchant as
    with t as (
        select merchant_id, count(*) as txn_count,
               sum(case when status = 'SUCCESS' and amount > 0 then amount end) as txn_amount
        from transactions group by 1
    ), c as (
        select merchant_id, count(*) as chargeback_count,
               sum(case when disputed_amount > 0 then disputed_amount end) as chargeback_amount
        from chargebacks group by 1
    )
    select
        coalesce(t.merchant_id, c.merchant_id)       as merchant_id,
        m.merchant_name,
        coalesce(m.merchant_category, 'UNKNOWN')     as merchant_category,
        m.merchant_status,
        m.merchant_id is not null                    as in_merchant_master,
        coalesce(t.txn_count, 0)                     as txn_count,
        t.txn_amount,
        coalesce(c.chargeback_count, 0)              as chargeback_count,
        c.chargeback_amount,
        c.chargeback_count * 1.0 / nullif(t.txn_count, 0) as chargeback_to_transaction_ratio
    from t full outer join c using (merchant_id)
    left join merchants m on m.merchant_id = coalesce(t.merchant_id, c.merchant_id)
    """)

    # category level: aggregate of the merchant view, so it inherits the same join choices.
    # only merchants found in the master have a category; the rest roll into UNKNOWN.
    con.execute("""
    create or replace view chargeback_ratio_by_category as
    select
        merchant_category,
        count(*)                                     as merchants,
        sum(txn_count)                               as txn_count,
        sum(chargeback_count)                        as chargeback_count,
        sum(chargeback_count) * 1.0 / nullif(sum(txn_count), 0) as chargeback_to_transaction_ratio
    from chargeback_ratio_by_merchant
    group by 1 order by 5 desc nulls last
    """)

    # dispute rate by category looks at money as well as counts, and at how widespread disputes are
    # (share of a category's merchants that have at least one chargeback)
    con.execute("""
    create or replace view dispute_rate_by_merchant_category as
    select
        merchant_category,
        sum(txn_count)                                              as txn_count,
        sum(chargeback_count)                                       as chargeback_count,
        sum(chargeback_count) * 1.0 / nullif(sum(txn_count), 0)     as dispute_rate_by_count,
        sum(chargeback_amount) / nullif(sum(txn_amount), 0)         as dispute_rate_by_amount,
        sum((chargeback_count > 0)::int) * 1.0 / count(*)           as share_of_merchants_disputed
    from chargeback_ratio_by_merchant
    group by 1 order by 4 desc nulls last
    """)

    # High-risk merchant rule: chargeback_count >= 5 AND ratio >= 2x the overall ratio (0.14 -> 0.28).
    # The count floor is the real filter here: the distribution is bimodal - no merchant has 5..12
    # chargebacks, then a separate cluster sits at 13..48. A pure ratio rule does not work on this
    # sample because most merchants have 1-3 transactions, so a single complaint already reads as 33-100%.
    # The ratio condition is kept so the rule still means something on a denser sample.
    con.execute("""
    create or replace view high_risk_merchants as
    with overall as (select chargeback_to_transaction_ratio as r from kpi_chargebacks)
    select r.*, round(r.chargeback_to_transaction_ratio / overall.r, 1) as ratio_vs_overall
    from chargeback_ratio_by_merchant r, overall
    where r.chargeback_count >= 5
      and (r.chargeback_to_transaction_ratio >= 2 * overall.r or r.txn_count = 0)
    order by r.chargeback_count desc
    """)

    # LEFT JOIN to kyc: a disputing user with no KYC record is still listed (kyc fields NULL) and
    # can only qualify through the 2+ chargebacks branch.
    con.execute("""
    create or replace view high_risk_users as
    with c as (
        select user_id, count(*) as chargeback_count,
               sum(case when disputed_amount > 0 then disputed_amount end) as disputed_amount,
               count(distinct merchant_id) as merchants_disputed
        from chargebacks group by 1
    )
    select
        c.user_id, c.chargeback_count, c.disputed_amount, c.merchants_disputed,
        k.kyc_status, k.risk_segment, k.pan_valid, k.aadhaar_valid,
        k.user_id is not null as in_kyc,
        case
            when c.chargeback_count >= 2 then 'repeat_disputer'
            when k.kyc_status = 'REJECTED' then 'kyc_rejected'
            else 'invalid_identity_docs'
        end as risk_reason
    from c left join kyc k using (user_id)
    where c.chargeback_count >= 2
       or (c.chargeback_count >= 1 and (k.kyc_status = 'REJECTED' or not k.pan_valid or not k.aadhaar_valid))
    order by c.chargeback_count desc, c.disputed_amount desc nulls last
    """)

    # ---- kyc ------------------------------------------------------------------------------------
    con.execute("""
    create or replace view kpi_kyc as
    select
        count(*)                                              as total_users,
        sum((kyc_status = 'VERIFIED')::int)                   as verified_users,
        sum((kyc_status = 'REJECTED')::int)                   as rejected_users,
        sum((kyc_status = 'PENDING')::int)                    as pending_users,
        sum((kyc_status = 'VERIFIED')::int) * 1.0 / count(*)  as kyc_completion_rate,
        sum((kyc_status = 'REJECTED')::int) * 1.0 / count(*)  as kyc_rejection_rate,
        sum((not pan_valid)::int) * 1.0 / count(*)            as invalid_pan_rate,
        sum((not aadhaar_valid)::int) * 1.0 / count(*)        as invalid_aadhaar_rate
    from kyc
    """)

    # ---- dispute delay --------------------------------------------------------------------------
    # uses the chargeback's own transaction_timestamp, not the linked transaction's (see FINDING above).
    # rows where the report predates the transaction are impossible and excluded from the averages.
    con.execute("""
    create or replace view dispute_reporting_delay as
    select complaint_id, user_id, merchant_id, severity, reason_category,
           transaction_timestamp, reported_timestamp,
           date_diff('day', transaction_timestamp, reported_timestamp) as delay_days
    from chargebacks
    where transaction_timestamp is not null and reported_timestamp is not null and not reported_before_txn
    """)
    con.execute("""
    create or replace view kpi_dispute_delay as
    select count(*)                        as chargebacks_with_both_timestamps,
           avg(delay_days)                 as avg_dispute_reporting_delay_days,
           median(delay_days)              as median_delay_days,
           sum((delay_days > 7)::int)      as reported_after_7_days,
           sum((delay_days > 7)::int) * 1.0 / count(*) as share_reported_after_7_days
    from dispute_reporting_delay
    """)

    # ---- category performance -------------------------------------------------------------------
    # INNER JOIN transactions -> merchants: category is only known for matched merchants, so this view
    # deliberately describes the ~48% of transactions with a master record. failed/pending rates are
    # transaction-side; chargeback figures come from the merchant view (chargeback's own merchant_id).
    con.execute("""
    create or replace view merchant_category_performance as
    with t as (
        select m.merchant_category,
               count(*)                                                as txn_count,
               count(distinct t.merchant_id)                           as active_merchants,
               sum(case when t.status = 'SUCCESS' and t.amount > 0 then t.amount end) as txn_amount,
               avg(case when t.status = 'SUCCESS' and t.amount > 0 then t.amount end) as avg_ticket,
               sum((t.status = 'FAILED')::int)  * 1.0 / count(*)      as failed_rate,
               sum((t.status = 'PENDING')::int) * 1.0 / count(*)      as pending_rate
        from transactions t join merchants m using (merchant_id)
        group by 1
    )
    select t.*, d.chargeback_count, d.dispute_rate_by_count, d.dispute_rate_by_amount, d.share_of_merchants_disputed
    from t join dispute_rate_by_merchant_category d using (merchant_category)
    order by txn_amount desc
    """)

    # ---- suspicious clusters --------------------------------------------------------------------
    # Rule: same user, 2+ transactions within 7 days of each other, amounts within 10%.
    # The stricter user+merchant / same-day / 3+ version returns nothing on this sample because no
    # user-merchant pair transacts more than once and no user has 3 transactions on one day.
    con.execute("""
    create or replace view suspicious_transaction_clusters as
    with seq as (
        select user_id, merchant_id, txn_id, "timestamp", amount, status,
               lag("timestamp") over w as prev_ts,
               lag(amount)      over w as prev_amount,
               lag(txn_id)      over w as prev_txn_id
        from transactions
        where amount > 0
        window w as (partition by user_id order by "timestamp")
    ), flagged as (
        select *
        from seq
        where prev_ts is not null
          and "timestamp" - prev_ts <= interval 7 day
          and abs(amount - prev_amount) / greatest(amount, prev_amount) <= 0.10
    ), members as (
        select user_id, txn_id from flagged
        union
        select user_id, prev_txn_id from flagged
    )
    select t.user_id, t.txn_id, t."timestamp", t.merchant_id, t.amount, t.status,
           count(*) over (partition by t.user_id) as cluster_size,
           date_diff('hour', min(t."timestamp") over (partition by t.user_id), max(t."timestamp") over (partition by t.user_id)) as cluster_span_hours
    from transactions t join members using (user_id, txn_id)
    order by t.user_id, t."timestamp"
    """)

    strict = con.execute("""
        select count(*) from (
            select user_id, merchant_id, "timestamp"::date as d, count(*) as n
            from transactions group by 1, 2, 3 having n >= 3)
    """).fetchone()[0]
    print(f"\nstrict cluster rule (user+merchant, same day, 3+ txns) matches {strict} groups; view uses the relaxed rule described in METRICS.md")


def main():
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = duckdb.connect(str(DB_PATH))
    load_tables(con)
    validate_joins(con)
    create_views(con)
    views = con.execute("select view_name from duckdb_views() where not internal order by 1").fetchall()
    print("\nviews:", ", ".join(v[0] for v in views))
    con.close()
    print(f"wrote {DB_PATH}")


if __name__ == "__main__":
    main()
