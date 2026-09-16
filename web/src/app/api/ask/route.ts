// groq planner: question -> {sql, chart_type, x, y, color, title, reasoning}. the key never leaves the server.
import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { FINDINGS, SQL_RULES } from "@/lib/agentPrompts";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL_CANDIDATES = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

const PLAN_SHAPE = `Respond with a single JSON object, nothing else, shaped exactly like:
{"sql": string, "chart_type": "bar" | "line" | "scatter", "x": string, "y": string[], "color": string | null, "title": string, "reasoning": string}
sql, chart_type, x, y and title are all required. y must be a non-empty array of column names.`;

type Msg = { role: "system" | "user" | "assistant"; content: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// groq puts the wait time in a retry-after header and in the message ("Please try again in 2.5s")
function retryAfterMs(e: unknown) {
  const h = e instanceof Groq.APIError ? e.headers?.get("retry-after") : null;
  if (h && !Number.isNaN(Number(h))) return Number(h) * 1000;
  const m = /try again in ([\d.]+)(ms|s|m)/i.exec(String(e));
  if (m) return Number(m[1]) * (m[2] === "ms" ? 1 : m[2] === "m" ? 60000 : 1000);
  return 0;
}

async function generate(ai: Groq, model: string, messages: Msg[], json: boolean, attempt = 0): Promise<{ text: string; model: string }> {
  try {
    const res = await ai.chat.completions.create({
      model, messages, temperature: 0.1, max_tokens: 1024,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    });
    return { text: res.choices[0]?.message?.content ?? "", model };
  } catch (e) {
    const status = e instanceof Groq.APIError ? e.status : undefined;
    const msg = e instanceof Error ? e.message : String(e);
    // 429 = per-minute request/token limit, 5xx = groq side
    const busy = status === 429 || (status !== undefined && status >= 500);
    if (busy && attempt < 2) { await sleep(Math.min(retryAfterMs(e) || 2000 * (attempt + 1), 15000)); return generate(ai, model, messages, json, attempt + 1); }
    const idx = MODEL_CANDIDATES.indexOf(model);
    if ((busy || status === 404 || status === 413) && idx >= 0 && idx < MODEL_CANDIDATES.length - 1) return generate(ai, MODEL_CANDIDATES[idx + 1], messages, json);
    if (busy) throw new Error("Groq is rate limited or busy right now - wait a minute and try again.");
    if (status === 401 || status === 403) throw new Error("Groq rejected the API key. Check GROQ_API_KEY.");
    throw new Error("Groq request failed: " + msg.replace(/^\d{3}\s*/, "").slice(0, 160));
  }
}

type Plan = { sql: string; chart_type: "bar" | "line" | "scatter"; x: string; y: string[]; color?: string | null; title: string; reasoning: string };

// json mode only guarantees parseable json, not the shape, so check the fields we chart on
function checkPlan(raw: string): { plan?: Plan; problem?: string } {
  let p: Record<string, unknown>;
  try { p = JSON.parse(raw); } catch { return { problem: "the response was not valid JSON" }; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return { problem: "the response was not a JSON object" };
  const str = (k: string) => typeof p[k] === "string" && (p[k] as string).trim().length > 0;
  const bad: string[] = [];
  if (!str("sql")) bad.push("sql");
  if (!["bar", "line", "scatter"].includes(p.chart_type as string)) bad.push("chart_type");
  if (!str("x")) bad.push("x");
  if (typeof p.y === "string" && (p.y as string).trim()) p.y = [p.y];
  if (!Array.isArray(p.y) || !p.y.length || !p.y.every((v) => typeof v === "string" && v.trim())) bad.push("y");
  if (!str("title")) bad.push("title");
  if (bad.length) return { problem: `these fields were missing or malformed: ${bad.join(", ")}` };
  if (typeof p.color !== "string" || !p.color.trim()) p.color = null;
  if (!str("reasoning")) p.reasoning = "";
  return { plan: p as Plan };
}

export async function POST(req: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ error: "GROQ_API_KEY is not set on the server." }, { status: 500 });
  const body = await req.json();
  const ai = new Groq({ apiKey: key, maxRetries: 0 });
  const model = process.env.GROQ_MODEL || MODEL_CANDIDATES[0];

  try {
    if (body.mode === "summary") {
      const system = "You write one or two plain sentences for a business reader summarising a query result. State the concrete numbers. " +
        "Amounts are Indian rupees, written as Rs. Do not speculate beyond the data given, and describe the whole result, not just the first rows. " +
        "Reply with the sentences only, no preamble.\n" + FINDINGS;
      const prompt = `Question: ${body.question}\nSQL: ${body.sql}\n${body.profile}\nMandatory caveats to weave in if not already obvious: ${body.notes || "none"}\nSummary:`;
      const { text } = await generate(ai, model, [{ role: "system", content: system }, { role: "user", content: prompt }], false);
      return NextResponse.json({ summary: text.trim() });
    }
    const system = "You turn business questions about a UPI payments dataset into a DuckDB query and chart spec.\n" + FINDINGS + SQL_RULES + "\n" + PLAN_SHAPE;
    let prompt = `Tables and views:\n${body.schema}\n\nQuestion: ${body.question}`;
    if (body.error) prompt += `\n\nYour previous SQL failed with: ${body.error}\nReturn a corrected spec.`;
    const messages: Msg[] = [{ role: "system", content: system }, { role: "user", content: prompt }];
    let { text, model: used } = await generate(ai, model, messages, true);
    let { plan, problem } = checkPlan(text);
    if (!plan) {
      // one follow-up in the same conversation pointing at what was wrong
      messages.push({ role: "assistant", content: text }, { role: "user", content: `That did not work: ${problem}. Return the complete JSON object again with every required field filled in.` });
      ({ text, model: used } = await generate(ai, model, messages, true));
      ({ plan, problem } = checkPlan(text));
    }
    if (!plan) return NextResponse.json({ error: "The model returned something that was not a valid chart spec. Try rephrasing the question." }, { status: 502 });
    return NextResponse.json({ plan, model: used });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
