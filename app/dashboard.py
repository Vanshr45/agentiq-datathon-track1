# executive dashboard for UPI fraud ring and merchant analytics (track 1)
import sys
from pathlib import Path

import duckdb
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "analytics.duckdb"

st.set_page_config(page_title="UPI Fraud & Merchant Analytics", layout="wide")

NO_KYC = "NO_KYC_RECORD"

# transactions and chargebacks enriched with the filter dimensions. LEFT JOINs everywhere so
# unmatched rows stay in and get an explicit UNKNOWN / NO_KYC_RECORD bucket.
TX_BASE = f"""
    select t.*, coalesce(m.merchant_category, 'UNKNOWN') as merchant_category,
           coalesce(k.kyc_status, '{NO_KYC}') as kyc_status, coalesce(k.risk_segment, '{NO_KYC}') as risk_segment
    from transactions t
    left join merchants m using (merchant_id)
    left join kyc k using (user_id)
"""
CB_BASE = f"""
    select c.*, coalesce(m.merchant_category, 'UNKNOWN') as merchant_category,
           coalesce(k.kyc_status, '{NO_KYC}') as kyc_status, coalesce(k.risk_segment, '{NO_KYC}') as risk_segment,
           coalesce(c.transaction_timestamp, c.reported_timestamp) as event_ts
    from chargebacks c
    left join merchants m using (merchant_id)
    left join kyc k using (user_id)
"""
FILTER = """
    where ({ts} is null or ({ts} >= ? and {ts} < ? + interval 1 day))
      and list_contains(?, merchant_category) and list_contains(?, kyc_status) and list_contains(?, risk_segment)
"""


@st.cache_resource
def connect():
    if not DB_PATH.exists():
        sys.path.insert(0, str(ROOT / "notebooks"))
        import analytics_layer
        analytics_layer.main()
    return duckdb.connect(str(DB_PATH), read_only=True)


@st.cache_data
def query(sql, params=()):
    return connect().execute(sql, list(params)).df()


def filtered(base, ts_col, f):
    sql = f"with base as ({base}) select * from base " + FILTER.format(ts=ts_col)
    return sql, [f["start"], f["end"], f["categories"], f["kyc"], f["risk"]]


# ---------------------------------------------------------------- sidebar filters
bounds = query("""
    select least(min(t.lo), min(c.lo)) as lo, greatest(max(t.hi), max(c.hi)) as hi
    from (select min("timestamp")::date as lo, max("timestamp")::date as hi from transactions) t,
         (select min(coalesce(transaction_timestamp, reported_timestamp))::date as lo,
                 max(coalesce(transaction_timestamp, reported_timestamp))::date as hi from chargebacks) c""").iloc[0]
categories = query("select distinct merchant_category from merchants order by 1").merchant_category.tolist() + ["UNKNOWN"]
kyc_statuses = ["VERIFIED", "PENDING", "REJECTED", NO_KYC]
risk_segments = ["LOW", "MEDIUM", "HIGH", "UNKNOWN", NO_KYC]

st.sidebar.header("Filters")
date_range = st.sidebar.date_input("Date range", (bounds.lo, bounds.hi), min_value=bounds.lo, max_value=bounds.hi)
if len(date_range) != 2:
    st.stop()
sel_cat = st.sidebar.multiselect("Merchant category", categories, default=categories)
sel_kyc = st.sidebar.multiselect("KYC status", kyc_statuses, default=kyc_statuses)
sel_risk = st.sidebar.multiselect("Risk segment", risk_segments, default=risk_segments)
st.sidebar.caption("UNKNOWN = merchant not in master. NO_KYC_RECORD = user not in KYC file.")

f = {"start": date_range[0], "end": date_range[1], "categories": sel_cat, "kyc": sel_kyc, "risk": sel_risk}
tx_sql, tx_params = filtered(TX_BASE, '"timestamp"', f)
cb_sql, cb_params = filtered(CB_BASE, "event_ts", f)

