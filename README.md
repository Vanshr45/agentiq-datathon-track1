# UPI Fraud Ring & Merchant Analytics

TransOrg AgentIQ Datathon — Track 1 (FinTech & BFSI). Built solo.

<p align="center"> <a href="https://track1-fintech-dataset-files.vercel.app/"> <img src="https://img.shields.io/badge/LIVE_DASHBOARD-Open_App-2d5d4f?style=for-the-badge" alt="Live Dashboard"> </a> </p> <p align="center"> <b>Live dashboard:</b> <a href="https://track1-fintech-dataset-files.vercel.app/">track1-fintech-dataset-files.vercel.app</a><br> <b>Repository:</b> <a href="https://github.com/Vanshr45/agentiq-datathon-track1">github.com/Vanshr45/agentiq-datathon-track1</a> </p>

## What this actually is

The brief was: here's a messy UPI transactions dataset, plus KYC records, merchant data, and chargeback complaints — clean it up, figure out where the fraud risk actually is, and build something that tells that story to someone who has to make decisions about it. So that's what this repo does. There's a data cleaning pipeline, an analytics layer sitting on DuckDB, an interactive dashboard, and (as a bonus) a chat-style agent where you can ask questions in plain English and it pulls the right chart.

Everything below is organized the same way I actually built it — in stages, matching the 4-layer structure the datathon asked for, plus the setup and polish work around it.

## How the work breaks down

| Stage | What it covers | Status |
|---|---|---|
| Stage 0 — Setup | Repo structure, environment, dependencies | Done |
| Stage 1 — Data Rescue (Core) | Cleaning all 4 raw files: fixing IDs, amounts, dates, status values; handling duplicates and broken relationships | Done |
| Stage 2 — Analytics Layer (Core) | DuckDB views for every business metric (revenue, chargeback ratio, risk scores), with every formula documented | Done |
| Stage 3 — Executive Dashboard (Core) | Interactive dashboard — KPIs, filters, trend charts, high-risk merchant/user tables, a dedicated data-quality section | Done |
| Stage 4 — Bonus: Agentic Graph AI | Natural-language question → validated SQL → correct chart type → plain-language summary, powered by Gemini | Done |
| Stage 5 — Documentation & Polish | README, data dictionary, metrics reference, fresh-clone reproducibility check, demo materials | Done |

This mirrors the datathon's own structure: Data Rescue and Analytics Layer and Executive Dashboard were the three core layers, and the Agentic Graph AI was the optional bonus layer on top. I did all four, plus the setup and documentation stages around them.

## How to run it locally

```
git clone https://github.com/Vanshr45/agentiq-datathon-track1
cd agentiq-datathon-track1
```

The data pipeline (Python — cleaning and analytics):

```
python -m venv venv
source venv/bin/activate       # or venv\Scripts\activate on Windows
pip install -r pipeline/requirements.txt
```

Run the cleaning notebook in /pipeline/notebooks/ top to bottom (this regenerates /pipeline/data/cleaned/), then:

```
python pipeline/notebooks/analytics_layer.py
python pipeline/notebooks/export_parquet.py
```

Before running the cleaning notebook, place the 4 provided raw files (track1_upi_transactions.csv, track1_kyc_records.csv, track1_merchants_master.csv, track1_chargebacks.json) into /pipeline/data/raw/ — this folder is empty in the repo since raw data isn't committed.

The dashboard (Next.js — runs entirely in the browser via DuckDB-WASM, no backend server needed):

```
npm install
npm run dev
```

For the "Ask the data" agent to work locally, you'll need a free Gemini API key from Google AI Studio. Add it as GEMINI_API_KEY in a .env.local file.

## Data dictionary

Full column-by-column breakdown of every raw and cleaned field is in DATA_DICTIONARY.md.

## What I actually found while cleaning this

This is the part I think matters more than the dashboard itself, honestly.

**The join coverage is really low, and that's not a mistake.** Only about 32% of transactions link to a KYC record by user_id, and about 48% link to a merchant record. I checked this multiple times because it felt too low to be right, but it holds up after normalizing every ID format I could find (spaces, hyphens, casing, missing prefixes — all of it). It's just how the raw sample was built. I decided not to hide this or quietly work around it — the dashboard has a whole "data quality" section that states it plainly, because I think pretending the coverage is better than it is would be worse than admitting it.

**The chargeback file's txn_id field is basically useless for linking.** This was the thing that actually surprised me. The brief implies chargebacks link to transactions through txn_id, but when I checked the ones that do match, zero of them agree on merchant_id, user_id, or amount with the transaction they supposedly point to. Not "mostly agree" — zero. The timestamps are also off by a median of 26 days. So instead of trusting that link, every chargeback metric in this project uses the chargeback record's own merchant_id and user_id instead. I think this is the most interesting thing I found in the whole dataset, and I made sure it's called out both on the dashboard and in the agent's answers when it's relevant.

**Merchant and user IDs weren't always unique — sometimes the same ID described two different businesses or people entirely.** For example MCH1007 shows up as both a restaurant in Jaipur and a hotel in Chennai under two different records. Since a master table has to be unique on its key or every join downstream breaks, I kept the most complete record for each ID (using the latest onboarding/signup date as a tiebreaker) and wrote every conflicting record out to a separate *_id_conflicts.csv file instead of just deleting them. No entities were actually lost — the unique ID counts are identical before and after (28,920 users, 4,343 merchants).

**Picking the high-risk merchant threshold wasn't as simple as "just pick a number."** I looked at how many merchants had 0, 1, 2, 3... chargebacks, and there's a real gap in the distribution — nobody has 5 through 12 chargebacks, then it jumps straight to 13+. So the threshold (5+ chargebacks AND a ratio at least double the overall rate) isn't arbitrary, it's sitting right in that gap. Anywhere from 5 to 13 as a floor gives you the exact same 28 merchants, which is a nice sanity check that it's not sensitive to the exact number I picked.

One more thing worth flagging: some individual merchant ratios go above 1.0 (one hits 30.0). That's not broken math — it means the chargeback file recorded more disputes for that merchant than the 20,000-row transaction sample happened to capture for them. The category-level averages stay well under 1.0 since they pool many merchants together; it's only the individual merchant numbers that can look extreme, and the dashboard flags this directly wherever those numbers show up.

## What's in each stage

- /pipeline/data/raw — the original files, untouched (not committed)
- /pipeline/data/cleaned — normalized output + cleaning_log.txt (raw vs cleaned row counts, what got flagged and why)
- /pipeline/notebooks — the cleaning notebook, analytics_layer.py, and export_parquet.py (writes the Parquet files the dashboard loads)
- /pipeline/requirements.txt — Python dependencies for the pipeline
- /src/app — the Next.js dashboard pages, plus the Gemini agent endpoint at /src/app/api/ask
- /src/components — the UI pieces (sidebar, header and filters, KPI cards, charts)
- /src/lib — DuckDB-WASM setup, the 12 SQL views, filter logic, and the agent's client-side SQL validation
- /public/data — the cleaned data as Parquet, loaded by the browser
- METRICS.md — exact formula for every metric on the dashboard
- DATA_DICTIONARY.md — every column, explained

Built as a solo submission, so if something looks like it could be more polished in one spot vs another, that's why — I prioritized getting the data quality right first, then the analytics layer, then the dashboard, then the bonus agent, in that order.
