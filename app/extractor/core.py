import re
from pathlib import Path

# Modified to handle search engine highlighting which injects spaces
EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9.-]+\s*\.\s*[A-Za-z]{2,}\b")
# International-ish phone numbers: optional +CC, then groups of 2-4 digits
# separated by spaces/dashes/dots/parens, 8-15 digits total (E.164 range).
# Deliberately strict about separators to avoid matching plain sentences
# full of numbers (dates, prices, follower counts).
PHONE_PATTERN = re.compile(
    r"(?<![\w@])(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]\d{3,4}[-.\s]\d{3,4}(?:[-.\s]\d{2,4})?(?![\w])"
)

# Maintained blocklist (8000+ domains, MIT licensed) instead of a hand-picked
# handful -- falls back to a small hardcoded set if the package is somehow
# unavailable so extraction never hard-fails over a missing optional import.
try:
    from disposable_email_domains import blocklist as DISPOSABLE_DOMAINS
except ImportError:
    DISPOSABLE_DOMAINS = {
        "mailinator.com", "10minutemail.com", "guerrillamail.com",
        "tempmail.com", "yopmail.com", "trashmail.com",
    }

# Full IANA TLD registry (~1440 entries, data/tlds.txt), bundled locally
# rather than fetched at runtime -- refresh by re-running the download in
# extractor/data/README or just re-fetching data.iana.org/TLD/tlds-alpha-by-domain.txt.
# A ~15-entry hardcoded list used to miss common creator-business TLDs
# (.ai, .xyz, .online, most ccTLDs), silently mis-trimming or dropping
# otherwise-valid emails during snippet cleanup below.
_TLD_FILE = Path(__file__).resolve().parent / "data" / "tlds.txt"
try:
    KNOWN_TLDS = set(_TLD_FILE.read_text(encoding="utf-8").split())
except FileNotFoundError:
    KNOWN_TLDS = {
        "com", "net", "org", "edu", "gov", "io", "co", "info", "biz",
        "me", "tv", "app", "dev", "us", "uk",
    }


def clean_email(email_str: str) -> str | None:
    """Lowercase a raw regex match and trim it back to a plausible email.

    Bios/snippets often run straight into the next sentence
    ("...emily@gmail.com.Watch her videos..."), which the regex greedily
    folds into the domain -- if a known TLD label appears before the end
    of the matched domain, the real email ends there.
    """
    email = email_str.lower().replace(" ", "")
    while email and not email[-1].isalnum():
        email = email[:-1]

    parts = email.split("@")
    if len(parts) != 2:
        return None

    local, domain = parts
    labels = domain.split(".")
    if len(labels) < 2:
        return None

    for i in range(1, len(labels)):
        if labels[i] in KNOWN_TLDS:
            domain = ".".join(labels[: i + 1])
            break

    return f"{local}@{domain}"


def is_disposable(email: str) -> bool:
    return email.split("@", 1)[1] in DISPOSABLE_DOMAINS


def extract_emails_from_text(text: str) -> list[str]:
    if not text:
        return []
    found = []
    for raw in EMAIL_PATTERN.findall(text):
        cleaned = clean_email(raw)
        if cleaned and not is_disposable(cleaned) and cleaned not in found:
            found.append(cleaned)
    return found


def extract_phones_from_text(text: str) -> list[str]:
    if not text:
        return []
    found = []
    for match in PHONE_PATTERN.finditer(text):
        raw = match.group(0).strip()
        digits = re.sub(r"\D", "", raw)
        if 8 <= len(digits) <= 15 and raw not in found:
            found.append(raw)
    return found