# ---------------------------------------------------------------- KPI cards
st.title("UPI Fraud Ring & Merchant Analytics")
st.caption("TransOrg AgentIQ Datathon, Track 1. Jan to Mar 2026 transaction sample.")

tx_kpi = query(f"""
    select count(*) as txns,
           sum(case when status = 'SUCCESS' and amount > 0 then amount end) as amount,
           avg(case when status = 'SUCCESS' and amount > 0 then amount end) as avg_value,
           sum((status = 'FAILED')::int) * 1.0 / nullif(count(*), 0) as failed_rate,
           sum((status = 'PENDING')::int) * 1.0 / nullif(count(*), 0) as pending_rate
    from ({tx_sql})""", tx_params).iloc[0]
cb_kpi = query(f"select count(*) as cbs, sum(case when disputed_amount > 0 then disputed_amount end) as amount, sum((event_ts is null)::int) as undated from ({cb_sql})", cb_params).iloc[0]
kyc_kpi = query("""
    select count(*) as users,
           sum((kyc_status = 'VERIFIED')::int) * 1.0 / nullif(count(*), 0) as completion,
           sum((kyc_status = 'REJECTED')::int) * 1.0 / nullif(count(*), 0) as rejection
    from kyc where list_contains(?, kyc_status) and list_contains(?, risk_segment)""", [sel_kyc, sel_risk]).iloc[0]

def money(v):
    if pd.isna(v):
        return "-"
    return f"Rs {v/1e7:.2f} Cr" if v >= 1e7 else f"Rs {v:,.0f}"

def pct(v):
    return "-" if pd.isna(v) else f"{v:.1%}"

ratio = cb_kpi.cbs / tx_kpi.txns if tx_kpi.txns else float("nan")

r1 = st.columns(4)
r1[0].metric("Total transactions", f"{int(tx_kpi.txns):,}")
r1[1].metric("Transaction amount (successful)", money(tx_kpi.amount))
r1[2].metric("Avg transaction value", money(tx_kpi.avg_value))
r1[3].metric("Chargeback-to-transaction ratio", f"{ratio:.3f}" if pd.notna(ratio) else "-",
             help="Chargebacks divided by transactions in the current filter. Chargebacks are attributed by the chargeback "
                  "file's own merchant_id / user_id, not by txn_id linkage - see Data Quality Notes.")
r2 = st.columns(4)
r2[0].metric("Failed transaction rate", pct(tx_kpi.failed_rate))
r2[1].metric("Pending transaction rate", pct(tx_kpi.pending_rate))
r2[2].metric("KYC completion rate", pct(kyc_kpi.completion), help="Verified users / all users in the KYC file matching the KYC and risk filters.")
r2[3].metric("KYC rejection rate", pct(kyc_kpi.rejection))
st.caption(f"{int(cb_kpi.cbs):,} chargebacks worth {money(cb_kpi.amount)} in the current filter ({int(cb_kpi.undated)} of them carry no "
           "timestamp and are always included). Ratio is based on the chargeback file's own merchant/user attribution, not txn_id linkage.")

# ---------------------------------------------------------------- trends
st.subheader("Transaction trends")

daily = query(f"""
    select "timestamp"::date as day, count(*) as txns,
           sum(case when status = 'SUCCESS' and amount > 0 then amount end) as amount,
           sum((status = 'FAILED')::int) as failed,
           sum((status = 'FAILED')::int) * 1.0 / count(*) as failed_rate
    from ({tx_sql}) group by 1 order by 1""", tx_params)

c1, c2 = st.columns(2)
if daily.empty:
    st.info("No transactions match the current filters.")
