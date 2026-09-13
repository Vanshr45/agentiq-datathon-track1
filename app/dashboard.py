# executive dashboard for UPI fraud ring and merchant analytics (track 1)
import sys
from pathlib import Path

import duckdb
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "analytics.duckdb"
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT / "agent"))
from graph_agent import GraphAgent, AgentError, build_chart
NO_KYC = "NO_KYC_RECORD"
HIGH_RISK_MIN_CB = 5

st.set_page_config(page_title="UPI Fraud & Merchant Analytics", layout="wide", initial_sidebar_state="expanded")

# three accent colours only: neutral for information, red for risk, green for healthy
st.markdown("""
<style>
.kpi-cluster { font-size: 0.8rem; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; margin: 1.2rem 0 .4rem; }
.kpi { border: 1px solid #e5e7eb; border-left: 5px solid #64748b; border-radius: 8px; padding: .9rem 1rem; background: #fff; min-height: 118px; }
.kpi.red { border-left-color: #dc2626; }
.kpi.green { border-left-color: #16a34a; }
.kpi .label { font-size: .8rem; color: #6b7280; }
.kpi .value { font-size: 1.9rem; font-weight: 600; line-height: 1.2; margin: .15rem 0; color: #111827; }
.kpi .note { font-size: .78rem; color: #4b5563; }
.callout { border-radius: 8px; padding: .8rem 1rem; margin: .6rem 0 1rem; font-size: .9rem; line-height: 1.45; }
.callout.warn { background: #fef2f2; border: 1px solid #fecaca; color: #7f1d1d; }
.callout.info { background: #f8fafc; border: 1px solid #e2e8f0; color: #1e293b; min-height: 150px; }
.callout .title { font-weight: 600; margin-bottom: .3rem; }
.subtitle { color: #6b7280; margin-top: -.6rem; }
.chart-sub { color: #4b5563; font-size: .88rem; margin: -.2rem 0 .4rem; }
.ask-q { font-weight: 600; color: #111827; margin-bottom: .2rem; }
.ask-meta { font-size: .78rem; color: #6b7280; margin-bottom: .4rem; }
.ask-summary { border-left: 4px solid #64748b; background: #f8fafc; padding: .6rem .9rem; border-radius: 6px; font-size: .92rem; }
.ask-note { border-left: 4px solid #dc2626; background: #fef2f2; padding: .5rem .9rem; border-radius: 6px; font-size: .82rem; color: #7f1d1d; margin-top: .4rem; }
</style>
""", unsafe_allow_html=True)

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
# undated chargebacks are always kept - there is no date to exclude them on
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


def money(v):
    if pd.isna(v):
        return "-"
    return f"Rs {v/1e7:.2f} Cr" if v >= 1e7 else f"Rs {v:,.0f}"


def pct(v):
    return "-" if pd.isna(v) else f"{v:.1%}"


def kpi(col, label, value, note, tone="neutral"):
    col.markdown(f'<div class="kpi {tone}"><div class="label">{label}</div><div class="value">{value}</div><div class="note">{note}</div></div>',
                 unsafe_allow_html=True)


def callout(text, kind="warn", title=None):
    head = f'<div class="title">{title}</div>' if title else ""
    st.markdown(f'<div class="callout {kind}">{head}{text}</div>', unsafe_allow_html=True)


# ---------------------------------------------------------------- sidebar navigation
st.sidebar.title("Navigation")
section = st.sidebar.radio("Section", [":material/dashboard: Overview", ":material/storefront: Merchant Risk",
                                       ":material/person_search: User Risk", ":material/fact_check: Data Quality",
                                       ":material/chat: Ask the data"],
                           label_visibility="collapsed")
section = section.split(" ", 1)[1]
st.sidebar.caption("TransOrg AgentIQ Datathon, Track 1")

# ---------------------------------------------------------------- header and filter chips
span = query("""
    select least(min(t.lo), min(c.lo)) as lo, greatest(max(t.hi), max(c.hi)) as hi, min(t.lo) as tx_lo, max(t.hi) as tx_hi
    from (select min("timestamp")::date as lo, max("timestamp")::date as hi from transactions) t,
         (select min(coalesce(transaction_timestamp, reported_timestamp))::date as lo,
                 max(coalesce(transaction_timestamp, reported_timestamp))::date as hi from chargebacks) c""").iloc[0]
