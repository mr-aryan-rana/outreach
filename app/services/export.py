import json
from pathlib import Path

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.models import Email

EXPORT_PATH = Path(__file__).resolve().parent.parent / "data" / "mail_list.json"


def export_mail_list(db: Session, path: Path = EXPORT_PATH) -> int:
    """Dump the current email list to a JSON file. Temporary storage --
    the database (via the dashboard) remains the source of truth."""
    emails = db.scalars(select(Email).order_by(Email.created_at.desc())).all()

    rows = []
    for email in emails:
        last_log = max(email.email_logs, key=lambda l: l.created_at) if email.email_logs else None
        rows.append({
            "address": email.address,
            "is_valid": email.is_valid,
            "validated": len(email.validations) > 0,
            "creator_name": email.creator.name if email.creator else None,
            "creator_platform": email.creator.platform if email.creator else None,
            "creator_profile_url": email.creator.profile_url if email.creator else None,
            "phone": email.creator.phone if email.creator else None,
            "send_status": last_log.status if last_log else None,
            "created_at": email.created_at.isoformat() if email.created_at else None,
        })

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    return len(rows)
