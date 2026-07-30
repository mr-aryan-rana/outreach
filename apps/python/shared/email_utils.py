import re

EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")

DISPOSABLE_DOMAINS = {
    "mailinator.com",
    "10minutemail.com",
    "guerrillamail.com",
    "tempmail.com",
    "yopmail.com",
    "trashmail.com",
}

# Common TLD labels. Bios/snippets often run straight into the next sentence
# ("...emily.krogsbol@gmail.com.Watch emily.and.christian's videos..."), which
# the regex greedily folds into the domain. If a known TLD label appears
# before the end of the matched domain, the real email ends there.
KNOWN_TLDS = {
    "com", "net", "org", "edu", "gov", "io", "co", "info", "biz",
    "me", "tv", "app", "dev", "us", "uk",
}


def clean_email(email_str: str) -> str | None:
    """Lowercase a raw regex match and trim it back to a plausible email.

    Returns None if the result doesn't look like a plausible email.
    """
    email = email_str.lower()
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


def extract_emails(text: str) -> list[str]:
    """Find and clean all plausible emails in a block of text."""
    found = []
    for raw in EMAIL_PATTERN.findall(text):
        cleaned = clean_email(raw)
        if cleaned and cleaned not in found:
            found.append(cleaned)
    return found


def domain_of(email: str) -> str:
    return email.split("@", 1)[1]


def is_disposable(email: str) -> bool:
    return domain_of(email) in DISPOSABLE_DOMAINS