categories = query("select distinct merchant_category from merchants order by 1").merchant_category.tolist() + ["UNKNOWN"]
kyc_statuses = ["VERIFIED", "PENDING", "REJECTED", NO_KYC]
risk_segments = ["LOW", "MEDIUM", "HIGH", "UNKNOWN", NO_KYC]

st.title("UPI Fraud Ring & Merchant Analytics")
st.markdown(f'<p class="subtitle">Transaction sample from {span.tx_lo:%d %b %Y} to {span.tx_hi:%d %b %Y}; chargebacks reported through {span.hi:%d %b %Y}.</p>',
            unsafe_allow_html=True)

with st.container(border=True):
    top = st.columns([0.8, 1.7, 2.1])
    date_range = top[0].date_input("Date range", (span.lo, span.hi), min_value=span.lo, max_value=span.hi)
    sel_kyc = top[1].pills("KYC status", kyc_statuses, default=kyc_statuses, selection_mode="multi")
    sel_risk = top[2].pills("Risk segment", risk_segments, default=risk_segments, selection_mode="multi")
    sel_cat = st.pills("Merchant category", categories, default=categories, selection_mode="multi")
    st.caption("Click a chip to remove it from the filter. UNKNOWN = merchant not in master. NO_KYC_RECORD = user not in KYC file.")

if len(date_range) != 2 or not sel_cat or not sel_kyc or not sel_risk:
    st.info("Pick a complete date range and at least one value in each filter.")
    st.stop()

f = {"start": date_range[0], "end": date_range[1], "categories": sel_cat, "kyc": sel_kyc, "risk": sel_risk}
tx_sql, tx_params = filtered(TX_BASE, '"timestamp"', f)
cb_sql, cb_params = filtered(CB_BASE, "event_ts", f)

# ---------------------------------------------------------------- shared numbers
tx_kpi = query(f"""
    select count(*) as txns,
           sum(case when status = 'SUCCESS' and amount > 0 then amount end) as amount,
           sum((status = 'SUCCESS')::int) as success,
           avg(case when status = 'SUCCESS' and amount > 0 then amount end) as avg_value,
           sum((status = 'FAILED')::int) as failed,
           sum((status = 'PENDING')::int) as pending,
           sum((status = 'FAILED')::int) * 1.0 / nullif(count(*), 0) as failed_rate,
           sum((status = 'PENDING')::int) * 1.0 / nullif(count(*), 0) as pending_rate
    from ({tx_sql})""", tx_params).iloc[0]
cb_kpi = query(f"""
    select count(*) as cbs, sum(case when disputed_amount > 0 then disputed_amount end) as amount,
           sum((event_ts is null)::int) as undated
    from ({cb_sql})""", cb_params).iloc[0]
kyc_kpi = query("""
    select count(*) as users,
           sum((kyc_status = 'VERIFIED')::int) as verified, sum((kyc_status = 'REJECTED')::int) as rejected,
           sum((kyc_status = 'VERIFIED')::int) * 1.0 / nullif(count(*), 0) as completion,
           sum((kyc_status = 'REJECTED')::int) * 1.0 / nullif(count(*), 0) as rejection
    from kyc where list_contains(?, kyc_status) and list_contains(?, risk_segment)""", [sel_kyc, sel_risk]).iloc[0]
hrm = query("""
    select merchant_id, coalesce(merchant_name, 'Not in merchant master') as merchant_name, merchant_category,
           txn_count, chargeback_count, chargeback_amount, chargeback_to_transaction_ratio as ratio, merchant_status
    from high_risk_merchants where list_contains(?, merchant_category) order by chargeback_count desc""", [sel_cat])
overall_ratio = query("select chargeback_to_transaction_ratio as r from kpi_chargebacks").r[0]
ratio = cb_kpi.cbs / tx_kpi.txns if tx_kpi.txns else float("nan")


def describe_trend(series):
    # first half vs second half of the period, plus how noisy the daily values are
    if len(series) < 4:
        return "too few days in this range to describe a trend"
    half = len(series) // 2
    a, b = series.iloc[:half].mean(), series.iloc[half:].mean()
    change = (b - a) / a if a else 0
    cv = series.std() / series.mean() if series.mean() else 0
    if abs(change) < 0.05:
        shape = "held steady" if cv < 0.15 else "showed no clear direction"
    else:
        shape = f"{'rose' if change > 0 else 'fell'} about {abs(change):.0%} between the first and second half of the period"
    noise = "with little day-to-day movement" if cv < 0.10 else ("with moderate day-to-day swings" if cv < 0.25 else "with large day-to-day swings")
    return f"{shape}, {noise}"


