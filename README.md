# AgentIQ Datathon — Track 1: UPI Fraud Ring & Merchant Analytics

TransOrg AgentIQ Datathon submission (FinTech & BFSI track).

## Structure

```
data/raw/       raw input files (not committed)
data/cleaned/   cleaned datasets, cleaning log, id-conflict audit files
notebooks/      01_data_cleaning.ipynb, utils.py, analytics_layer.py
app/            Streamlit dashboard
agent/          analytics agent
METRICS.md      how every metric is computed and why
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Reproduce

```bash
# stage 1: clean the raw files (needs data/raw/ populated)
cd notebooks && jupyter nbconvert --to notebook --execute --inplace 01_data_cleaning.ipynb && cd ..

# stage 2: build data/analytics.duckdb from data/cleaned/
python notebooks/analytics_layer.py

# stage 3: dashboard (builds the duckdb file itself if it is missing)
streamlit run app/dashboard.py
```

`data/analytics.duckdb` is gitignored; both the script and the dashboard regenerate it from the cleaned CSVs.

## Ask the data (Gemini agent)

The "Ask the data" section turns plain-English questions into a read-only DuckDB query and a Plotly chart using
Gemini (`google-genai` SDK, `gemini-3.5-flash` by default with automatic fallback). It needs an API key:

```bash
cp .env.example .env   # then set GEMINI_API_KEY
```

On Streamlit Community Cloud, add `GEMINI_API_KEY` under the app's Settings > Secrets instead.

Latency note: the agent runs on the Gemini free tier. A question normally takes 5 to 15 seconds (two model calls),
but the free tier throttles to a few requests per minute and the model is sometimes reported as busy. When that
happens the agent retries with backoff and falls back to a lighter model, so an answer can take up to about a minute.
