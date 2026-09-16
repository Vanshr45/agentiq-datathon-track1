// in-browser duckdb: loads the parquet files from /public/data and builds the analytics views
import * as duckdb from "@duckdb/duckdb-wasm";
import { BASE_TABLES, JOIN_COVERAGE_SQL, VIEW_SQL } from "./views";

export type Row = Record<string, unknown>;
export type QueryResult = { rows: Row[]; columns: string[] };

let dbPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

async function boot(onProgress?: (msg: string) => void) {
  onProgress?.("Starting DuckDB");
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  for (const t of BASE_TABLES) {
    onProgress?.(`Loading ${t}`);
    const buf = await (await fetch(`/data/${t}.parquet`)).arrayBuffer();
    await db.registerFileBuffer(`${t}.parquet`, new Uint8Array(buf));
  }
  const conn = await db.connect();
  for (const t of BASE_TABLES) {
    await conn.query(`create table ${t} as select * from '${t}.parquet'`);
  }
  onProgress?.("Building views");
  await conn.query(JOIN_COVERAGE_SQL);
  for (const v of VIEW_SQL) {
    await conn.query(v.sql);
  }
  return conn;
}

export function getConnection(onProgress?: (msg: string) => void) {
  if (!dbPromise) dbPromise = boot(onProgress);
  return dbPromise;
}

// arrow gives BigInt for 64-bit ints, epoch ms for timestamps, and a 4-word Uint32Array for
// HUGEINT/DECIMAL (which is what sum() over ints returns); flatten everything to plain js numbers
function decimalToNumber(words: Uint32Array, scale: number) {
  let big = BigInt(0);
  for (let i = 3; i >= 0; i--) big = (big << BigInt(32)) | BigInt(words[i]);
  if (big >= BigInt(1) << BigInt(127)) big -= BigInt(1) << BigInt(128);
  return Number(big) / 10 ** scale;
}

function plain(v: unknown, scale: number | null): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.getTime();
  if (v instanceof Uint32Array && v.length === 4) return decimalToNumber(v, scale ?? 0);
  return v;
}

export async function runQuery(sql: string): Promise<QueryResult> {
  const conn = await getConnection();
  const table = await conn.query(sql);
  const fields = table.schema.fields;
  const columns = fields.map((f) => f.name);
  const scales = fields.map((f) => ("scale" in f.type ? (f.type as { scale: number }).scale : null));
  const rows = table.toArray().map((r) => {
    const o = r.toJSON() as Row;
    columns.forEach((k, i) => { o[k] = plain(o[k], scales[i]); });
    return o;
  });
  return { rows, columns };
}
