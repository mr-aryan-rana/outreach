from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, BackgroundTasks, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.database.core import get_db, SessionLocal
from app.models.models import Email, Creator, Campaign, EmailLog, Validation
from app.services import pipeline, sender, creator_search
from app.services.categories import CATEGORIES
from app.utils.config import settings

router = APIRouter(prefix="/dashboard")
templates = Jinja2Templates(directory="app/templates")


def _stats(db: Session) -> dict:
    total_extracted = db.scalar(select(func.count(Email.id))) or 0
    total_valid = db.scalar(select(func.count(Email.id)).where(Email.is_valid.is_(True))) or 0
    total_sent = db.scalar(select(func.count(EmailLog.id)).where(EmailLog.status == "sent")) or 0
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    sent_today = db.scalar(
        select(func.count(EmailLog.id)).where(EmailLog.status == "sent", EmailLog.sent_at >= start_of_day)
    ) or 0
    pct = min(100, round(100 * sent_today / settings.EMAIL_DAILY_LIMIT)) if settings.EMAIL_DAILY_LIMIT else 0
    return {
        "total_extracted": total_extracted,
        "total_valid": total_valid,
        "total_sent": total_sent,
        "sent_today": sent_today,
        "daily_limit": settings.EMAIL_DAILY_LIMIT,
        "sent_today_pct": pct,
    }


@router.get("")
def overview(request: Request, msg: str | None = None, db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "overview.html", {
        "active": "overview", "stats": _stats(db), "msg": msg, "categories": sorted(CATEGORIES.keys()),
    })


@router.post("/extract-text")
def extract_text(text: str = Form(...), db: Session = Depends(get_db)):
    emails = pipeline.extract_from_text(db, text)
    v = pipeline.validate_pending(db)
    msg = f"Extracted {len(emails)} email(s), validated {v['checked']} ({v['valid']} valid, {v['invalid']} invalid)"
    return RedirectResponse(f"/dashboard/emails?msg={msg}", status_code=303)


@router.post("/extract-url")
def extract_url(url: str = Form(...), creator_name: str = Form(""), platform: str = Form(""),
                 db: Session = Depends(get_db)):
    emails = pipeline.extract_from_url(db, url, creator_name or None, platform or None)
    v = pipeline.validate_pending(db)
    msg = f"Scraped {url}: found {len(emails)}, validated {v['checked']} ({v['valid']} valid, {v['invalid']} invalid)"
    return RedirectResponse(f"/dashboard/emails?msg={msg}", status_code=303)


@router.post("/search")
def creator_search_run(platform: str = Form(...), category: str = Form(...),
                        max_queries: int = Form(6), background_tasks: BackgroundTasks = None,
                        db: Session = Depends(get_db)):
    """Runs several dork queries with a delay between each (to stay under
    DuckDuckGo's rate limit), so this can take up to a minute -- backgrounded
    rather than holding the request open."""
    background_tasks.add_task(_run_search_job, platform, category, max_queries)
    return RedirectResponse(
        f"/dashboard/emails?msg=Searching {platform} / {category} in the background "
        f"({max_queries} queries, ~{max_queries * 4}s) -- refresh in a bit",
        status_code=303,
    )


def _run_search_job(platform: str, category: str, max_queries: int):
    db = SessionLocal()
    try:
        creator_search.search_and_extract_category(db, platform, category, max_queries=max_queries)
    finally:
        db.close()


@router.post("/search-target")
def creator_search_target(platform: str = Form(...), category: str = Form(...),
                           target_valid: int = Form(300), background_tasks: BackgroundTasks = None):
    """Runs until `target_valid` validated emails exist in the DB (or a
    safety cap / repeated rate-limiting stops it first). Never sends
    anything -- storage only. Can run for a long time, so it's backgrounded;
    check progress via /dashboard/emails or /stats."""
    background_tasks.add_task(_run_search_target_job, platform, category, target_valid)
    return RedirectResponse(
        f"/dashboard/emails?msg=Running {platform} / {category} in the background until "
        f"{target_valid} validated emails are found -- check back here or on /dashboard for progress",
        status_code=303,
    )


def _run_search_target_job(platform: str, category: str, target_valid: int):
    db = SessionLocal()
    try:
        creator_search.search_until_target(db, platform, category, target_valid=target_valid)
    finally:
        db.close()


@router.post("/emails/add")
def add_email(address: str = Form(...), db: Session = Depends(get_db)):
    address = address.strip()
    existing = db.scalar(select(Email).where(Email.address == address))
    if existing is None:
        db.add(Email(address=address, is_valid=False))
        db.commit()
        msg = f"Added {address}"
    else:
        msg = f"{address} is already in the list"
    return RedirectResponse(f"/dashboard/emails?msg={msg}", status_code=303)


