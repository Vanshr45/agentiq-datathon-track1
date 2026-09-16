// gemini planner: question -> {sql, chart_type, x, y, color, title, reasoning}. the key never leaves the server.
import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { FINDINGS, SQL_RULES } from "@/lib/agentPrompts";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL_CANDIDATES = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"];

const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sql: { type: Type.STRING },
    chart_type: { type: Type.STRING, enum: ["bar", "line", "scatter"] },
    x: { type: Type.STRING },
    y: { type: Type.ARRAY, items: { type: Type.STRING } },
    color: { type: Type.STRING, nullable: true },
    title: { type: Type.STRING },
    reasoning: { type: Type.STRING },
  },
  required: ["sql", "chart_type", "x", "y", "title", "reasoning"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generate(ai: GoogleGenAI, model: string, system: string, prompt: string, json: boolean, attempt = 0): Promise<{ text: string; model: string }> {
  try {
    const res = await ai.models.generateContent({
      model, contents: prompt,
      config: { systemInstruction: system, temperature: 0.1, ...(json ? { responseMimeType: "application/json", responseSchema: PLAN_SCHEMA } : {}) },
    });
    return { text: res.text ?? "", model };
  } catch (e) {
    const msg = String(e);
    const busy = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE/.test(msg);
    if (busy && attempt < 2) { await sleep(8000 * (attempt + 1)); return generate(ai, model, system, prompt, json, attempt + 1); }
    const idx = MODEL_CANDIDATES.indexOf(model);
    if ((/404/.test(msg) || busy) && idx >= 0 && idx < MODEL_CANDIDATES.length - 1) return generate(ai, MODEL_CANDIDATES[idx + 1], system, prompt, json);
    if (busy) throw new Error("Gemini is rate limited or busy right now - wait a minute and try again.");
    if (/API_KEY|401|403/.test(msg)) throw new Error("Gemini rejected the API key. Check GEMINI_API_KEY.");
    throw new Error("Gemini request failed: " + msg.slice(0, 160));
  }
}

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "GEMINI_API_KEY is not set on the server." }, { status: 500 });
  const body = await req.json();
  const ai = new GoogleGenAI({ apiKey: key });
  const model = process.env.GEMINI_MODEL || MODEL_CANDIDATES[0];

  try {
    if (body.mode === "summary") {
      const system = "You write one or two plain sentences for a business reader summarising a query result. State the concrete numbers. " +
        "Amounts are Indian rupees, written as Rs. Do not speculate beyond the data given, and describe the whole result, not just the first rows.\n" + FINDINGS;
      const prompt = `Question: ${body.question}\nSQL: ${body.sql}\n${body.profile}\nMandatory caveats to weave in if not already obvious: ${body.notes || "none"}\nSummary:`;
      const { text } = await generate(ai, model, system, prompt, false);
      return NextResponse.json({ summary: text.trim() });
    }
    const system = "You turn business questions about a UPI payments dataset into a DuckDB query and chart spec.\n" + FINDINGS + SQL_RULES;
    let prompt = `Tables and views:\n${body.schema}\n\nQuestion: ${body.question}`;
    if (body.error) prompt += `\n\nYour previous SQL failed with: ${body.error}\nReturn a corrected spec.`;
    const { text, model: used } = await generate(ai, model, system, prompt, true);
    let plan;
    try { plan = JSON.parse(text); } catch { return NextResponse.json({ error: "Gemini returned something that was not a valid chart spec. Try rephrasing the question." }, { status: 502 }); }
    return NextResponse.json({ plan, model: used });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
