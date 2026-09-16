# Data dictionary

One row per column for every raw input and every cleaned output. Raw files live in `pipeline/data/raw/` (not committed);
cleaned files are in `pipeline/data/cleaned/` and are produced by `pipeline/notebooks/01_data_cleaning.ipynb` using the helpers in
`pipeline/notebooks/utils.py`. Row counts and per-flag counts are in `pipeline/data/cleaned/cleaning_log.txt`.

Conventions used throughout the cleaned files:

- Ids are canonical: `USR` + 5 digits, `MCH` + 4 digits, `TXN` + 8 digits, `CBK` + 7 digits. Any raw spelling
  (lower case, spaces, hyphens, underscores, bare digits, unpadded digits) maps to the same canonical form.
- Timestamps are ISO `YYYY-MM-DD HH:MM:SS`. Raw values came in ISO, `DD/MM/YYYY`, `DD/MM/YYYY hh:mm AM`,
  `MM-DD-YYYY`, `MM-DD-YYYY hh:mm:ss AM`, `YYYY/MM/DD`, `DD-Mon-YYYY` and Unix epoch seconds (negative for
  pre-1970 dates of birth). Unparseable or blank values are empty, never guessed.
- Amounts are floats in rupees. Raw values had `Rs.`, `INR`, the rupee symbol, thousands separators and `27.3k`
  style shorthand. Blank or non-numeric values (`Not Available`) are empty, never zero.
- Status-like columns are mapped through explicit dictionaries in `utils.py`; nothing is fuzzy-matched.
- Nothing is dropped for being messy. Problems are kept and marked with a boolean `*_valid` / `*_missing` /
  `*_negative` flag column. The only rows removed are exact duplicates (after normalisation) and, for the two
  master tables, non-canonical duplicates of an id, which are moved to a side file rather than deleted.

---

## 1. UPI transactions

### Raw: `track1_upi_transactions.csv` (20,400 rows)

| column | meaning | mess observed |
|---|---|---|
| txn_id | transaction identifier | 400 exact duplicate rows |
| timestamp | when the transaction happened | 5 formats incl. epoch and 12-hour clock |
| user_id | paying customer | consistent `USR#####` in this file |
| merchant_id | receiving merchant | consistent `MCH####` in this file |
| amount | transaction value | currency prefixes, commas, 420 negatives |
| utr | UPI transaction reference | spaces inside, 1,000 blank |
| mcc | merchant category code | leading zeros, 2,926 blank |
| status | outcome | 14 spellings of success/failed/pending |

### Cleaned: `upi_transactions_clean.csv` (20,000 rows)

| column | type | meaning | cleaning applied |
|---|---|---|---|
| txn_id | str | canonical transaction id | `normalize_id`, width 8 |
| timestamp | datetime | transaction time | `parse_flexible_date` |
| user_id | str | canonical user id | `normalize_id`, width 5 |
| merchant_id | str | canonical merchant id | `normalize_id`, width 4 |
| amount | float | value in rupees, sign preserved | `parse_amount` |
| utr | str | reference with spaces/hyphens removed, upper case | blank kept as empty |
| mcc | str | 4-digit MCC, zero-padded | leading zeros stripped then re-padded; blank stays empty |
| status | str | `SUCCESS` / `FAILED` / `PENDING` | `TXN_STATUS` map (`S`, `Initiated`, `F` etc. included) |
| is_negative_flag | bool | amount is below zero | negatives kept as possible reversals, not fixed |
| amount_missing | bool | amount could not be parsed | 0 rows in this dataset |
| timestamp_missing | bool | timestamp could not be parsed | 0 rows |
| utr_valid | bool | utr matches `UTR` + 10 digits | false only for the 1,000 blanks |
| mcc_missing | bool | mcc blank in raw | 2,872 rows after dedup |
| txn_id_duplicate | bool | txn_id appears more than once with differing content | 0 rows after removing exact duplicates |

---

## 2. KYC records

### Raw: `track1_kyc_records.csv` (36,400 rows)

| column | meaning | mess observed |
|---|---|---|
| user_id | customer identifier | 5 spellings (`USR 12345`, `usr_12345`, bare digits...) |
| full_name | customer name | case noise |
| pan | PAN number | spaces, hyphens, lower case, missing suffix letter, blanks |
| aadhaar | Aadhaar number | spaces, hyphens, pre-masked `XXXX-XXXX-1234`, 10/13-digit values, blanks |
| date_of_birth | date of birth | 7 formats incl. negative epochs |
| city | city | abbreviations and old names (BLR, Bombay, Poona, LKO...) |
| state | state | clean |
| monthly_income | declared monthly income | currency noise, `39.5k`, `Not Available`, negatives |
| occupation | occupation | clean |
| signup_timestamp | account creation time | mixed formats, blanks |
| kyc_status | verification state | 16 spellings incl. `V`, `P`, `R`, `KYC_DONE`, `Under Review` |
| risk_segment | internal risk band | case noise; `UNKNOWN` is a real value |

