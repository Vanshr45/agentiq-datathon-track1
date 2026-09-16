import type { ReactNode } from "react";

export type Tone = "neutral" | "red" | "green";
const border = { neutral: "border-l-neutral-accent", red: "border-l-risk-accent", green: "border-l-ok-accent" };

export function Kpi({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: Tone }) {
  return (
    <div className={`rounded-lg border border-line border-l-4 bg-surface px-4 py-3 min-h-[118px] ${border[tone]}`}>
      <div className="text-xs text-faint">{label}</div>
      <div className="my-1 text-3xl font-semibold leading-tight">{value}</div>
      <div className="text-xs text-muted">{note}</div>
    </div>
  );
}

export function ClusterLabel({ children }: { children: ReactNode }) {
  return <div className="mt-6 mb-2 text-xs uppercase tracking-widest text-faint">{children}</div>;
}

export function Callout({ title, children, kind = "warn" }: { title?: string; children: ReactNode; kind?: "warn" | "info" }) {
  const cls = kind === "warn" ? "bg-risk-bg border-risk-line text-risk-fg" : "bg-surface-2 border-line text-fg";
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${cls}`}>
      {title && <div className="mb-1 font-semibold">{title}</div>}
      {children}
    </div>
  );
}

export function Section({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">{title}</h2>
      {sub && <div className="mt-1 mb-3 text-sm text-muted">{sub}</div>}
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</div>;
}
