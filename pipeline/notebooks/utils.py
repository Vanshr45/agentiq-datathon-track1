# shared cleaning helpers for stage 1
import re
from datetime import datetime
import pandas as pd


def _blank(value):
    if value is None:
        return True
    if isinstance(value, float) and value != value:
        return True
    return str(value).strip().lower() in ("", "nan", "none", "null", "na", "n/a", "not available")


def normalize_id(value, prefix, width=None):
    if _blank(value):
        return None
    digits = re.sub(r"\D", "", str(value))
    if not digits:
        return None
    if width:
        digits = digits.zfill(width)
    return prefix + digits


_amount_junk = re.compile(r"(rs\.?|inr|₹|,|\s)", re.I)

def parse_amount(value):
    if _blank(value):
        return float("nan")
    s = _amount_junk.sub("", str(value))
    mult = 1
    if s.lower().endswith("k"):
        s, mult = s[:-1], 1000
    try:
        return round(float(s) * mult, 2)
    except ValueError:
        return float("nan")


# order matters: more specific patterns first
_DATE_FORMATS = [
    (re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$"), "%Y-%m-%d %H:%M:%S"),
    (re.compile(r"^\d{4}-\d{2}-\d{2}$"), "%Y-%m-%d"),
    (re.compile(r"^\d{4}/\d{2}/\d{2}$"), "%Y/%m/%d"),
    (re.compile(r"^\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}$"), "%d/%m/%Y %H:%M:%S"),
    (re.compile(r"^\d{2}/\d{2}/\d{4} \d{2}:\d{2} [AP]M$"), "%d/%m/%Y %I:%M %p"),
    (re.compile(r"^\d{2}/\d{2}/\d{4}$"), "%d/%m/%Y"),
    (re.compile(r"^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2} [AP]M$"), "%m-%d-%Y %I:%M:%S %p"),
    (re.compile(r"^\d{2}-\d{2}-\d{4}$"), "%m-%d-%Y"),
    (re.compile(r"^\d{2}-[A-Za-z]{3}-\d{4}$"), "%d-%b-%Y"),
]

# slash dates are DD/MM and dash dates are MM-DD in this dataset - verified by checking
# that the day component reaches 31 in one and month never exceeds 12 in the other.
# epoch window covers 1940 to 2035; negative epochs are real (pre-1970 dates of birth).
def parse_flexible_date(value):
    if _blank(value):
        return pd.NaT
    s = str(value).strip()
    if re.fullmatch(r"-?\d{6,10}", s):
        ts = int(s)
        if -950_000_000 <= ts <= 2_050_000_000:
            return pd.Timestamp(ts, unit="s")
        return pd.NaT
    for pattern, fmt in _DATE_FORMATS:
        if pattern.match(s):
            try:
                return pd.Timestamp(datetime.strptime(s, fmt))
            except ValueError:
                return pd.NaT
    return pd.NaT


def _key(value):
    return re.sub(r"[\s\-]+", "_", str(value).strip().upper())

def normalize_status(value, mapping_dict):
    if _blank(value):
        return None
    return mapping_dict.get(_key(value))

def build_map(groups):
    return {_key(v): canon for canon, variants in groups.items() for v in variants}


TXN_STATUS = build_map({
    "SUCCESS": ["SUCCESS", "S", "TXN_SUCCESS", "COMPLETED"],
    "FAILED": ["FAILED", "FAIL", "F", "TXN_FAILED", "DECLINED"],
    "PENDING": ["PENDING", "PROCESSING", "INITIATED"],
})

KYC_STATUS = build_map({
    "VERIFIED": ["DONE", "KYC_DONE", "VERIFIED", "V", "APPROVED"],
    "PENDING": ["PENDING", "P", "IN_PROGRESS", "UNDER_REVIEW"],
    "REJECTED": ["REJECT", "REJECTED", "R", "FAILED"],
})

MERCHANT_STATUS = build_map({
    "ACTIVE": ["ACTIVE", "A", "LIVE", "ENABLED"],
    "INACTIVE": ["INACTIVE", "I", "SUSPENDED", "S", "DISABLED", "CLOSED", "HOLD", "BLOCKED"],
})

# Severity: raw data mixes labels, P-codes and single letters. P1-P4 are mapped in
# priority order (P1 = most urgent = CRITICAL). The raw frequency distribution backs this:
# P1 (65) ~ CRITICAL labels (~50), P2 (167) ~ HIGH (~150), P3 (272) ~ MEDIUM (~260),
# P4 (249) ~ LOW (~245). Single letters H/M/L are unambiguous; CRIT -> CRITICAL.
SEVERITY = build_map({
    "CRITICAL": ["CRITICAL", "CRIT", "C", "P1"],
    "HIGH": ["HIGH", "H", "P2"],
    "MEDIUM": ["MEDIUM", "MED", "M", "P3"],
    "LOW": ["LOW", "L", "P4"],
})

RISK_SEGMENT = build_map({
    "LOW": ["LOW"], "MEDIUM": ["MEDIUM", "MED"], "HIGH": ["HIGH"], "UNKNOWN": ["UNKNOWN"],
})

BUSINESS_TYPE = build_map({
    "INDIVIDUAL": ["INDIVIDUAL"],
    "PARTNERSHIP": ["PARTNERSHIP"],
    "SOLE_PROPRIETOR": ["SOLE_PROPRIETOR", "SOLE PROPRIETOR", "SOLE-PROPRIETOR", "PROPRIETORSHIP"],
    "PRIVATE_LIMITED": ["PRIVATE_LIMITED", "PRIVATE LIMITED", "PRIVATE-LIMITED", "PVT LTD", "PVT_LTD"],
})

RESOLUTION_STATUS = build_map({
    "OPEN": ["OPEN"],
    "IN_PROGRESS": ["IN_PROGRESS", "IN PROGRESS", "WIP"],
    "PENDING_BANK": ["PENDING_BANK", "PENDING BANK"],
    "RESOLVED": ["RESOLVED"],
    "CLOSED": ["CLOSED"],
    "REJECTED": ["REJECTED"],
})

CHANNEL = build_map({
    "EMAIL": ["EMAIL"], "BRANCH": ["BRANCH"], "IVR": ["IVR"], "CHATBOT": ["CHATBOT"],
    "APP": ["APP", "MOBILE APP"], "CALL_CENTER": ["CALL_CENTER", "CALL CENTER", "CALL CENTRE"],
})

# 10 canonical categories, one per MCC in the dataset
MERCHANT_CATEGORY = build_map({
    "GROCERY": ["GROCERY", "GROCERIES", "GROCERY STORE", "GROCERY STORES", "GROCERY_STORE", "KIRANA"],
    "RESTAURANT": ["RESTAURANT", "RESTAURANTS", "FOOD", "FOOD_SERVICES", "FOOD SERVICES", "EATING PLACE"],
    "HOTEL": ["HOTEL", "HOTELS", "HOTEL_LODGING", "HOTEL LODGING", "HOSPITALITY"],
    "TRANSPORT": ["TRANSPORT", "TRANSPORTATION", "TRANSPRT", "BUS/TAXI", "TRAVEL"],
    "TELECOM": ["TELECOM", "MOBILE RECHARGE", "PHONE SERVICE"],
    "DEPARTMENT_STORE": ["DEPARTMENT STORE", "DEPARTMENT STORES", "DEPT_STORE", "DEPT STORE", "RETAIL"],
    "APPAREL": ["APPAREL", "CLOTHING", "CLOTHS", "GARMENTS", "FASHION"],
    "PHARMACY": ["PHARMACY", "PHARMACIES", "CHEMIST", "MEDICAL", "MEDICAL_STORE", "MEDICAL STORE"],
    "MISC_RETAIL": ["MISC RETAIL", "MISCELLANEOUS", "OTHER", "RETAIL OTHER"],
    "BOOKS_STATIONERY": ["BOOKS", "BOOK STORE", "BOOKS_STATIONERY", "BOOKS STATIONERY", "STATIONERY"],
})

CATEGORY_TO_MCC = {
    "GROCERY": "5411", "RESTAURANT": "5812", "HOTEL": "7011", "TRANSPORT": "4131",
    "TELECOM": "4814", "DEPARTMENT_STORE": "5311", "APPAREL": "5699", "PHARMACY": "5912",
    "MISC_RETAIL": "5999", "BOOKS_STATIONERY": "5942",
}

# free-text reason codes grouped into 6 buckets; raw reason_code is kept alongside
REASON_CATEGORY = build_map({
    "UNAUTHORIZED": ["UNAUTHORIZED TRANSACTION", "UNAUTHORIZED_TRANSACTION", "UNAUTHORISED", "UNAUTH TXN", "NOT DONE BY ME"],
    "ACCOUNT_TAKEOVER": ["ATO", "ACCOUNT TAKEOVER", "ACCOUNT HACKED", "LOGIN COMPROMISED"],
    "FRAUD": ["FRAUD", "FRAUD SUSPECTED", "SCAM", "SUSPICIOUS TRANSACTION"],
    "DUPLICATE_DEBIT": ["DUP_DEBIT", "DUPLICATE DEBIT", "CHARGED TWICE", "DOUBLE DEBIT"],
    "AMOUNT_MISMATCH": ["WRONG AMOUNT", "AMOUNT MISMATCH", "INCORRECT AMOUNT", "EXTRA AMOUNT DEDUCTED"],
    "SERVICE_NOT_DELIVERED": ["MERCHANT NOT DELIVERED", "SERVICE NOT PROVIDED", "NOT DELIVERED", "ITEM NOT RECEIVED",
                              "DELIVERY ISSUE", "NO SERVICE", "SERVICE FAILED", "MERCHANT SERVICE ISSUE"],
    "CUSTOMER_DISPUTE": ["CUSTOMER DISPUTE", "CUSTOMER ISSUE", "DISPUTE RAISED", "COMPLAINT"],
})


CITY_ALIASES = {
    "blr": "Bengaluru", "bangalore": "Bengaluru", "bengaluru": "Bengaluru",
    "bombay": "Mumbai", "mumbay": "Mumbai", "mumbai": "Mumbai",
    "madras": "Chennai", "calcutta": "Kolkata",
    "poona": "Pune", "hyd": "Hyderabad",
    "ldh": "Ludhiana", "lko": "Lucknow", "jpr": "Jaipur", "asr": "Amritsar",
    "jalandar": "Jalandhar", "new delhi": "Delhi", "dilli": "Delhi",
}

def normalize_city(value):
    if _blank(value):
        return None
    s = re.sub(r"\s+", " ", str(value).strip())
    return CITY_ALIASES.get(s.lower(), s.title())


def normalize_mcc(value):
    if _blank(value):
        return None
    m = re.search(r"\d+", str(value))
    if not m:
        return None
    n = int(m.group())  # drops leading zeros and the trailing ".0"
    return str(n).zfill(4) if 0 < n < 10000 else None


def mask_last4(value, min_digits=4):
    if _blank(value):
        return None
    digits = re.sub(r"\D", "", str(value))
    if len(digits) < min_digits:
        return None
    return "XXXX" + digits[-4:]


def unmapped_values(raw, mapped):
    # raw values that were non-blank but didn't hit the mapping - surface these in the log
    miss = raw[mapped.isna() & raw.map(lambda v: not _blank(v))]
    return miss.value_counts().to_dict()
