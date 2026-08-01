import random
import time
from datetime import datetime, timezone

from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.models.models import Email, Campaign, EmailLog
from app.mailer.core import send_email
from app.utils.config import settings
from app.logger import logger


def _sent_today_count(db: Session) -> int:
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.scalar(
        select(func.count(EmailLog.id)).where(
            EmailLog.status == "sent",
            EmailLog.sent_at >= start_of_day,
        )
    ) or 0


def send_campaign(db: Session, campaign_id: int) -> dict:
    """Send to all valid, not-yet-contacted emails for a campaign, one by one,
    stopping once EMAIL_DAILY_LIMIT sends have gone out today."""
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        return {"error": f"campaign {campaign_id} not found"}

    already_sent_today = _sent_today_count(db)
    remaining_quota = max(0, settings.EMAIL_DAILY_LIMIT - already_sent_today)
    if remaining_quota == 0:
        logger.info("daily send limit already reached; nothing to do")
        return {"sent": 0, "failed": 0, "skipped_quota": True}

    already_logged_ids = select(EmailLog.email_id).where(EmailLog.campaign_id == campaign_id)
    targets = db.scalars(
        select(Email)
        .where(Email.is_valid.is_(True))
        .where(Email.id.not_in(already_logged_ids))
        .limit(remaining_quota)
    ).all()

    sent, failed = 0, 0
    for email in targets:
        subject = campaign.subject_template
        body = campaign.body_template.replace("{{email}}", email.address)
        ok, detail = send_email(email.address, subject, body)

        db.add(EmailLog(
            email_id=email.id,
            campaign_id=campaign.id,
            status="sent" if ok else "failed",
            sent_at=datetime.now(timezone.utc) if ok else None,
        ))
        db.commit()

        if ok:
            sent += 1
            logger.info(f"sent to {email.address}")
        else:
            failed += 1
            logger.warning(f"failed to send to {email.address}: {detail}")

        if email is not targets[-1]:
            time.sleep(random.uniform(settings.EMAIL_SEND_DELAY_MIN_SEC, settings.EMAIL_SEND_DELAY_MAX_SEC))

    return {"sent": sent, "failed": failed, "remaining_quota_before_run": remaining_quota}


def send_single(db: Session, email_id: int, campaign_id: int) -> dict:
    """Send (or retry) one specific email against one campaign right now.
    Used by the dashboard's per-row Send/Retry buttons for manual testing
    of the current extracted list, rather than a full campaign blast."""
    email = db.get(Email, email_id)
    campaign = db.get(Campaign, campaign_id)
    if email is None or campaign is None:
        return {"ok": False, "detail": "email or campaign not found"}

    if _sent_today_count(db) >= settings.EMAIL_DAILY_LIMIT:
        return {"ok": False, "detail": "daily send limit reached"}

    subject = campaign.subject_template
    body = campaign.body_template.replace("{{email}}", email.address)
    ok, detail = send_email(email.address, subject, body)

    db.add(EmailLog(
        email_id=email.id,
        campaign_id=campaign.id,
        status="sent" if ok else "failed",
        sent_at=datetime.now(timezone.utc) if ok else None,
    ))
    db.commit()

    if ok:
        logger.info(f"sent (manual) to {email.address}")
    else:
        logger.warning(f"failed (manual) to {email.address}: {detail}")

    return {"ok": ok, "detail": detail}
