"use client";
import { createContext, useContext, useState } from "react";

export const NO_KYC = "NO_KYC_RECORD";
export const CATEGORIES = ["APPAREL", "BOOKS_STATIONERY", "DEPARTMENT_STORE", "GROCERY", "HOTEL", "MISC_RETAIL",
  "PHARMACY", "RESTAURANT", "TELECOM", "TRANSPORT", "UNKNOWN"];
export const KYC_STATUSES = ["VERIFIED", "PENDING", "REJECTED", NO_KYC];
export const RISK_SEGMENTS = ["LOW", "MEDIUM", "HIGH", "UNKNOWN", NO_KYC];

export type Filters = { start: string; end: string; categories: string[]; kyc: string[]; risk: string[] };

export const DEFAULT_FILTERS: Filters = {
  start: "2026-01-01", end: "2026-05-03", categories: CATEGORIES, kyc: KYC_STATUSES, risk: RISK_SEGMENTS,
};

const Ctx = createContext<{ filters: Filters; setFilters: (f: Filters) => void }>({ filters: DEFAULT_FILTERS, setFilters: () => {} });

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  return <Ctx.Provider value={{ filters, setFilters }}>{children}</Ctx.Provider>;
}
export const useFilters = () => useContext(Ctx);

// values only ever come from the fixed lists above or a YYYY-MM-DD date input, so inlining is safe
const lit = (vals: string[]) => vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ") || "''";
const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export function txSql(f: Filters) {
  return `
    select t.*, coalesce(m.merchant_category, 'UNKNOWN') as merchant_category,
           coalesce(k.kyc_status, '${NO_KYC}') as kyc_status, coalesce(k.risk_segment, '${NO_KYC}') as risk_segment
    from transactions t left join merchants m using (merchant_id) left join kyc k using (user_id)
    where "timestamp" >= '${dateOk(f.start) ? f.start : "2026-01-01"}' and "timestamp" < date '${dateOk(f.end) ? f.end : "2026-05-03"}' + interval 1 day
      and coalesce(m.merchant_category, 'UNKNOWN') in (${lit(f.categories)})
      and coalesce(k.kyc_status, '${NO_KYC}') in (${lit(f.kyc)})
      and coalesce(k.risk_segment, '${NO_KYC}') in (${lit(f.risk)})`;
}

// undated chargebacks are always kept - there is no date to exclude them on
export function cbSql(f: Filters) {
  return `
    select c.*, coalesce(m.merchant_category, 'UNKNOWN') as merchant_category,
           coalesce(k.kyc_status, '${NO_KYC}') as kyc_status, coalesce(k.risk_segment, '${NO_KYC}') as risk_segment,
           coalesce(c.transaction_timestamp, c.reported_timestamp) as event_ts
    from chargebacks c left join merchants m using (merchant_id) left join kyc k using (user_id)
    where (coalesce(c.transaction_timestamp, c.reported_timestamp) is null
           or (coalesce(c.transaction_timestamp, c.reported_timestamp) >= '${dateOk(f.start) ? f.start : "2026-01-01"}'
               and coalesce(c.transaction_timestamp, c.reported_timestamp) < date '${dateOk(f.end) ? f.end : "2026-05-03"}' + interval 1 day))
      and coalesce(m.merchant_category, 'UNKNOWN') in (${lit(f.categories)})
      and coalesce(k.kyc_status, '${NO_KYC}') in (${lit(f.kyc)})
      and coalesce(k.risk_segment, '${NO_KYC}') in (${lit(f.risk)})`;
}
