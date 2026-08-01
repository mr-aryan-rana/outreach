from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.database.core import get_db
from app.models.models import Email, Campaign, EmailLog
from app.services import pipeline, sender, export as export_service
from app.utils.config import settings

router = APIRouter()


class ExtractTextRequest(BaseModel):
    text: str


class ExtractUrlRequest(BaseModel):
    url: str
    creator_name: str | None = None
    platform: str | None = None


class CampaignRequest(BaseModel):
    name: str
    subject_template: str
    body_template: str


@router.post("/extract/text")
def extract_text(payload: ExtractTextRequest, db: Session = Depends(get_db)):
    emails = pipeline.extract_from_text(db, payload.text)
    return {"extracted": [e.address for e in emails], "count": len(emails)}


@router.post("/extract/url")
def extract_url(payload: ExtractUrlRequest, db: Session = Depends(get_db)):
    emails = pipeline.extract_from_url(db, payload.url, payload.creator_name, payload.platform)
    return {"extracted": [e.address for e in emails], "count": len(emails)}


@router.post("/validate/run")
def validate_run(limit: int = 500, db: Session = Depends(get_db)):
    return pipeline.validate_pending(db, limit=limit)


@router.post("/campaigns")
def create_campaign(payload: CampaignRequest, db: Session = Depends(get_db)):
    campaign = Campaign(**payload.model_dump())
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return {"id": campaign.id, "name": campaign.name}


@router.post("/send/run")
def send_run(campaign_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Kicks off the send in the background since 200 sends x several-second
    delays can take well over an hour -- callers shouldn't block on this."""
    background_tasks.add_task(_run_send_job, campaign_id)
    return {"status": "started", "campaign_id": campaign_id, "daily_limit": settings.EMAIL_DAILY_LIMIT}


def _run_send_job(campaign_id: int):
    from app.database.core import SessionLocal
    db = SessionLocal()
    try:
        sender.send_campaign(db, campaign_id)
    finally:
        db.close()


@router.post("/export/json")
def export_json(db: Session = Depends(get_db)):
    count = export_service.export_mail_list(db)
    return {"exported": count, "path": str(export_service.EXPORT_PATH)}


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    total_emails = db.scalar(select(func.count(Email.id))) or 0
    valid_emails = db.scalar(select(func.count(Email.id)).where(Email.is_valid.is_(True))) or 0
    sent_total = db.scalar(select(func.count(EmailLog.id)).where(EmailLog.status == "sent")) or 0
    return {
        "total_extracted": total_emails,
        "total_valid": valid_emails,
        "total_sent": sent_total,
        "daily_limit": settings.EMAIL_DAILY_LIMIT,
    }
