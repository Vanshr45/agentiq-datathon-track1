# natural language -> sql -> plotly chart, backed by gemini structured output
import os
import re
import time
from typing import Literal, Optional

import duckdb
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from pydantic import BaseModel

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None

MODEL_CANDIDATES = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"]
ROW_LIMIT = 500

# what the model is allowed to read. anything else referenced in FROM / JOIN is rejected.
ALLOWED = {
    "transactions", "kyc", "merchants", "chargebacks", "join_coverage",
    "kpi_transactions", "kpi_chargebacks", "kpi_kyc", "kpi_dispute_delay",
    "chargeback_ratio_by_merchant", "chargeback_ratio_by_category", "dispute_rate_by_merchant_category",
    "high_risk_merchants", "high_risk_users", "dispute_reporting_delay",
    "merchant_category_performance", "suspicious_transaction_clusters",
}

FINDINGS = """
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
"""

SQL_RULES = """
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
"""


class ChartSpec(BaseModel):
    sql: str
    chart_type: Literal["bar", "line", "scatter"]
    x: str
    y: list[str]
    color: Optional[str] = None
    title: str
    reasoning: str


class AgentError(Exception):
    pass


def schema_text(con):
    rows = con.execute("""
        select table_name, string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
        from information_schema.columns where table_schema = 'main' group by 1 order by 1
    """).fetchall()
    return "\n".join(f"- {name}({cols})" for name, cols in rows if name in ALLOWED)


_forbidden = re.compile(r"\b(insert|update|delete|drop|alter|create|attach|detach|copy|pragma|install|load|export|import|call|truncate|grant|vacuum|checkpoint|set)\b|\bread_\w+\s*\(|\bglob\s*\(", re.I)

def validate_sql(sql):
    s = sql.strip().rstrip(";").strip()
    if ";" in s:
        raise AgentError("only a single statement is allowed")
    if not re.match(r"^(select|with)\b", s, re.I):
        raise AgentError("only SELECT queries are allowed")
    if _forbidden.search(s):
        raise AgentError("query contains a disallowed keyword")
    ctes = {m.lower() for m in re.findall(r"\b(\w+)\s+as\s*\(", s, re.I)}
    for ref in re.findall(r"\b(?:from|join)\s+([a-zA-Z_][\w.]*)", s, re.I):
        if ref.lower() not in ALLOWED and ref.lower() not in ctes:
            raise AgentError(f"table '{ref}' is not in the allowed set")
    return s


class GraphAgent:
    def __init__(self, con: duckdb.DuckDBPyConnection, api_key=None, model=None):
        self.con = con
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.model = model or os.environ.get("GEMINI_MODEL") or MODEL_CANDIDATES[0]
        self.client = genai.Client(api_key=self.api_key) if (genai and self.api_key) else None
        self.schema = schema_text(con)

    @property
    def ready(self):
        return self.client is not None

    def _generate(self, prompt, schema=None, system=None, attempt=0):
        cfg = types.GenerateContentConfig(system_instruction=system, temperature=0.1)
        if schema:
            cfg.response_mime_type = "application/json"
            cfg.response_schema = schema
        try:
            resp = self.client.models.generate_content(model=self.model, contents=prompt, config=cfg)
        except Exception as e:
            msg = str(e)
            busy = any(k in msg for k in ("429", "RESOURCE_EXHAUSTED", "503", "UNAVAILABLE"))
            if busy and attempt < 2:
                time.sleep(15 * (attempt + 1))
                return self._generate(prompt, schema, system, attempt + 1)
            # retired model name, or one that stays busy: move down the candidate list before giving up
            if ("404" in msg or busy) and self.model in MODEL_CANDIDATES[:-1]:
                self.model = MODEL_CANDIDATES[MODEL_CANDIDATES.index(self.model) + 1]
                return self._generate(prompt, schema, system)
            if busy:
                raise AgentError("Gemini is rate limited or busy right now - wait a minute and try again.")
            if "API_KEY" in msg or "401" in msg or "403" in msg:
                raise AgentError("Gemini rejected the API key. Check GEMINI_API_KEY.")
            raise AgentError(f"Gemini request failed: {msg[:160]}")
        return resp.text

    def plan(self, question, error=None):
        system = "You turn business questions about a UPI payments dataset into a DuckDB query and chart spec.\n" + FINDINGS + SQL_RULES
        prompt = f"Tables and views:\n{self.schema}\n\nQuestion: {question}"
        if error:
            prompt += f"\n\nYour previous SQL failed with: {error}\nReturn a corrected spec."
        raw = self._generate(prompt, schema=ChartSpec, system=system)
        try:
            return ChartSpec.model_validate_json(raw)
        except Exception:
            raise AgentError("Gemini returned something that was not a valid chart spec. Try rephrasing the question.")

    def run_sql(self, sql):
        safe = validate_sql(sql)
        return self.con.execute(f"select * from ({safe}) limit {ROW_LIMIT}").df()

    def summarize(self, question, spec, df, notes):
        system = "You write one or two plain sentences for a business reader summarising a query result. " \
                 "State the concrete numbers. Amounts are Indian rupees, written as Rs. Do not speculate beyond the " \
                 "data given, and describe the whole result, not just the first rows.\n" + FINDINGS
        prompt = (f"Question: {question}\nSQL: {spec.sql}\n{profile(df)}\n"
                  f"Mandatory caveats to weave in if not already obvious: {notes or 'none'}\nSummary:")
        return self._generate(prompt, system=system).strip()

    def ask(self, question):
        spec = self.plan(question)
        try:
            df = self.run_sql(spec.sql)
        except AgentError:
            raise
        except Exception as e:
            spec = self.plan(question, error=str(e)[:300])
            try:
                df = self.run_sql(spec.sql)
            except AgentError:
                raise
            except Exception as e2:
                raise AgentError(f"The generated query could not run: {str(e2)[:200]}")
        if df.empty:
            raise AgentError("The query ran but returned no rows for that question.")
        notes = data_caveats(df, self.con)
        summary = self.summarize(question, spec, df, "; ".join(notes))
        return spec, df, summary, notes


