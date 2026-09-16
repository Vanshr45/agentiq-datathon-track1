"use client";
import dynamic from "next/dynamic";
import type { PlotParams } from "react-plotly.js";

// plotly touches window at import time, so it can only load on the client
const Plotly = dynamic(
  async () => {
    const [factory, lib] = await Promise.all([import("react-plotly.js/factory"), import("plotly.js-dist-min")]);
    return factory.default(lib.default);
  },
  { ssr: false, loading: () => <div className="h-[360px] animate-pulse rounded bg-slate-100" /> },
);

export default function Plot(props: PlotParams) {
  return <Plotly {...props} useResizeHandler style={{ width: "100%", height: "100%" }}
    config={{ displaylogo: false, responsive: true, ...(props.config ?? {}) }} />;
}

export const NEUTRAL = "#64748b", RED = "#dc2626", GREEN = "#16a34a", LIGHT = "#cbd5e1";
export const baseLayout = { margin: { l: 50, r: 20, t: 30, b: 40 }, font: { family: "inherit", size: 12 }, paper_bgcolor: "white", plot_bgcolor: "white" };
