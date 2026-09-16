// WCAG AA contrast check for every text/background pair the dashboard uses, in both themes.
// Reads the token values straight out of src/app/globals.css so it checks what actually ships.
//   node scripts/contrast-check.mjs   (exit 1 on any failure)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/app/globals.css"), "utf8");
const block = (sel) => Object.fromEntries([...css.match(new RegExp(`${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
const themes = { light: block(":root"), dark: block(".dark") };

const lum = (hex) => { const [r, g, b] = hex.slice(1).match(/../g).map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const BODY = 4.5, LARGE = 3, GRAPHIC = 3;
// [where, foreground token, background token, minimum]
const PAIRS = [
  ["sidebar: title / active nav item", "fg", "surface-2", BODY],
  ["sidebar: inactive nav item", "muted", "surface", BODY],
  ["sidebar: nav icons, 12px", "faint", "surface", BODY],
  ["sidebar: toggle + footer text", "muted", "surface", BODY],
  ["sidebar: toggle text on hover", "muted", "surface-2", BODY],
  ["header: page title (large)", "fg", "page", LARGE],
  ["header: subtitle / section sub", "muted", "page", BODY],
  ["header: filter labels", "muted", "surface", BODY],
  ["header: active filter chip", "risk-fg", "risk-bg", BODY],
  ["header: removed filter chip", "faint", "surface", BODY],
  ["header: help text under chips", "faint", "surface", BODY],
  ["page: section headings", "fg", "page", BODY],
  ["page: cluster labels, 12px", "faint", "page", BODY],
  ["table: body cells", "fg", "surface", BODY],
  ["table: header row", "muted", "surface-2", BODY],
  ["table: flagged value (red)", "risk-strong", "surface", BODY],
  ["table: valid flag (green)", "ok-strong", "surface", BODY],
  ["table: 'not in merchant master'", "faint", "surface", BODY],
  ["kpi: number (30px)", "fg", "surface", LARGE],
  ["kpi: label, 12px", "faint", "surface", BODY],
  ["kpi: plain-language note, 12px", "muted", "surface", BODY],
  ["callout warn: red box text", "risk-fg", "risk-bg", BODY],
  ["callout info: text", "fg", "surface-2", BODY],
  ["ask: primary button", "page", "fg", BODY],
  ["ask: summary box", "fg", "surface-2", BODY],
  ["ask: note box", "risk-fg", "risk-bg", BODY],
  ["chart: tick labels, axis titles, legend", "chart-text", "surface", BODY],
  ["chart: neutral line/bar (graphic)", "chart-neutral", "surface", GRAPHIC],
  ["chart: red line/bar (graphic)", "chart-red", "surface", GRAPHIC],
  ["chart: deep red rate line (graphic)", "chart-red-deep", "surface", GRAPHIC],
  ["chart: green line (graphic)", "chart-green", "surface", GRAPHIC],
];

let bad = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n== ${name} ==`);
  for (const [where, fg, bg, min] of PAIRS) {
    const r = ratio(t[fg], t[bg]); const ok = r >= min; if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"} ${r.toFixed(2).padStart(6)}:1  need ${min}  ${where.padEnd(42)} ${fg} ${t[fg]} on ${bg} ${t[bg]}`);
  }
  console.log(`info ${ratio(t["chart-light"], t.surface).toFixed(2).padStart(6)}:1  de-emphasised bars (intentionally faint, value-labelled)`);
}
console.log(bad ? `\n${bad} FAILURES` : "\nall pairs pass WCAG AA");
process.exit(bad ? 1 : 0);
