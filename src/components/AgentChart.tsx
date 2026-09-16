"use client";
import Plot, { baseLayout } from "./Plot";
import type { Plan } from "@/lib/agent";
import type { Row } from "@/lib/duckdb";

const PALETTE = ["#64748b", "#dc2626", "#16a34a", "#94a3b8", "#f87171", "#4ade80"];
const isNum = (v: unknown) => typeof v === "number";
const isDateCol = (name: string, rows: Row[]) => /day|date|_ts|timestamp|time|month|week/i.test(name) && rows.every((r) => isNum(r[name]) && (r[name] as number) > 1e11);

export default function AgentChart({ plan, rows, columns }: { plan: Plan; rows: Row[]; columns: string[] }) {
  const x = columns.includes(plan.x) ? plan.x : columns[0];
  let y = plan.y.filter((c) => columns.includes(c) && c !== x);
  if (!y.length) y = columns.filter((c) => c !== x && rows.some((r) => isNum(r[c]))).slice(0, 2);
  const color = plan.color && columns.includes(plan.color) && plan.color !== x && !y.includes(plan.color) ? plan.color : null;
  if (!y.length) return null;

  const xv = (r: Row) => (isDateCol(x, rows) ? new Date(r[x] as number) : (r[x] as string | number));
  const sorted = plan.chart_type === "line" ? [...rows].sort((a, b) => Number(a[x]) - Number(b[x])) : rows;

  // two measures on very different scales (amount vs count) get their own axes
  const med = (c: string) => { const v = rows.map((r) => Math.abs(Number(r[c]))).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; };
  const dual = y.length === 2 && !color && plan.chart_type !== "scatter" && med(y[0]) && med(y[1]) && Math.max(med(y[0]), med(y[1])) / Math.min(med(y[0]), med(y[1])) > 20;

  const traces: Plotly.Data[] = [];
  if (color) {
    const groups = [...new Set(rows.map((r) => String(r[color])))];
    groups.forEach((g, i) => {
      const sub = sorted.filter((r) => String(r[color]) === g);
      traces.push({ x: sub.map(xv), y: sub.map((r) => r[y[0]] as number), name: g, type: plan.chart_type === "bar" ? "bar" : "scatter",
        mode: plan.chart_type === "line" ? "lines" : "markers", marker: { color: PALETTE[i % PALETTE.length] }, line: { color: PALETTE[i % PALETTE.length] } });
    });
  } else {
    y.forEach((c, i) => {
      traces.push({ x: sorted.map(xv), y: sorted.map((r) => r[c] as number), name: c, type: plan.chart_type === "bar" ? "bar" : "scatter",
        mode: plan.chart_type === "line" ? "lines" : "markers", marker: { color: PALETTE[i % PALETTE.length] }, line: { color: PALETTE[i % PALETTE.length] },
        ...(dual && i === 1 ? { yaxis: "y2" } : {}) });
    });
  }
  const layout: Partial<Plotly.Layout> = { ...baseLayout, title: { text: plan.title, font: { size: 14 } }, barmode: "group", legend: { orientation: "h", y: -0.25 },
    xaxis: { title: { text: x }, ...(plan.chart_type === "bar" && !isDateCol(x, rows) ? { type: "category" } : {}) },
    yaxis: { title: { text: y[0] } },
    ...(dual ? { yaxis2: { title: { text: y[1] }, overlaying: "y", side: "right" } } : {}) };
  return <div className="h-[380px]"><Plot data={traces} layout={layout} /></div>;
}
