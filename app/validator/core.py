from email_validator import (
    validate_email as validate,
    EmailNotValidError,
    EmailSyntaxError,
)
from app.utils.config import settings
from app.extractor.core import is_disposable


def is_valid_email(email: str) -> tuple[bool, str]:
    """Syntax check, disposable-domain rejection, plus an MX/deliverability
    check when enabled.

    Deliverability does a live DNS lookup. Syntax failures are always
    real rejections; if deliverability specifically times out/errors on
    DNS (rather than confirming the domain has no mail server), we fall
    back to syntax-only rather than discarding an address over a
    transient DNS hiccup.
    """
    if "@" in email and is_disposable(email.lower()):
        return False, "disposable domain"
    try:
        validate(email, check_deliverability=settings.VALIDATE_DELIVERABILITY)
        return True, "Valid"
    except EmailSyntaxError as e:
        return False, str(e)
    except EmailNotValidError as e:
        if not settings.VALIDATE_DELIVERABILITY:
            return False, str(e)
        try:
            validate(email, check_deliverability=False)
        except EmailNotValidError as syntax_err:
            return False, str(syntax_err)
        if "does not exist" in str(e) or "does not accept email" in str(e):
            return False, str(e)
        # syntax is fine but the deliverability check itself failed
        # (e.g. DNS resolver timeout) -- don't penalize the address for it
        return True, f"Valid syntax; deliverability check inconclusive ({e})"