# compact description of the whole result so the summary is not based on the first rows only
def profile(df):
    parts = [f"Result: {len(df)} rows, columns {list(df.columns)}"]
    num = df.select_dtypes("number")
    if not num.empty:
        stats = num.agg(["min", "max", "mean", "sum"]).round(2)
        parts.append("Numeric column stats over all rows:\n" + stats.to_string())
        for c in num.columns:
            hi, lo = df.loc[num[c].idxmax()], df.loc[num[c].idxmin()]
            parts.append(f"max {c}: {hi.to_dict()} | min {c}: {lo.to_dict()}")
    parts.append("First rows:\n" + df.head(12).to_string(index=False))
    if len(df) > 12:
        parts.append("Last rows:\n" + df.tail(3).to_string(index=False))
    return "\n".join(parts)


# caveats derived from the result itself, so they appear even if the model forgets them
def data_caveats(df, con=None):
    notes = []
    ratio_cols = [c for c in df.columns if "ratio" in c.lower()]
    if any((df[c].dropna() > 1).any() for c in ratio_cols if pd.api.types.is_numeric_dtype(df[c])):
        notes.append("Some ratios exceed 1.0 because the chargeback file holds more complaints for that merchant than "
                     "the 20,000-row transaction sample holds transactions - sparse sampling, not an error.")
    # look the ids up rather than trusting whichever columns the model chose to return
    if con is not None and "merchant_id" in df.columns:
        ids = [i for i in df.merchant_id.dropna().unique().tolist() if str(i).startswith("MCH")]
        if ids:
            known = {r[0] for r in con.execute("select merchant_id from merchants where list_contains(?, merchant_id)", [ids]).fetchall()}
            missing = [i for i in ids if i not in known]
            if missing:
                shown = ", ".join(missing[:5]) + (" and more" if len(missing) > 5 else "")
                notes.append(f"{len(missing)} merchant id(s) shown ({shown}) have activity but no entry in the merchant master, "
                             "so their name and category are unknown.")
    if con is not None and "user_id" in df.columns:
        ids = [i for i in df.user_id.dropna().unique().tolist() if str(i).startswith("USR")]
        if ids:
            known = {r[0] for r in con.execute("select user_id from kyc where list_contains(?, user_id)", [ids]).fetchall()}
            missing = len([i for i in ids if i not in known])
            if missing:
                notes.append(f"{missing} of the {len(ids)} user id(s) shown have no KYC record, so their identity and risk segment are unknown.")
    if any("chargeback" in c.lower() or "dispute" in c.lower() for c in df.columns):
        notes.append("Chargebacks are attributed by the chargeback record's own merchant/user ids, not by txn_id, "
                     "because that link does not agree with the chargeback's own fields.")
    return notes


def build_chart(spec, df):
    cols = list(df.columns)
    x = spec.x if spec.x in cols else cols[0]
    y = [c for c in spec.y if c in cols and c != x] or [c for c in cols if c != x and pd.api.types.is_numeric_dtype(df[c])][:2]
    color = spec.color if spec.color in cols and spec.color not in y and spec.color != x else None
    if not y:
        return None
    palette = ["#64748b", "#dc2626", "#16a34a", "#94a3b8", "#f87171", "#4ade80"]
    # two measures on very different scales (amount vs count) get their own axes
    if len(y) == 2 and color is None and spec.chart_type in ("line", "bar"):
        a, b = df[y[0]].abs().median(), df[y[1]].abs().median()
        if a and b and max(a, b) / min(a, b) > 20:
            return dual_axis_chart(spec, df, x, y, palette)
    kw = dict(x=x, y=y if len(y) > 1 else y[0], title=spec.title, color=color)
    if spec.chart_type == "line":
        fig = px.line(df.sort_values(x), **kw, color_discrete_sequence=palette)
    elif spec.chart_type == "scatter":
        fig = px.scatter(df, **kw, color_discrete_sequence=palette, hover_data=cols)
    else:
        fig = px.bar(df, **kw, color_discrete_sequence=palette, barmode="group")
        if pd.api.types.is_object_dtype(df[x]) or pd.api.types.is_string_dtype(df[x]):
            fig.update_xaxes(categoryorder="array", categoryarray=df[x].tolist())
    fig.update_layout(height=380, margin=dict(l=10, r=10, t=45, b=10), legend_title_text="")
    return fig


def dual_axis_chart(spec, df, x, y, palette):
    d = df.sort_values(x) if spec.chart_type == "line" else df
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    for i, col in enumerate(y):
        trace = go.Scatter(x=d[x], y=d[col], name=col, mode="lines", line=dict(color=palette[i])) if spec.chart_type == "line" \
            else go.Bar(x=d[x], y=d[col], name=col, marker_color=palette[i], opacity=0.85, offsetgroup=i)
        fig.add_trace(trace, secondary_y=(i == 1))
    fig.update_yaxes(title_text=y[0], secondary_y=False)
    fig.update_yaxes(title_text=y[1], secondary_y=True)
    fig.update_layout(title=spec.title, height=380, margin=dict(l=10, r=10, t=45, b=10), legend=dict(orientation="h", y=-0.25))
    return fig