# ================================================================ overview
if section == "Overview":
    st.markdown('<div class="kpi-cluster">Volume &amp; health</div>', unsafe_allow_html=True)
    c = st.columns(4)
    kpi(c[0], "Total transactions", f"{int(tx_kpi.txns):,}",
        f"{int(tx_kpi.success):,} succeeded, {int(tx_kpi.failed):,} failed, {int(tx_kpi.pending):,} still pending")
    kpi(c[1], "Total value settled", money(tx_kpi.amount),
        f"successful transactions only, averaging {money(tx_kpi.avg_value)} each")
    kpi(c[2], "Failed transaction rate", pct(tx_kpi.failed_rate),
        f"{int(tx_kpi.failed):,} of {int(tx_kpi.txns):,} attempts did not go through", "red")
    kpi(c[3], "KYC completion rate", pct(kyc_kpi.completion),
        f"{int(kyc_kpi.verified):,} of {int(kyc_kpi.users):,} customers on file are verified", "green")

    st.markdown('<div class="kpi-cluster">Risk &amp; compliance</div>', unsafe_allow_html=True)
    c = st.columns(4)
    kpi(c[0], "Chargeback-to-transaction ratio", f"{ratio:.3f}" if pd.notna(ratio) else "-",
        f"{int(cb_kpi.cbs):,} chargebacks against {int(tx_kpi.txns):,} transactions, by the chargeback's own merchant and user ids", "red")
    kpi(c[1], "Flagged high-risk merchants", f"{len(hrm)}",
        f"each has {HIGH_RISK_MIN_CB}+ chargebacks and a ratio at least 2x the overall {overall_ratio:.2f}", "red")
    kpi(c[2], "KYC rejection rate", pct(kyc_kpi.rejection),
        f"{int(kyc_kpi.rejected):,} customers on file were rejected at KYC", "red")
    c[3].empty()

    st.subheader("Transaction trends")
    daily = query(f"""
        select "timestamp"::date as day, count(*) as txns,
               sum(case when status = 'SUCCESS' and amount > 0 then amount end) as amount,
               sum((status = 'FAILED')::int) as failed,
               sum((status = 'FAILED')::int) * 1.0 / count(*) as failed_rate
        from ({tx_sql}) group by 1 order by 1""", tx_params)

    if daily.empty:
        st.info("No transactions match the current filters.")
    else:
        avg_txns, avg_rate = daily.txns.mean(), daily.failed_rate.mean()
        daily["txn_ctx"] = daily.txns.map(lambda v: f"{(v - avg_txns) / avg_txns:+.0%} vs the daily average of {avg_txns:,.0f}")
        daily["amt_ctx"] = daily.apply(lambda r: f"{r.txns:,} transactions that day", axis=1)
        daily["fail_ctx"] = daily.apply(lambda r: f"{r.failed} of {r.txns} failed; period average is {avg_rate:.1%}", axis=1)
        peak = daily.loc[daily.failed_rate.idxmax()]

        c1, c2 = st.columns(2)
        with c1:
            st.markdown("**Daily transaction volume and value**")
            st.markdown(f'<div class="chart-sub">Daily transaction count {describe_trend(daily.txns)}.</div>', unsafe_allow_html=True)
            fig = make_subplots(rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.1, subplot_titles=("Transactions per day", "Successful value per day"))
            fig.add_trace(go.Scatter(x=daily.day, y=daily.txns, mode="lines", line=dict(color="#64748b"), customdata=daily.txn_ctx,
                                     hovertemplate="%{x|%d %b}: %{y:,} transactions<br>%{customdata}<extra></extra>"), row=1, col=1)
            fig.add_trace(go.Scatter(x=daily.day, y=daily.amount, mode="lines", line=dict(color="#16a34a"), customdata=daily.amt_ctx,
                                     hovertemplate="%{x|%d %b}: Rs %{y:,.0f}<br>%{customdata}<extra></extra>"), row=2, col=1)
            fig.update_layout(height=400, margin=dict(l=10, r=10, t=30, b=10), showlegend=False, hovermode="x")
            st.plotly_chart(fig, width="stretch")
        with c2:
            st.markdown("**Failed transactions by day**")
            st.markdown(f'<div class="chart-sub">Failure rate averaged {avg_rate:.1%} and {describe_trend(daily.failed_rate)}; '
                        f'the worst day was {peak.day:%d %b} at {peak.failed_rate:.1%}.</div>', unsafe_allow_html=True)
            fig2 = make_subplots(specs=[[{"secondary_y": True}]])
            fig2.add_trace(go.Bar(x=daily.day, y=daily.failed, name="Failed count", marker_color="#dc2626", opacity=0.55, customdata=daily.fail_ctx,
                                  hovertemplate="%{x|%d %b}: %{y} failed<br>%{customdata}<extra></extra>"))
            fig2.add_trace(go.Scatter(x=daily.day, y=daily.failed_rate, name="Failed rate", mode="lines", line=dict(color="#7f1d1d"),
                                      hovertemplate="%{x|%d %b}: %{y:.1%} failure rate<extra></extra>"), secondary_y=True)
            fig2.update_layout(height=400, margin=dict(l=10, r=10, t=30, b=10), legend=dict(orientation="h", y=-0.2), hovermode="x")
            fig2.update_yaxes(title_text="count", secondary_y=False)
            fig2.update_yaxes(title_text="rate", tickformat=".0%", secondary_y=True)
            st.plotly_chart(fig2, width="stretch")

