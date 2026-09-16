"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { PlotParams } from "react-plotly.js";
import { useTheme } from "@/lib/theme";

// plotly touches window at import time, so it can only load on the client
const Plotly = dynamic(
  async () => {
    const [factory, lib] = await Promise.all([import("react-plotly.js/factory"), import("plotly.js-dist-min")]);
    return factory.default(lib.default);
  },
  { ssr: false, loading: () => <div className="h-[360px] animate-pulse rounded bg-surface-2" /> },
);

export type ChartColors = { neutral: string; red: string; redDeep: string; green: string; light: string; text: string; grid: string; surface: string };

// server fallback only; in the browser the values come from the --chart-* custom properties in globals.css
const FALLBACK: ChartColors = { neutral: "#64748b", red: "#dc2626", redDeep: "#7f1d1d", green: "#16a34a", light: "#cbd5e1", text: "#475569", grid: "#e2e8f0", surface: "#ffffff" };

function readColors(): ChartColors {
  if (typeof window === "undefined") return FALLBACK;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;
  return { neutral: v("--chart-neutral", FALLBACK.neutral), red: v("--chart-red", FALLBACK.red), redDeep: v("--chart-red-deep", FALLBACK.redDeep),
    green: v("--chart-green", FALLBACK.green), light: v("--chart-light", FALLBACK.light), text: v("--chart-text", FALLBACK.text),
    grid: v("--chart-grid", FALLBACK.grid), surface: v("--surface", FALLBACK.surface) };
}

// trace colours for the current theme; re-read whenever the toggle flips
export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- theme is the invalidation key, the values live in CSS
  return useMemo(readColors, [theme]);
}

export const baseLayout = { margin: { l: 50, r: 20, t: 30, b: 40 }, font: { family: "inherit", size: 12 } };

export default function Plot(props: PlotParams) {
  const c = useChartColors();
  // a plotly template applies to every axis (xaxis, xaxis2, yaxis2...) without the pages having to repeat it
  const template = useMemo<Partial<Plotly.Template>>(() => ({ layout: {
    paper_bgcolor: c.surface, plot_bgcolor: c.surface,
    font: { color: c.text },
    xaxis: { gridcolor: c.grid, zerolinecolor: c.grid, linecolor: c.grid, tickcolor: c.grid, tickfont: { color: c.text }, title: { font: { color: c.text } } },
    yaxis: { gridcolor: c.grid, zerolinecolor: c.grid, linecolor: c.grid, tickcolor: c.grid, tickfont: { color: c.text }, title: { font: { color: c.text } } },
    legend: { font: { color: c.text } },
    title: { font: { color: c.text } },
    hoverlabel: { font: { color: c.text }, bgcolor: c.surface, bordercolor: c.grid },
  } }), [c]);
  return <Plotly {...props} layout={{ template, ...props.layout }} useResizeHandler style={{ width: "100%", height: "100%" }}
    config={{ displaylogo: false, responsive: true, ...(props.config ?? {}) }} />;
}