else:
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.08,
                        subplot_titles=("Daily transaction count", "Daily successful amount"))
    fig.add_trace(go.Scatter(x=daily.day, y=daily.txns, mode="lines", name="Transactions", line=dict(color="#2563eb")), row=1, col=1)
    fig.add_trace(go.Scatter(x=daily.day, y=daily.amount, mode="lines", name="Amount", line=dict(color="#0f766e")), row=2, col=1)
    fig.update_layout(height=420, margin=dict(l=10, r=10, t=40, b=10), showlegend=False)
    fig.update_yaxes(title_text="count", row=1, col=1)
    fig.update_yaxes(title_text="Rs", row=2, col=1)
    c1.plotly_chart(fig, width="stretch")

    fig2 = make_subplots(specs=[[{"secondary_y": True}]])
    fig2.add_trace(go.Bar(x=daily.day, y=daily.failed, name="Failed count", marker_color="#dc2626", opacity=0.7))
    fig2.add_trace(go.Scatter(x=daily.day, y=daily.failed_rate, name="Failed rate", mode="lines", line=dict(color="#7c2d12")), secondary_y=True)
    fig2.update_layout(title="Failed transactions by day", height=420, margin=dict(l=10, r=10, t=40, b=10),
                       legend=dict(orientation="h", y=-0.2))
    fig2.update_yaxes(title_text="count", secondary_y=False)
    fig2.update_yaxes(title_text="rate", tickformat=".0%", secondary_y=True)
    c2.plotly_chart(fig2, width="stretch")

st.subheader("Chargeback-to-transaction ratio by merchant category")
by_cat = query(f"""
    with t as (select merchant_category, count(*) as txns from ({tx_sql}) group by 1),
         c as (select merchant_category, count(*) as cbs from ({cb_sql}) group by 1)
    select coalesce(t.merchant_category, c.merchant_category) as merchant_category,
           coalesce(txns, 0) as txns, coalesce(cbs, 0) as cbs,
           cbs * 1.0 / nullif(txns, 0) as ratio
    from t full outer join c using (merchant_category)
    order by ratio desc nulls last""", tx_params + cb_params)
if not by_cat.empty:
    fig3 = px.bar(by_cat, x="merchant_category", y="ratio", text=by_cat.ratio.map(lambda v: f"{v:.3f}" if pd.notna(v) else ""),
                  hover_data={"txns": True, "cbs": True, "ratio": ":.3f"},
                  color=by_cat.merchant_category.eq("UNKNOWN").map({True: "not in master", False: "in master"}),
                  color_discrete_map={"in master": "#2563eb", "not in master": "#9ca3af"})
    fig3.update_layout(height=380, margin=dict(l=10, r=10, t=20, b=10), xaxis_title="", yaxis_title="chargebacks / transactions",
                       legend_title_text="")
    st.plotly_chart(fig3, width="stretch")
st.caption("Category ratios stay below 1 because they pool many merchants, but individual merchant ratios in the table below "
           "can exceed 1.0: the chargeback file records more complaints for some merchants than the 20,000-row transaction "
           "sample contains for them. Read them as a ranking signal, not as a percentage of transactions disputed.")

# ---------------------------------------------------------------- tables
st.subheader("High-risk merchants")
st.caption("Rule: 5+ chargebacks and a ratio at least 2x the overall rate. Filtered by merchant category.")
hrm = query("""
    select merchant_id, coalesce(merchant_name, 'not in master') as merchant_name, merchant_category,
           txn_count, chargeback_count, chargeback_amount, chargeback_to_transaction_ratio as ratio, merchant_status
    from high_risk_merchants where list_contains(?, merchant_category) order by chargeback_count desc""", [sel_cat])
st.dataframe(hrm, width="stretch", hide_index=True,
             column_config={"chargeback_amount": st.column_config.NumberColumn(format="%.0f"),
                            "ratio": st.column_config.NumberColumn(format="%.2f")})
st.caption(f"{len(hrm)} of 28 flagged merchants shown.")

