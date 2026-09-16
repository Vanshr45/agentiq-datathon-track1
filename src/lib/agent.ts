// client side of the agent: sql validation, execution in duckdb-wasm, result-derived caveats. mirrors agent/graph_agent.py
import { runQuery, Row } from "./duckdb";
import { ALLOWED_TABLES } from "./views";

export const ROW_LIMIT = 500;

export type Plan = { sql: string; chart_type: "bar" | "line" | "scatter"; x: string; y: string[]; color?: string | null; title: string; reasoning: string };

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|copy|pragma|install|load|export|import|call|truncate|grant|vacuum|checkpoint|set)\b|\bread_\w+\s*\(|\bglob\s*\(/i;

export function validateSql(sql: string): string {
  const s = sql.trim().replace(/;+\s*$/, "").trim();
  if (s.includes(";")) throw new Error("only a single statement is allowed");
  if (!/^(select|with)\b/i.test(s)) throw new Error("only SELECT queries are allowed");
  if (FORBIDDEN.test(s)) throw new Error("query contains a disallowed keyword");
  const ctes = new Set([...s.matchAll(/\b(\w+)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w.]*)/gi)) {
    const ref = m[1].toLowerCase();
    if (!ALLOWED_TABLES.has(ref) && !ctes.has(ref)) throw new Error(`table '${m[1]}' is not in the allowed set`);
  }
  return s;
}

export async function runPlanSql(sql: string) {
  const safe = validateSql(sql);
  return runQuery(`select * from (${safe}) limit ${ROW_LIMIT}`);
}

export async function schemaText() {
  const r = await runQuery(`
    select table_name, string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) as cols
    from information_schema.columns where table_schema = 'main' group by 1 order by 1`);
  return r.rows.filter((x) => ALLOWED_TABLES.has(String(x.table_name))).map((x) => `- ${x.table_name}(${x.cols})`).join("\n");
}

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

// caveats derived from the result itself, so they appear even if the model forgets them
export async function dataCaveats(rows: Row[], columns: string[]) {
  const notes: string[] = [];
  const ratioCols = columns.filter((c) => c.toLowerCase().includes("ratio"));
  if (ratioCols.some((c) => rows.some((r) => isNum(r[c]) && (r[c] as number) > 1))) {
    notes.push("Some ratios exceed 1.0 because the chargeback file holds more complaints for that merchant than the 20,000-row transaction sample holds transactions - sparse sampling, not an error.");
  }
  const lit = (ids: string[]) => ids.map((i) => `'${i.replace(/'/g, "")}'`).join(",");
  if (columns.includes("merchant_id")) {
    const ids = [...new Set(rows.map((r) => String(r.merchant_id)).filter((i) => i.startsWith("MCH")))];
    if (ids.length) {
      const known = new Set((await runQuery(`select merchant_id from merchants where merchant_id in (${lit(ids)})`)).rows.map((r) => String(r.merchant_id)));
      const missing = ids.filter((i) => !known.has(i));
      if (missing.length) notes.push(`${missing.length} merchant id(s) shown (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " and more" : ""}) have activity but no entry in the merchant master, so their name and category are unknown.`);
    }
  }
  if (columns.includes("user_id")) {
    const ids = [...new Set(rows.map((r) => String(r.user_id)).filter((i) => i.startsWith("USR")))];
    if (ids.length) {
      const known = new Set((await runQuery(`select user_id from kyc where user_id in (${lit(ids)})`)).rows.map((r) => String(r.user_id)));
      const missing = ids.filter((i) => !known.has(i)).length;
      if (missing) notes.push(`${missing} of the ${ids.length} user id(s) shown have no KYC record, so their identity and risk segment are unknown.`);
    }
  }
  if (columns.some((c) => /chargeback|dispute/i.test(c))) {
    notes.push("Chargebacks are attributed by the chargeback record's own merchant/user ids, not by txn_id, because that link does not agree with the chargeback's own fields.");
  }
  return notes;
}

// compact description of the whole result so the summary is not based on the first rows only
export function profile(rows: Row[], columns: string[]) {
  const parts = [`Result: ${rows.length} rows, columns ${JSON.stringify(columns)}`];
  const numCols = columns.filter((c) => rows.some((r) => isNum(r[c])));
  for (const c of numCols) {
    const vals = rows.map((r) => r[c]).filter(isNum);
    if (!vals.length) continue;
    const sum = vals.reduce((s, v) => s + v, 0);
    const hi = rows[vals.indexOf(Math.max(...vals))], lo = rows[vals.indexOf(Math.min(...vals))];
    parts.push(`${c}: min ${Math.min(...vals)}, max ${Math.max(...vals)}, mean ${(sum / vals.length).toFixed(2)}, sum ${sum.toFixed(2)}; max row ${JSON.stringify(hi)}; min row ${JSON.stringify(lo)}`);
  }
  parts.push("First rows:\n" + rows.slice(0, 12).map((r) => JSON.stringify(r)).join("\n"));
  if (rows.length > 12) parts.push("Last rows:\n" + rows.slice(-3).map((r) => JSON.stringify(r)).join("\n"));
  return parts.join("\n");
}

async function api(body: Record<string, unknown>) {
  const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "request failed");
  return data;
}

export type Answer = { plan: Plan; rows: Row[]; columns: string[]; summary: string; notes: string[]; model: string };

export async function ask(question: string): Promise<Answer> {
  const schema = await schemaText();
  let { plan, model } = (await api({ question, schema })) as { plan: Plan; model: string };
  let result;
  try {
    result = await runPlanSql(plan.sql);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not in the allowed set|disallowed|only (a single|SELECT)/.test(msg)) throw e;
    ({ plan, model } = (await api({ question, schema, error: msg.slice(0, 300) })) as { plan: Plan; model: string });
    result = await runPlanSql(plan.sql);
  }
  if (!result.rows.length) throw new Error("The query ran but returned no rows for that question.");
  const notes = await dataCaveats(result.rows, result.columns);
  const { summary } = await api({ mode: "summary", question, sql: plan.sql, profile: profile(result.rows, result.columns), notes: notes.join("; ") });
  return { plan, rows: result.rows, columns: result.columns, summary, notes, model };
}
