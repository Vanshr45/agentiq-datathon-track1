"use client";
import { useEffect, useState } from "react";
import { useDuck } from "./DuckContext";
import { runQuery, Row } from "./duckdb";

// runs once the browser db is ready and again whenever the sql changes
export function useQuery(sql: string | null) {
  const duck = useDuck();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (duck.status !== "ready" || !sql) return;
    let live = true;
    runQuery(sql).then((r) => live && setRows(r.rows)).catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [duck.status, sql]);
  return { rows, error, loading: rows === null && !error };
}