st.subheader("High-risk users")
st.caption("2+ chargebacks, or 1+ with rejected KYC or invalid identity documents. Top 20 by chargeback count. Filtered by KYC status and risk segment.")
hru = query(f"""
    select user_id, chargeback_count, disputed_amount, merchants_disputed,
           coalesce(kyc_status, '{NO_KYC}') as kyc_status, coalesce(risk_segment, '{NO_KYC}') as risk_segment,
           pan_valid, aadhaar_valid, risk_reason
    from high_risk_users
    where list_contains(?, coalesce(kyc_status, '{NO_KYC}')) and list_contains(?, coalesce(risk_segment, '{NO_KYC}'))
    order by chargeback_count desc, disputed_amount desc nulls last limit 20""", [sel_kyc, sel_risk])
st.dataframe(hru, width="stretch", hide_index=True,
             column_config={"disputed_amount": st.column_config.NumberColumn(format="%.0f")})

st.subheader("Suspicious transaction clusters")
st.caption("Same user, 2+ transactions within 7 days with amounts within 10% of each other. Clusters spanning under 24 hours are highlighted. "
           "Filtered by date range (cluster start), KYC status and risk segment.")
clusters = query(f"""
    with c as (
        select s.user_id, count(*) as txns_in_cluster, min(s."timestamp") as first_txn, max(s.cluster_span_hours) as span_hours,
               sum(s.amount) as total_amount, string_agg(s.txn_id, ', ' order by s."timestamp") as txn_ids
        from suspicious_transaction_clusters s group by 1
    )
    select c.user_id, c.txns_in_cluster, c.span_hours, c.total_amount, c.first_txn, c.txn_ids,
           coalesce(k.kyc_status, '{NO_KYC}') as kyc_status, coalesce(k.risk_segment, '{NO_KYC}') as risk_segment
    from c left join kyc k using (user_id)
    where c.first_txn >= ? and c.first_txn < ? + interval 1 day
      and list_contains(?, coalesce(k.kyc_status, '{NO_KYC}')) and list_contains(?, coalesce(k.risk_segment, '{NO_KYC}'))
    order by c.span_hours, c.total_amount desc""", [f["start"], f["end"], sel_kyc, sel_risk])

def highlight_tight(row):
    style = "font-weight: bold; color: #b91c1c" if row.span_hours < 24 else ""
    return [style] * len(row)

if clusters.empty:
    st.info("No clusters in the current filter.")
else:
    st.dataframe(clusters.style.apply(highlight_tight, axis=1).format({"total_amount": "{:,.0f}", "first_txn": lambda v: v.strftime("%Y-%m-%d %H:%M")}),
                 width="stretch", hide_index=True)
    st.caption(f"{len(clusters)} clusters, {int(clusters.txns_in_cluster.sum())} transactions; {int((clusters.span_hours < 24).sum())} span under 24 hours.")

# ---------------------------------------------------------------- data quality notes
cov = query("select left_table, key, right_table, match_rate from join_coverage").set_index(["left_table", "right_table"]).match_rate
with st.expander("Data quality notes"):
    st.markdown(f"""
- Only **{cov[('transactions', 'kyc')]:.1%}** of transactions match a KYC record and **{cov[('transactions', 'merchants')]:.1%}** match a merchant record by id. The distinct id counts are identical before and after cleaning, so this is a property of the raw data, not a limitation of the cleaning. Unmatched rows are kept and shown as UNKNOWN / NO_KYC_RECORD rather than dropped.
- Chargebacks link to transactions via `txn_id` in name only ({cov[('chargebacks', 'transactions')]:.1%} of pointers resolve), but across every linked pair the pointer disagrees with the chargeback's own merchant, user and amount. This dashboard therefore attributes chargebacks using the chargeback record's own ids, which is also where the repeat-offender concentration shows up.
- Per-merchant chargeback ratios can exceed 1.0 where the chargeback file recorded more complaints for a merchant than the transaction sample includes for them. This is not a calculation error; the transaction file is a sample.
- Amounts exclude failed and pending transactions and the 420 negative (reversal-like) amounts; 179 chargebacks with a blank disputed amount are counted as complaints but excluded from amount totals.
""")
