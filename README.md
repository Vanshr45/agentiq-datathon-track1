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
