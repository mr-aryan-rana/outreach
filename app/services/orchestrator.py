import random
import threading
import time

from sqlalchemy import select, func

from app.database.core import SessionLocal
from app.models.models import Email, Campaign, EmailLog
from app.services import creator_search, sender
from app.utils.config import settings
from app.logger import logger

MAX_SEARCH_ROUNDS_PER_BATCH = 5


def _unsent_valid_count(db, require_approved: bool = False) -> int:
    already_logged = select(EmailLog.email_id).where(EmailLog.status == "sent")
    q = select(func.count(Email.id)).where(Email.is_valid.is_(True)).where(Email.id.not_in(already_logged))
    if require_approved:
        q = q.where(Email.is_approved.is_(True))
    return db.scalar(q) or 0


class Orchestrator:
    """Runs search-until-batch-full, then send-the-batch-one-by-one, then
    waits a gap, then repeats -- forever, until stopped. Storage/search and
    sending are the two phases; nothing is ever sent outside this explicit
    send phase, and the send phase itself still goes through send_single,
    which enforces EMAIL_DAILY_LIMIT."""

    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self.running = False
        self.platform = "tiktok"
        self.category = "all"
        self.batch_size = settings.ORCHESTRATOR_BATCH_SIZE
        self.campaign_id: int | None = None
        self.auto_mode = True
        self.cycles_completed = 0
        self.last_status = "idle"

    def start(self, platform: str, category: str, campaign_id: int, batch_size: int | None = None, auto_mode: bool = True) -> tuple[bool, str]:
        if self.running:
            return False, "already running"
        db = SessionLocal()
        try:
            if db.get(Campaign, campaign_id) is None:
                return False, f"campaign {campaign_id} not found -- create one on the dashboard first"
        finally:
            db.close()

        self.platform = platform
        self.category = category
        self.campaign_id = campaign_id
        self.batch_size = batch_size or settings.ORCHESTRATOR_BATCH_SIZE
        self.auto_mode = auto_mode
        self.cycles_completed = 0
        self._stop_event.clear()
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info(f"orchestrator started: platform={platform} category={category} "
                    f"campaign_id={campaign_id} batch_size={self.batch_size}")
        return True, "started"

    def stop(self) -> tuple[bool, str]:
        if not self.running:
            return False, "not running"
        self._stop_event.set()
        return True, "stopping (will finish current step first)"

    def status(self) -> dict:
        db = SessionLocal()
        try:
            unsent_valid = _unsent_valid_count(db)
            total_valid = db.scalar(select(func.count(Email.id)).where(Email.is_valid.is_(True))) or 0
            total_sent = db.scalar(select(func.count(EmailLog.id)).where(EmailLog.status == "sent")) or 0
        finally:
            db.close()
        return {
            "running": self.running,
            "platform": self.platform,
            "category": self.category,
            "campaign_id": self.campaign_id,
            "batch_size": self.batch_size,
            "auto_mode": self.auto_mode,
            "cycles_completed": self.cycles_completed,
            "unsent_valid": unsent_valid,
            "total_valid": total_valid,
            "total_sent": total_sent,
            "last_status": self.last_status,
        }

    def _loop(self):
        while not self._stop_event.is_set():
            db = SessionLocal()
            try:
                self.last_status = "searching"
                self._fill_batch(db)
                if self._stop_event.is_set():
                    break

                self.last_status = "sending"
                sent = self._send_batch(db)
                self.cycles_completed += 1
                logger.info(f"orchestrator: cycle {self.cycles_completed} done, sent {sent} this batch")
            finally:
                db.close()

            if self._stop_event.is_set():
                break
            self.last_status = f"waiting {settings.ORCHESTRATOR_GAP_SEC:.0f}s before next cycle"
            self._stop_event.wait(settings.ORCHESTRATOR_GAP_SEC)

        self.running = False
        self.last_status = "stopped"
        logger.info("orchestrator: stopped")

    def _fill_batch(self, db):
        rounds = 0
        platforms_to_search = ["tiktok", "youtube", "instagram"] if self.platform == "all" else [self.platform]
        
        while (not self._stop_event.is_set()
               and _unsent_valid_count(db, require_approved=False) < self.batch_size
               and rounds < MAX_SEARCH_ROUNDS_PER_BATCH):
            
            total_found_this_round = 0
            needed_total = self.batch_size - _unsent_valid_count(db, require_approved=False)
            
            for plat in platforms_to_search:
                if self._stop_event.is_set():
                    break
                    
                needed_for_plat = max(1, needed_total // len(platforms_to_search))
                
                result = creator_search.search_until_target(db, plat, self.category, target_valid=needed_for_plat)
                total_found_this_round += result["valid_found_this_run"]
                
                if _unsent_valid_count(db, require_approved=False) >= self.batch_size:
                    break

            rounds += 1
            if total_found_this_round == 0 and not self._stop_event.is_set():
                self._stop_event.wait(settings.ORCHESTRATOR_GAP_SEC)
        
        if self.auto_mode:
            # Auto-approve all valid unapproved emails
            from sqlalchemy import update
            db.execute(update(Email).where(Email.is_valid.is_(True)).where(Email.is_approved.is_(False)).values(is_approved=True))
            db.commit()

    def _send_batch(self, db) -> int:
        sent = 0
        while sent < self.batch_size and not self._stop_event.is_set():
            already_logged = select(EmailLog.email_id).where(EmailLog.campaign_id == self.campaign_id)
            email = db.scalar(
                select(Email)
                .where(Email.is_valid.is_(True))
                .where(Email.is_approved.is_(True))
                .where(Email.id.not_in(already_logged))
                .limit(1)
            )
            if email is None:
                break
            result = sender.send_single(db, email.id, self.campaign_id)
            if not result["ok"] and result.get("detail") == "daily send limit reached":
                logger.info("orchestrator: daily send limit reached, ending send phase")
                break
            if result["ok"]:
                sent += 1
            if sent < self.batch_size:
                time.sleep(random.uniform(settings.EMAIL_SEND_DELAY_MIN_SEC, settings.EMAIL_SEND_DELAY_MAX_SEC))
        return sent


orchestrator = Orchestrator()
