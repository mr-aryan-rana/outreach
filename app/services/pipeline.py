import random
import time

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.extractor.core import extract_emails_from_text
from app.validator.core import is_valid_email
from app.scraper.core import fetch_page_content
from app.models.models import Creator, Email, Validation
from app.utils.config import settings
from app.logger import logger


def extract_from_text(db: Session, text: str, creator_id: int | None = None) -> list[Email]:
    """Extract emails from raw text and store new ones (dedup on Email.address)."""
    found = extract_emails_from_text(text)
    stored: list[Email] = []
    for address in found:
        existing = db.scalar(select(Email).where(Email.address == address))
        if existing:
            stored.append(existing)
            continue
        record = Email(address=address, creator_id=creator_id, is_valid=False)
        db.add(record)
        db.flush()
        stored.append(record)
    db.commit()
    return stored


def extract_from_url(db: Session, url: str, creator_name: str | None = None,
                      platform: str | None = None) -> list[Email]:
    """Fetch a page, extract emails from its HTML, and store them against a Creator."""
    html = fetch_page_content(url)
    if html is None:
        return []

    creator = db.scalar(select(Creator).where(Creator.profile_url == url))
    if creator is None:
        creator = Creator(name=creator_name or url, platform=platform or "web", profile_url=url)
        db.add(creator)
        db.flush()

    return extract_from_text(db, html, creator_id=creator.id)


def validate_pending(db: Session, limit: int = 500) -> dict:
    """Validate emails that have no Validation record yet."""
    pending = db.scalars(
        select(Email).outerjoin(Validation).where(Validation.id.is_(None)).limit(limit)
    ).all()

    valid_count = 0
    invalid_count = 0
    for i, email in enumerate(pending):
        ok, reason = is_valid_email(email.address)
        db.add(Validation(email_id=email.id, syntax_check=True, smtp_check=ok, reason=reason))
        email.is_valid = ok
        valid_count += int(ok)
        invalid_count += int(not ok)

        if i < len(pending) - 1:
            time.sleep(random.uniform(settings.VALIDATION_DELAY_MIN_SEC, settings.VALIDATION_DELAY_MAX_SEC))

    db.commit()
    logger.info(f"validated {len(pending)} emails: {valid_count} valid, {invalid_count} invalid")
    return {"checked": len(pending), "valid": valid_count, "invalid": invalid_count}
