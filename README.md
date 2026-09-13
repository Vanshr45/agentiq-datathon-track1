# UPI Fraud Ring & Merchant Analytics

TransOrg AgentIQ Datathon — Track 1 (FinTech & BFSI). Built solo.

## What this actually is

The brief was: here's a messy UPI transactions dataset, plus KYC records, merchant data, and chargeback complaints — clean it up, figure out where the fraud risk actually is, and build a dashboard that tells that story. So that's what this repo does. There's a data cleaning pipeline, an analytics layer sitting on DuckDB, a Streamlit dashboard, and (as a bonus) a chat-style agent where you can ask questions in plain English and it'll pull the right chart.

Live dashboard: **https://agentiq-datathon-track1.streamlit.app/**

## How to run it locally

Clone the repo, then:

```
python -m venv venv
source venv/bin/activate       # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

Then run the cleaning notebook in /notebooks/ top to bottom (this regenerates /data/cleaned/), then run:

```
python notebooks/analytics_layer.py
```

That builds analytics.duckdb (it's gitignored on purpose since it's just a build artifact — nothing stops you from regenerating it in a couple minutes).

For the "Ask the data" agent to work, you'll need a free Gemini API key from Google AI Studio. Copy .env.example to .env and drop your key in there.

Then run:

```
streamlit run app/dashboard.py
```

Heads up — the agent runs on Gemini's free tier, so a question usually takes 5–15 seconds to answer, but every once in a while (if Google's servers are busy) it can take up to a minute while it retries or falls back to a different model. That's expected, not a bug.

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

- /data/raw — the original files, untouched
- /data/cleaned — normalized output + cleaning_log.txt (raw vs cleaned row counts, what got flagged and why)
- /notebooks — the cleaning notebook and analytics_layer.py
- /app — the Streamlit dashboard
- /agent — the Gemini-powered natural language agent
- METRICS.md — exact formula for every metric on the dashboard
- DATA_DICTIONARY.md — every column, explained

Built as a solo submission, so if something looks like it could be more polished in one spot vs another, that's why — I prioritized getting the data quality right first, then the dashboard, then the bonus agent, in that order.
