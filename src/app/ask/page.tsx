"use client";
import { useState } from "react";
import AgentChart from "@/components/AgentChart";
import { Callout, Card, Section } from "@/components/ui";
import { useDuck } from "@/lib/DuckContext";
import { ask, Answer } from "@/lib/agent";

type Turn = { q: string; answer?: Answer; error?: string };
const EXAMPLES = ["Show daily transaction volume trend.", "Which merchant has the highest chargeback count?", "Compare chargebacks by severity level.", "Show disputes reported after 7 days."];

export default function Ask() {
  const duck = useDuck();
  const [chat, setChat] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (question: string) => {
    if (!question.trim() || busy || duck.status !== "ready") return;
    setBusy(true); setQ("");
    try {
      const answer = await ask(question);
      setChat((c) => [{ q: question, answer }, ...c]);
    } catch (e) {
      setChat((c) => [{ q: question, error: e instanceof Error ? e.message : String(e) }, ...c]);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <Section title="Ask the data"
        sub="Plain-English questions are turned into a read-only DuckDB query by Gemini, validated in your browser, and run against the in-browser data. The page filters above do not apply here.">
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => <button key={e} onClick={() => submit(e)} disabled={busy} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">{e}</button>)}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); submit(q); }} className="mt-3 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question about transactions, merchants, users or chargebacks"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none" />
          <button type="submit" disabled={busy || duck.status !== "ready"} className="rounded-md bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Thinking..." : "Ask"}</button>
        </form>
        {busy && <div className="mt-2 text-xs text-slate-500">Two model calls on the free tier; usually 5 to 15 seconds, up to a minute if Gemini is busy.</div>}
      </Section>

      <div className="mt-6 space-y-4">
        {chat.length === 0 && !busy && <Card className="text-sm text-slate-600">Try one of the example questions above or type your own.</Card>}
        {chat.map((t, i) => (
          <Card key={chat.length - i}>
            <div className="font-semibold">{t.q}</div>
            {t.error ? <div className="mt-2"><Callout title="Could not answer that">{t.error}</Callout></div> : t.answer && (
              <>
                <div className="mt-1 mb-2 text-xs text-slate-500">{t.answer.plan.chart_type} chart, {t.answer.rows.length} rows, {t.answer.model}. {t.answer.plan.reasoning}</div>
                <div className="grid grid-cols-[1.6fr_1fr] gap-4">
                  <AgentChart plan={t.answer.plan} rows={t.answer.rows} columns={t.answer.columns} />
                  <div className="space-y-2">
                    <div className="rounded-md border-l-4 border-slate-500 bg-slate-50 px-3 py-2 text-sm">{t.answer.summary}</div>
                    {t.answer.notes.map((n) => <div key={n} className="rounded-md border-l-4 border-red-600 bg-red-50 px-3 py-2 text-xs text-red-900">{n}</div>)}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-600">Query and rows</summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">{t.answer.plan.sql}</pre>
                      <div className="mt-1 max-h-48 overflow-auto rounded border border-slate-200">
                        <table className="w-full text-[11px]"><thead className="bg-slate-50"><tr>{t.answer.columns.map((c) => <th key={c} className="px-2 py-1 text-left">{c}</th>)}</tr></thead>
                          <tbody>{t.answer.rows.slice(0, 50).map((r, k) => <tr key={k} className="border-t border-slate-100">{t.answer!.columns.map((c) => <td key={c} className="px-2 py-1">{String(r[c] ?? "")}</td>)}</tr>)}</tbody></table>
                      </div>
                    </details>
                  </div>
                </div>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
