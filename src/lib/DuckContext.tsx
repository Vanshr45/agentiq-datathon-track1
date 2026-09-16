"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { getConnection } from "./duckdb";

type State = { status: "loading" | "ready" | "error"; message: string };
const Ctx = createContext<State>({ status: "loading", message: "" });

export function DuckProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading", message: "Starting" });
  useEffect(() => {
    getConnection((message) => setState({ status: "loading", message }))
      .then(() => setState({ status: "ready", message: "" }))
      .catch((e) => setState({ status: "error", message: String(e) }));
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useDuck = () => useContext(Ctx);
