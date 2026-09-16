export const money = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "-" : v >= 1e7 ? `Rs ${(v / 1e7).toFixed(2)} Cr` : `Rs ${Math.round(v).toLocaleString("en-IN")}`;
export const pct = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "-" : `${(v * 100).toFixed(d)}%`);
export const num = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toLocaleString("en-IN"));
export const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