# ================================================================ merchant risk
elif section == "Merchant Risk":
    st.subheader("Chargeback-to-transaction ratio by merchant category")
    by_cat = query(f"""
        with t as (select merchant_category, count(*) as txns from ({tx_sql}) group by 1),
             c as (select merchant_category, count(*) as cbs from ({cb_sql}) group by 1)
        select coalesce(t.merchant_category, c.merchant_category) as merchant_category,
               coalesce(txns, 0) as txns, coalesce(cbs, 0) as cbs, cbs * 1.0 / nullif(txns, 0) as ratio
        from t full outer join c using (merchant_category)
        order by ratio desc nulls last""", tx_params + cb_params)
    if not by_cat.empty:
        known = by_cat[by_cat.merchant_category != "UNKNOWN"].dropna(subset=["ratio"])
        if len(known) >= 2:
            st.markdown(f'<div class="chart-sub">{known.iloc[0].merchant_category.replace("_", " ").title()} has the highest dispute ratio '
                        f'({known.iloc[0].ratio:.3f}) and {known.iloc[-1].merchant_category.replace("_", " ").title()} the lowest ({known.iloc[-1].ratio:.3f}), '
                        f'a {known.iloc[0].ratio / known.iloc[-1].ratio:.1f}x spread across known categories.</div>', unsafe_allow_html=True)
        by_cat["ctx"] = by_cat.apply(lambda r: f"{int(r.cbs):,} chargebacks against {int(r.txns):,} transactions", axis=1)
        fig3 = px.bar(by_cat, x="merchant_category", y="ratio", custom_data=["ctx"],
                      color=by_cat.merchant_category.eq("UNKNOWN").map({True: "not in master", False: "in master"}),
                      color_discrete_map={"in master": "#64748b", "not in master": "#cbd5e1"})
        fig3.update_traces(hovertemplate="%{x}: ratio %{y:.3f}<br>%{customdata[0]}<extra></extra>", texttemplate="%{y:.3f}", textposition="outside")
        fig3.update_layout(height=380, margin=dict(l=10, r=10, t=20, b=10), xaxis_title="", yaxis_title="chargebacks / transactions", legend_title_text="")
        st.plotly_chart(fig3, width="stretch")

    st.subheader("High-risk merchant ledger")
    callout("A dispute ratio above 1.0 means the chargeback file recorded more disputes for that merchant than this transaction "
            "sample includes - not a calculation error. This happens for merchants with sparse sample coverage.",
            title="Reading the ratio column")
    st.caption(f"Rule: {HIGH_RISK_MIN_CB}+ chargebacks and a ratio at least 2x the overall rate of {overall_ratio:.2f}. Filtered by merchant category.")

    show_all = st.toggle("View all flagged merchants", value=False)
    ledger = hrm if show_all else hrm.head(10)
    table = ledger[["merchant_name", "merchant_category", "txn_count", "chargeback_count", "chargeback_amount", "ratio"]].rename(columns={
        "merchant_name": "Merchant", "merchant_category": "Category", "txn_count": "Sample transactions",
        "chargeback_count": "Chargebacks", "chargeback_amount": "Disputed amount", "ratio": "Ratio"})
    threshold = 2 * overall_ratio

    def red_ratio(v):
        return "color: #b91c1c; font-weight: 600" if pd.notna(v) and v >= threshold else ""

    st.dataframe(table.style.map(red_ratio, subset=["Ratio"]).format({"Disputed amount": "{:,.0f}", "Ratio": "{:.2f}"}, na_rep="n/a"),
                 width="stretch", hide_index=True)
    if len(ledger) < len(hrm):
        st.caption(f"Showing top {len(ledger)} of {len(hrm)} flagged merchants - switch on 'View all' above to see the rest.")
    else:
        st.caption(f"Showing all {len(hrm)} flagged merchants{'' if len(hrm) == 28 else ' in the selected categories (28 in total)'}.")
    if (hrm.txn_count == 0).any():
        st.caption("Ratio shows n/a where the merchant has chargebacks but no transactions in this sample.")

