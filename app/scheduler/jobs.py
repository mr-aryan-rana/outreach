from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select

from app.database.core import SessionLocal
from app.models.models import Campaign
from app.services import sender
from app.logger import logger

scheduler = BackgroundScheduler(timezone="UTC")


def _daily_send_job():
    db = SessionLocal()
    try:
        campaigns = db.scalars(select(Campaign)).all()
        for campaign in campaigns:
            logger.info(f"running scheduled send for campaign {campaign.id} ({campaign.name})")
            sender.send_campaign(db, campaign.id)
    finally:
        db.close()


def start_scheduler():
    # Runs once a day; send_campaign internally caps at EMAIL_DAILY_LIMIT
    # sends/day across all campaigns combined, so this is safe to re-trigger.
    scheduler.add_job(_daily_send_job, "cron", hour=9, minute=0, id="daily_send", replace_existing=True)
    scheduler.start()