### Cleaned: `kyc_records_clean.csv` (28,920 rows, one per user)

| column | type | meaning | cleaning applied |
|---|---|---|---|
| user_id | str | canonical user id | `normalize_id`, width 5 |
| full_name | str | name, title case | whitespace and case only |
| pan | str | PAN, upper case, no separators | separators stripped |
| pan_valid | bool | matches `[A-Z]{5}[0-9]{4}[A-Z]` | 3,469 false (1,328 blank, rest malformed) |
| aadhaar_last4 | str | last four digits only | the full number is never stored anywhere downstream |
| aadhaar_valid | bool | raw value was a clean 12-digit number | pre-masked and 10/13-digit values are false |
| aadhaar_premasked | bool | raw value arrived already masked as `XXXX-XXXX-1234` | kept so "unverifiable" is distinguishable from "wrong" |
| date_of_birth | datetime | date of birth | `parse_flexible_date`; negative epochs accepted |
| city | str | canonical city name | title case plus alias map (`CITY_ALIASES`), 12 cities result |
| state | str | state | title case |
| monthly_income | float | declared income in rupees | `parse_amount` |
| occupation | str | occupation | title case |
| signup_timestamp | datetime | signup time | `parse_flexible_date` |
| kyc_status | str | `VERIFIED` / `PENDING` / `REJECTED` | `KYC_STATUS` map |
| risk_segment | str | `LOW` / `MEDIUM` / `HIGH` / `UNKNOWN` | `RISK_SEGMENT` map |
| income_valid | bool | income present and not negative | negative income has no meaning, unlike a negative transaction |
| income_missing | bool | income blank or unparseable | includes `Not Available` |
| dob_missing | bool | date of birth blank or unparseable | |
| signup_missing | bool | signup timestamp blank or unparseable | |

Side file `kyc_records_id_conflicts.csv` (6,994 rows): records sharing a `user_id` with a different, more
complete record. Same columns as the cleaned file. Not used by any join.

---

## 3. Merchants master

### Raw: `track1_merchants_master.csv` (6,210 rows)

| column | meaning | mess observed |
|---|---|---|
| merchant_id | merchant identifier | 4 spellings |
| merchant_name | legal / trading name | surrounding whitespace, digit-for-letter typos left as-is |
| mcc | merchant category code | `MCC-5411`, `5411.0`, `05411`, `misc`, `NA`, `UNKNOWN`, blanks |
| merchant_category | free-text category | 80 spellings of 10 categories |
| business_type | legal form | `PRIVATE_LIMITED` / `Private Limited` / `PRIVATE-LIMITED` etc. |
| city | city | same aliases as KYC |
| state | state | clean |
| onboarding_date | date merchant joined | mixed formats, blanks |
| settlement_account | payout account | full account numbers, IFSC-prefixed numbers, pre-masked, `NA`, blanks |
| merchant_status | live or not | 15 spellings incl. `A`, `I`, `S`, `Hold`, `Blocked` |
| declared_avg_ticket_size | self-declared average order value | currency noise, negatives, blanks |

### Cleaned: `merchants_master_clean.csv` (4,343 rows, one per merchant)

| column | type | meaning | cleaning applied |
|---|---|---|---|
| merchant_id | str | canonical merchant id | `normalize_id`, width 4 |
| merchant_name | str | name with whitespace collapsed | no spelling correction |
| mcc | str | 4-digit MCC | `normalize_mcc`; blank/garbage back-filled from category (see `mcc_inferred`) |
| merchant_category | str | one of 10 canonical categories | `MERCHANT_CATEGORY` map |
| business_type | str | `INDIVIDUAL` / `PARTNERSHIP` / `SOLE_PROPRIETOR` / `PRIVATE_LIMITED` | `BUSINESS_TYPE` map |
| city | str | canonical city | alias map |
| state | str | state | title case |
| onboarding_date | datetime | onboarding date | `parse_flexible_date` |
| settlement_account_last4 | str | `XXXX` + last four digits | full account never stored; `NA`/blank become empty |
| merchant_status | str | `ACTIVE` / `INACTIVE` | `MERCHANT_STATUS` map (suspended, blocked, hold, closed all -> INACTIVE) |
| declared_avg_ticket_size | float | declared average ticket in rupees, sign preserved | `parse_amount` |
| mcc_inferred | bool | mcc was blank/garbage and filled from merchant_category | 464 rows; existing MCCs are never overwritten |
| mcc_missing | bool | mcc still unknown after back-fill | 0 rows |
| ticket_size_negative | bool | declared ticket below zero | flagged for review, not nulled |
| ticket_size_missing | bool | declared ticket blank or unparseable | |
| settlement_account_missing | bool | no usable account digits in raw | |
| onboarding_missing | bool | onboarding date blank or unparseable | |

