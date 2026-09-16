"use client";
import { useQuery } from "@/lib/useQuery";
import { CATEGORIES, KYC_STATUSES, RISK_SEGMENTS, useFilters } from "@/lib/filters";
import { dayLabel } from "@/lib/format";

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-600">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button key={o} onClick={() => toggle(o)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${on ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-500 line-through"}`}>
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Header() {
  const { filters, setFilters } = useFilters();
  const span = useQuery(`select min("timestamp") as lo, max("timestamp") as hi from transactions`);
  const cb = useQuery(`select max(coalesce(transaction_timestamp, reported_timestamp)) as hi from chargebacks`);
  const lo = span.rows?.[0]?.lo as number | undefined, hi = span.rows?.[0]?.hi as number | undefined, cbhi = cb.rows?.[0]?.hi as number | undefined;
  const fmt = (ms: number) => `${dayLabel(ms)} ${new Date(ms).getFullYear()}`;
  return (
    <header>
      <h1 className="text-3xl font-bold">UPI Fraud Ring &amp; Merchant Analytics</h1>
      <p className="mt-1 text-sm text-slate-600">
        {lo && hi ? `Transaction sample from ${fmt(lo)} to ${fmt(hi)}${cbhi ? `; chargebacks reported through ${fmt(cbhi)}` : ""}.` : "Loading sample range..."}
      </p>
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-6">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Date range</div>
            <div className="flex items-center gap-1 text-sm">
              <input type="date" value={filters.start} min="2026-01-01" max="2026-05-03" onChange={(e) => setFilters({ ...filters, start: e.target.value })} className="rounded border border-slate-200 px-2 py-1" />
              <span className="text-slate-500">to</span>
              <input type="date" value={filters.end} min="2026-01-01" max="2026-05-03" onChange={(e) => setFilters({ ...filters, end: e.target.value })} className="rounded border border-slate-200 px-2 py-1" />
            </div>
          </div>
          <Chips label="KYC status" options={KYC_STATUSES} value={filters.kyc} onChange={(kyc) => setFilters({ ...filters, kyc })} />
          <Chips label="Risk segment" options={RISK_SEGMENTS} value={filters.risk} onChange={(risk) => setFilters({ ...filters, risk })} />
        </div>
        <Chips label="Merchant category" options={CATEGORIES} value={filters.categories} onChange={(categories) => setFilters({ ...filters, categories })} />
        <div className="text-xs text-slate-500">Click a chip to remove it from the filter. UNKNOWN = merchant not in master. NO_KYC_RECORD = user not in KYC file.</div>
      </div>
    </header>
  );
}
