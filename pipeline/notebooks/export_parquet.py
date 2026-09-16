# one-off: cleaned csvs -> parquet files served by the next.js app
from pathlib import Path
import duckdb

PIPELINE = Path(__file__).resolve().parent.parent
SRC = PIPELINE / "data" / "cleaned"
OUT = PIPELINE.parent / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

FILES = {
    "transactions": "upi_transactions_clean.csv",
    "kyc": "kyc_records_clean.csv",
    "merchants": "merchants_master_clean.csv",
    "chargebacks": "chargebacks_clean.csv",
}

con = duckdb.connect()
TEXT_COLS = {"transactions": {"mcc": "VARCHAR"}, "merchants": {"mcc": "VARCHAR"}, "kyc": {"aadhaar_last4": "VARCHAR"}}
for name, fname in FILES.items():
    # keep mcc / aadhaar_last4 as text so zero padding survives
    types = TEXT_COLS.get(name)
    opts = f", types={types}" if types else ""
    con.execute(f"""
        copy (select * from read_csv('{SRC / fname}', header=true{opts}))
        to '{OUT / name}.parquet' (format parquet, compression zstd)
    """)
    n = con.execute(f"select count(*) from '{OUT / name}.parquet'").fetchone()[0]
    print(f"{name:14s} {n:6d} rows  {(OUT / name).with_suffix('.parquet').stat().st_size / 1024:7.0f} KB")