Side file `merchants_master_id_conflicts.csv` (1,749 rows): records sharing a `merchant_id` with a different,
more complete record. Same columns as the cleaned file. Not used by any join.

---

## 4. Chargebacks

### Raw: `track1_chargebacks.json` (2,884 records, array of objects, every value a string)

| field | meaning | mess observed |
|---|---|---|
| complaint_id | complaint identifier | 84 exact duplicates |
| txn_id | transaction the complaint refers to | short form `TXN12345`, hyphenated, 81 blank |
| user_id | complaining customer | 5 spellings |
| merchant_id | merchant complained about | 4 spellings |
| transaction_timestamp | when the disputed transaction happened (per the complaint) | mixed formats, blanks |
| reported_timestamp | when the complaint was raised | mixed formats, blanks |
| disputed_amount | amount in dispute | currency noise, blanks, negatives |
| reason_code | free-text reason | 34 spellings of 7 themes |
| complaint_text | narrative | clean |
| resolution_status | where the case stands | 13 spellings |
| bank_response_timestamp | when the bank responded | mixed formats, 718 blank |
| severity | priority | text labels, `P1`-`P4`, single letters, `CRIT` |
| channel | how the complaint came in | case noise |

### Cleaned: `chargebacks_clean.csv` (2,800 rows)

| column | type | meaning | cleaning applied |
|---|---|---|---|
| complaint_id | str | canonical complaint id | `normalize_id`, width 7 |
| txn_id | str | canonical transaction id | `normalize_id`, width 8 (pads short forms so they can join) |
| user_id | str | canonical user id | `normalize_id`, width 5 |
| merchant_id | str | canonical merchant id | `normalize_id`, width 4 |
| disputed_amount | float | amount in dispute, sign preserved | `parse_amount`; blank -> empty, never zero |
| reason_code | str | raw reason text, trimmed | kept verbatim |
| reason_category | str | one of 7 grouped reasons | `REASON_CATEGORY` map |
| complaint_text | str | narrative | trimmed |
| resolution_status | str | `OPEN` / `IN_PROGRESS` / `PENDING_BANK` / `RESOLVED` / `CLOSED` / `REJECTED` | `RESOLUTION_STATUS` map |
| severity | str | `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` | `SEVERITY` map: P1->CRITICAL, P2->HIGH, P3->MEDIUM, P4->LOW, H/M/L, CRIT |
| channel | str | `EMAIL` / `BRANCH` / `IVR` / `CHATBOT` / `APP` / `CALL_CENTER` | `CHANNEL` map |
| reported_timestamp | datetime | when raised | `parse_flexible_date` |
| transaction_timestamp | datetime | when the disputed transaction happened | `parse_flexible_date` |
| bank_response_timestamp | datetime | bank response time | `parse_flexible_date` |
| disputed_amount_missing | bool | amount blank or unparseable | 179 rows; counted as complaints, excluded from amount sums |
| disputed_amount_negative | bool | amount below zero | 220 rows; excluded from amount sums |
| txn_id_missing | bool | no transaction id on the complaint | 77 rows |
| reported_ts_missing | bool | reported timestamp missing | |
| txn_ts_missing | bool | transaction timestamp missing | |
| bank_response_missing | bool | bank response timestamp missing | |
| reported_before_txn | bool | report predates the transaction | 92 rows; impossible ordering, excluded from delay metrics |
| complaint_id_duplicate | bool | complaint_id repeats with differing content | 0 rows after removing exact duplicates |

---

## 5. Derived: `pipeline/data/analytics.duckdb`

Built by `pipeline/notebooks/analytics_layer.py` from the four cleaned files (plus the two conflict files, loaded for audit
only). Base tables are `transactions`, `kyc`, `merchants`, `chargebacks`, and a `join_coverage` table records the
match rate of every join. The metric views and their formulas are documented in `METRICS.md`.
