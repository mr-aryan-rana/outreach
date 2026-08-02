import random
import time
from datetime import datetime, timezone

import redis
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.models.models import Email, Campaign, EmailLog
from app.mailer.core import send_email
from app.database.redis_core import redis_client
from app.utils.config import settings
from app.logger import logger
import re

def parse_spintax(text: str) -> str:
    """Parse spintax like {Option A|Option B|Option C} by randomly choosing one."""
    if not text:
        return text
    pattern = re.compile(r'\{([^{}]*)\}')
    while True:
        match = pattern.search(text)
        if not match:
            break
        choices = match.group(1).split('|')
        text = text[:match.start()] + random.choice(choices) + text[match.end():]
    return text


def _sent_today_count(db: Session) -> int:
    """Read-only DB count, used only for display (dashboard stats,
    orchestrator status) -- NOT the enforcement mechanism, since a plain
    COUNT-then-insert has a TOCTOU race under the app's independent
    send triggers (dashboard, scheduler cron, orchestrator).
    See _reserve_send_slot for the actual quota enforcement."""
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.scalar(
        select(func.count(EmailLog.id)).where(
            EmailLog.status == "sent",
            EmailLog.sent_at >= start_of_day,
        )
    ) or 0


def _today_key() -> str:
    return f"outreach:sent_count:{datetime.now(timezone.utc):%Y%m%d}"


def _reserve_send_slot() -> bool:
    """Atomically reserve one of today's send slots against EMAIL_DAILY_LIMIT.
    Redis INCR is atomic, so concurrent callers (dashboard, scheduler cron,
    orchestrator) racing on the same key get distinct sequential counts --
    the increment *is* the check, closing the TOCTOU window a DB
    COUNT-then-insert would leave open. Reserved slots that don't result in
    a successful send must be released via _release_send_slot.

    Fails closed: if Redis itself is unreachable, we cannot prove the quota
    isn't already exhausted, so refuse to send rather than risk exceeding
    EMAIL_DAILY_LIMIT silently -- an outbound-email quota is exactly the
    kind of thing that must never be enforced optimistically."""
    key = _today_key()
    try:
        count = redis_client.incr(key)
        if count == 1:
            redis_client.expire(key, settings.SEND_COUNTER_TTL_SEC)
    except redis.exceptions.RedisError as e:
        logger.error(f"sender: Redis unavailable, refusing to send (fail-closed on quota): {e}")
        return False
    if count > settings.EMAIL_DAILY_LIMIT:
        _release_send_slot()
        return False
    return True


def _release_send_slot() -> None:
    try:
        redis_client.decr(_today_key())
    except redis.exceptions.RedisError as e:
        logger.warning(f"sender: failed to release a reserved send slot (Redis unavailable): {e}")


def sync_send_counter_from_db(db: Session) -> None:
    """Startup reconciliation: if Redis lost today's counter (restart,
    flush) while sends already happened today, restore it from the DB's
    real count rather than silently resetting to 0 and re-opening the
    quota race this module exists to close.

    Never lets a Redis outage block app startup -- logs and moves on;
    _reserve_send_slot's fail-closed behavior covers correctness once
    Redis comes back, and refusing to boot the whole app over a cache
    being down would be a worse outcome than a delayed reconciliation."""
    key = _today_key()
    try:
        db_count = _sent_today_count(db)
        redis_count = redis_client.get(key)
        if redis_count is None or int(redis_count) < db_count:
            redis_client.set(key, db_count, ex=settings.SEND_COUNTER_TTL_SEC)
            logger.info(f"sender: reconciled today's send counter to {db_count} from DB on startup")
    except redis.exceptions.RedisError as e:
        logger.error(f"sender: could not reconcile send counter on startup, Redis unavailable: {e}")


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
        # Real enforcement -- a concurrent trigger (scheduler cron/orchestrator)
        # may have consumed the rest of today's quota since remaining_quota
        # was computed above; the atomic reservation catches that.
        if not _reserve_send_slot():
            logger.info("daily send limit reached mid-run (concurrent trigger consumed remaining quota)")
            break

        subject = parse_spintax(campaign.subject_template)

        # Calculate First Name from creator name if available
        first_name = "Creator"
        if email.creator and email.creator.name:
            # Clean up handles like @john_doe -> John
            raw_name = email.creator.name.replace('@', '')
            # Split by common delimiters and take the first part
            import re
            parts = re.split(r'[_\.\-\s]', raw_name)
            if parts and parts[0]:
                first_name = parts[0].capitalize()

        body = parse_spintax(campaign.body_template).replace("{{email}}", email.address).replace("{{First Name}}", first_name)
        ok, detail = send_email(email.address, subject, body)
        if not ok:
            _release_send_slot()

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

    if not _reserve_send_slot():
        return {"ok": False, "detail": "daily send limit reached"}

    subject = parse_spintax(campaign.subject_template)

    first_name = "Creator"
    if email.creator and email.creator.name:
        raw_name = email.creator.name.replace('@', '')
        import re
        parts = re.split(r'[_\.\-\s]', raw_name)
        if parts and parts[0]:
            first_name = parts[0].capitalize()

    body = parse_spintax(campaign.body_template).replace("{{email}}", email.address).replace("{{First Name}}", first_name)
    ok, detail = send_email(email.address, subject, body)
    if not ok:
        _release_send_slot()

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