@router.post("/emails/send-one")
def send_one(email_id: int = Form(...), campaign_id: int = Form(...), filter: str = Form("all"),
             db: Session = Depends(get_db)):
    result = sender.send_single(db, email_id, campaign_id)
    msg = "Sent" if result["ok"] else f"Failed: {result['detail']}"
    return RedirectResponse(f"/dashboard/emails?filter={filter}&msg={msg}", status_code=303)


@router.post("/validate")
def validate(db: Session = Depends(get_db)):
    result = pipeline.validate_pending(db)
    msg = f"Validated {result['checked']}: {result['valid']} valid, {result['invalid']} invalid"
    return RedirectResponse(f"/dashboard?msg={msg}", status_code=303)


@router.get("/emails")
def emails_list(request: Request, filter: str = "all", msg: str | None = None, db: Session = Depends(get_db)):
    counts = {
        "all": db.scalar(select(func.count(Email.id))) or 0,
        "valid": db.scalar(select(func.count(Email.id)).where(Email.is_valid.is_(True))) or 0,
        "invalid": db.scalar(
            select(func.count(Email.id)).join(Validation).where(Email.is_valid.is_(False))
        ) or 0,
        "unvalidated": db.scalar(
            select(func.count(Email.id)).outerjoin(Validation).where(Validation.id.is_(None))
        ) or 0,
        "sent": db.scalar(
            select(func.count(func.distinct(EmailLog.email_id))).where(EmailLog.status == "sent")
        ) or 0,
    }

    query = select(Email)
    if filter == "valid":
        query = query.where(Email.is_valid.is_(True))
    elif filter == "invalid":
        query = query.join(Validation).where(Email.is_valid.is_(False))
    elif filter == "unvalidated":
        query = query.outerjoin(Validation).where(Validation.id.is_(None))
    elif filter == "sent":
        sent_ids = select(EmailLog.email_id).where(EmailLog.status == "sent")
        query = query.where(Email.id.in_(sent_ids))

    records = db.scalars(query.order_by(Email.created_at.desc()).limit(500)).all()
    campaigns = db.scalars(select(Campaign).order_by(Campaign.created_at.desc())).all()

    rows = []
    for email in records:
        validated = len(email.validations) > 0
        last_log = max(email.email_logs, key=lambda l: l.created_at) if email.email_logs else None
        rows.append({
            "id": email.id,
            "address": email.address,
            "source": email.creator.name if email.creator else None,
            "phone": email.creator.phone if email.creator else None,
            "validated": validated,
            "is_valid": email.is_valid,
            "send_status": last_log.status if last_log else None,
            "last_campaign_id": last_log.campaign_id if last_log else None,
            "created_at": email.created_at.strftime("%Y-%m-%d %H:%M") if email.created_at else "",
        })

    return templates.TemplateResponse(request, "emails.html", {
        "active": "emails", "rows": rows, "counts": counts, "filter": filter,
        "campaigns": campaigns, "msg": msg,
    })


@router.get("/campaigns")
def campaigns_page(request: Request, msg: str | None = None, db: Session = Depends(get_db)):
    campaigns = db.scalars(select(Campaign).order_by(Campaign.created_at.desc())).all()
    rows = []
    for c in campaigns:
        sent = sum(1 for l in c.email_logs if l.status == "sent")
        failed = sum(1 for l in c.email_logs if l.status == "failed")
        rows.append({
            "id": c.id, "name": c.name, "subject_template": c.subject_template,
            "sent_count": sent, "failed_count": failed,
            "created_at": c.created_at.strftime("%Y-%m-%d %H:%M") if c.created_at else "",
        })
    return templates.TemplateResponse(request, "campaigns.html", {
        "active": "campaigns", "campaigns": rows, "daily_limit": settings.EMAIL_DAILY_LIMIT, "msg": msg,
    })


@router.post("/campaigns")
def create_campaign(name: str = Form(...), subject_template: str = Form(...),
                     body_template: str = Form(...), db: Session = Depends(get_db)):
    db.add(Campaign(name=name, subject_template=subject_template, body_template=body_template))
    db.commit()
    return RedirectResponse(f"/dashboard/campaigns?msg=Created campaign '{name}'", status_code=303)


@router.post("/send")
def send(campaign_id: int = Form(...), background_tasks: BackgroundTasks = None):
    background_tasks.add_task(_run_send_job, campaign_id)
    return RedirectResponse("/dashboard/campaigns?msg=Send started in background", status_code=303)


def _run_send_job(campaign_id: int):
    db = SessionLocal()
    try:
        sender.send_campaign(db, campaign_id)
    finally:
        db.close()