# ================================================================ user risk
elif section == "User Risk":
    hru_all = query(f"""
        select user_id, chargeback_count, disputed_amount, merchants_disputed,
               coalesce(kyc_status, '{NO_KYC}') as kyc_status, coalesce(risk_segment, '{NO_KYC}') as risk_segment,
               pan_valid, aadhaar_valid, risk_reason
        from high_risk_users
        where list_contains(?, coalesce(kyc_status, '{NO_KYC}')) and list_contains(?, coalesce(risk_segment, '{NO_KYC}'))
        order by chargeback_count desc, disputed_amount desc nulls last""", [sel_kyc, sel_risk])
    reasons = hru_all.risk_reason.value_counts()

    c = st.columns(4)
    kpi(c[0], "Flagged high-risk users", f"{len(hru_all):,}", "2+ chargebacks, or 1+ with rejected KYC or invalid identity documents", "red")
    kpi(c[1], "Repeat disputers", f"{reasons.get('repeat_disputer', 0):,}", "two or more chargebacks on record", "red")
    kpi(c[2], "Rejected KYC", f"{reasons.get('kyc_rejected', 0):,}", "at least one chargeback and a rejected KYC", "red")
    kpi(c[3], "Invalid identity documents", f"{reasons.get('invalid_identity_docs', 0):,}", "at least one chargeback and an invalid PAN or Aadhaar", "red")

    st.subheader("High-risk users")
    st.caption("Top 20 by chargeback count. Only validity flags are shown for identity documents, never the values. Filtered by KYC status and risk segment.")
    st.dataframe(hru_all.head(20), width="stretch", hide_index=True,
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
        return ["font-weight: bold; color: #b91c1c" if row.span_hours < 24 else ""] * len(row)

    if clusters.empty:
        st.info("No clusters in the current filter.")
    else:
        st.dataframe(clusters.style.apply(highlight_tight, axis=1).format({"total_amount": "{:,.0f}", "first_txn": lambda v: v.strftime("%Y-%m-%d %H:%M")}),
                     width="stretch", hide_index=True)
        st.caption(f"{len(clusters)} clusters, {int(clusters.txns_in_cluster.sum())} transactions; {int((clusters.span_hours < 24).sum())} span under 24 hours.")

# ================================================================ ask the data
elif section == "Ask the data":
    st.subheader("Ask the data")
    st.caption("Plain-English questions are turned into a read-only DuckDB query and a chart by Gemini. "
               "Answers are limited to the cleaned tables and analytics views; the page filters above do not apply here.")

    @st.cache_resource
    def get_agent():
        return GraphAgent(connect())

    agent = get_agent()
    if not agent.ready:
        callout("No Gemini API key found. Copy .env.example to .env, set GEMINI_API_KEY, and restart the app.", kind="warn", title="Agent unavailable")
        st.stop()

    if "chat" not in st.session_state:
        st.session_state.chat = []

    examples = ["Show daily transaction volume trend.", "Which merchant has the highest chargeback count?",
                "Compare chargebacks by severity level.", "Show disputes reported after 7 days."]
    ex_cols = st.columns(len(examples))
    picked = None
    for col, ex in zip(ex_cols, examples):
        if col.button(ex, width="stretch"):
            picked = ex

    question = st.chat_input("Ask a question about transactions, merchants, users or chargebacks") or picked
    if question:
        with st.spinner("Thinking..."):
            try:
                spec, df, summary, notes = agent.ask(question)
                st.session_state.chat.append({"q": question, "spec": spec, "df": df, "summary": summary, "notes": notes})
            except AgentError as e:
                st.session_state.chat.append({"q": question, "error": str(e)})

    for turn in reversed(st.session_state.chat):
        with st.container(border=True):
            st.markdown(f'<div class="ask-q">{turn["q"]}</div>', unsafe_allow_html=True)
            if "error" in turn:
                callout(turn["error"], kind="warn", title="Could not answer that")
                continue
            spec, df = turn["spec"], turn["df"]
            st.markdown(f'<div class="ask-meta">{spec.chart_type} chart, {len(df)} rows. {spec.reasoning}</div>', unsafe_allow_html=True)
            fig = build_chart(spec, df)
            left, right = st.columns([1.6, 1])
            with left:
                if fig is not None:
                    st.plotly_chart(fig, width="stretch")
                else:
                    st.dataframe(df, width="stretch", hide_index=True)
            with right:
                st.markdown(f'<div class="ask-summary">{turn["summary"]}</div>', unsafe_allow_html=True)
                for n in turn["notes"]:
                    st.markdown(f'<div class="ask-note">{n}</div>', unsafe_allow_html=True)
                with st.expander("Query"):
                    st.code(spec.sql, language="sql")
                    if fig is not None:
                        st.dataframe(df.head(50), width="stretch", hide_index=True)
    if not st.session_state.chat:
        st.info("Try one of the example questions above or type your own.")

# ================================================================ data quality
else:
    cov = query("select left_table, right_table, match_rate from join_coverage").set_index(["left_table", "right_table"]).match_rate
    agree = query("""
        select count(*) as linked, sum((c.merchant_id = t.merchant_id)::int) as same_merchant
        from chargebacks c join transactions t using (txn_id)""").iloc[0]
    hru_total = query("select count(*) as n, sum((risk_reason = 'repeat_disputer')::int) as rep, sum((risk_reason = 'kyc_rejected')::int) as rej, "
                      "sum((risk_reason = 'invalid_identity_docs')::int) as docs from high_risk_users").iloc[0]

    st.subheader("What to know before trusting the numbers")
    c = st.columns(3)
    with c[0]:
        callout(f"Only <b>{cov[('transactions', 'kyc')]:.1%}</b> of transactions could be matched to a KYC record, and "
                f"<b>{cov[('transactions', 'merchants')]:.1%}</b> to a merchant record. This reflects gaps in the raw sample, not a flaw in the "
                "cleaning: the number of distinct ids is identical before and after cleaning. Unmatched rows are kept and labelled UNKNOWN or NO_KYC_RECORD.",
                kind="info", title="Join coverage")
    with c[1]:
        callout(f"Chargeback records link to a transaction id, but that link does not agree with the chargeback's own merchant, user or amount "
                f"in any of the {int(agree.linked):,} cases we checked ({int(agree.same_merchant)} matches). This dashboard attributes chargebacks "
                "using the chargeback record's own merchant and user ids instead.",
                kind="info", title="Transaction id links are unreliable")
    with c[2]:
        callout(f"<b>{int(hru_total.n)}</b> users are flagged high-risk: {int(hru_total.rep)} repeat disputers, {int(hru_total.rej)} with rejected KYC "
                f"and {int(hru_total.docs)} with invalid identity documents. Two thirds of the repeat disputers have no KYC record at all.",
                kind="info", title="High-risk users")

    st.subheader("Join coverage by key")
    covtab = query("select left_table, key, right_table, left_rows, matched_rows, match_rate from join_coverage")
    st.dataframe(covtab, width="stretch", hide_index=True, column_config={"match_rate": st.column_config.NumberColumn(format="%.1%")})
    st.caption("Share of rows in the left table that find a match in the right table, computed when the analytics database is built.")
