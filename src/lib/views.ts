// the 12 analytics views, verbatim from notebooks/analytics_layer.py, executed in the browser at load
export const VIEW_SQL: { name: string; sql: string }[] = [
  { name: "kpi_transactions", sql: `
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
` },
  { name: "kpi_chargebacks", sql: `
create or replace view kpi_chargebacks as
    select
        count(*)                                                           as chargeback_count,
        sum(case when disputed_amount > 0 then disputed_amount end)        as chargeback_amount,
        sum(disputed_amount_missing::int)                                  as chargebacks_amount_missing,
        sum(disputed_amount_negative::int)                                 as chargebacks_amount_negative,
        sum((txn_id in (select txn_id from transactions))::int)            as chargebacks_linked_to_txn,
        count(*) * 1.0 / (select count(*) from transactions)               as chargeback_to_transaction_ratio
    from chargebacks
` },
  { name: "chargeback_ratio_by_merchant", sql: `
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
` },
  { name: "chargeback_ratio_by_category", sql: `
create or replace view chargeback_ratio_by_category as
    select
        merchant_category,
        count(*)                                     as merchants,
        sum(txn_count)                               as txn_count,
        sum(chargeback_count)                        as chargeback_count,
        sum(chargeback_count) * 1.0 / nullif(sum(txn_count), 0) as chargeback_to_transaction_ratio
    from chargeback_ratio_by_merchant
    group by 1 order by 5 desc nulls last
` },
  { name: "dispute_rate_by_merchant_category", sql: `
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
` },
  { name: "high_risk_merchants", sql: `
create or replace view high_risk_merchants as
    with overall as (select chargeback_to_transaction_ratio as r from kpi_chargebacks)
    select r.*, round(r.chargeback_to_transaction_ratio / overall.r, 1) as ratio_vs_overall
    from chargeback_ratio_by_merchant r, overall
    where r.chargeback_count >= 5
      and (r.chargeback_to_transaction_ratio >= 2 * overall.r or r.txn_count = 0)
    order by r.chargeback_count desc
` },
  { name: "high_risk_users", sql: `
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
` },
  { name: "kpi_kyc", sql: `
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
` },
  { name: "dispute_reporting_delay", sql: `
create or replace view dispute_reporting_delay as
    select complaint_id, user_id, merchant_id, severity, reason_category,
           transaction_timestamp, reported_timestamp,
           date_diff('day', transaction_timestamp, reported_timestamp) as delay_days
    from chargebacks
    where transaction_timestamp is not null and reported_timestamp is not null and not reported_before_txn
` },
  { name: "kpi_dispute_delay", sql: `
create or replace view kpi_dispute_delay as
    select count(*)                        as chargebacks_with_both_timestamps,
           avg(delay_days)                 as avg_dispute_reporting_delay_days,
           median(delay_days)              as median_delay_days,
           sum((delay_days > 7)::int)      as reported_after_7_days,
           sum((delay_days > 7)::int) * 1.0 / count(*) as share_reported_after_7_days
    from dispute_reporting_delay
` },
  { name: "merchant_category_performance", sql: `
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
` },
  { name: "suspicious_transaction_clusters", sql: `
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
` },
];

export const BASE_TABLES = ["transactions", "kyc", "merchants", "chargebacks"] as const;

export const ALLOWED_TABLES = new Set([
  ...BASE_TABLES,
  "join_coverage",
  ...VIEW_SQL.map((v) => v.name),
]);

export const JOIN_COVERAGE_SQL = `
create or replace table join_coverage as
with v(left_table, key, right_table, left_rows, matched_rows) as (
  select 'transactions', 'user_id', 'kyc', count(*), count(k.user_id) from transactions t left join (select distinct user_id from kyc) k using (user_id)
  union all
  select 'transactions', 'merchant_id', 'merchants', count(*), count(m.merchant_id) from transactions t left join (select distinct merchant_id from merchants) m using (merchant_id)
  union all
  select 'chargebacks', 'txn_id', 'transactions', count(*), count(x.txn_id) from chargebacks c left join (select distinct txn_id from transactions) x using (txn_id)
  union all
  select 'chargebacks', 'user_id', 'kyc', count(*), count(k.user_id) from chargebacks c left join (select distinct user_id from kyc) k using (user_id)
  union all
  select 'chargebacks', 'merchant_id', 'merchants', count(*), count(m.merchant_id) from chargebacks c left join (select distinct merchant_id from merchants) m using (merchant_id)
)
select left_table, key, right_table, left_rows, matched_rows, matched_rows * 1.0 / left_rows as match_rate from v
`;
