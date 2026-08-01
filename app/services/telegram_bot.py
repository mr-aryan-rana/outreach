import threading
import time

import httpx
from sqlalchemy import select

from app.database.core import SessionLocal
from app.models.models import Email, Campaign
from app.services.orchestrator import orchestrator
from app.services.categories import CATEGORIES
from app.utils.config import settings
from app.logger import logger

HELP_TEXT = (
    "Outreach bot commands:\n"
    "/start <mode> <campaign_id> [batch_size] [platform] [category] - start orchestrator (mode=auto/manual)\n"
    "   e.g. /start auto 1 30 tiktok all\n"
    "/stop - stop after the current step finishes\n"
    "/status - current loop status and mode\n"
    "/search <platform> <category> - trigger manual search for 1 run\n"
    "/approve <email_id> - manually approve an email\n"
    "/list [n] - last n valid emails (default 10)\n"
    "/campaigns - list campaign ids/names\n"
    "/help - this message"
)

_stop_event = threading.Event()


def _api(method: str) -> str:
    return f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/{method}"


def send_message(text: str, chat_id: str | None = None):
    try:
        httpx.post(_api("sendMessage"), json={
            "chat_id": chat_id or settings.TELEGRAM_CHAT_ID, "text": text,
        }, timeout=15)
    except Exception as e:
        logger.warning(f"telegram send_message failed: {e}")


def _handle_command(text: str) -> str:
    parts = text.strip().split()
    cmd = parts[0].lower()

    if cmd == "/start":
        if len(parts) < 3:
            return "usage: /start <mode> <campaign_id> [batch_size] [platform] [category] (mode=auto/manual)"
        
        mode = parts[1].lower()
        if mode not in ("auto", "manual"):
            return "mode must be 'auto' or 'manual'"
        
        try:
            campaign_id = int(parts[2])
        except ValueError:
            return "campaign_id must be a number -- see /campaigns"
        
        batch_size = int(parts[3]) if len(parts) > 3 else None
        platform = parts[4] if len(parts) > 4 else "tiktok"
        category = parts[5] if len(parts) > 5 else "all"
        if category != "all" and category not in CATEGORIES:
            return f"unknown category '{category}'. Known: all, {', '.join(sorted(CATEGORIES))}"
        
        ok, detail = orchestrator.start(platform, category, campaign_id, batch_size, auto_mode=(mode == "auto"))
        return f"{'Started' if ok else 'Not started'}: {detail}"

    if cmd == "/stop":
        ok, detail = orchestrator.stop()
        return detail

    if cmd == "/status":
        s = orchestrator.status()
        mode_str = "Auto" if s.get("auto_mode") else "Manual"
        return (
            f"running: {s['running']} (Mode: {mode_str})\n"
            f"platform/category: {s['platform']} / {s['category']}\n"
            f"campaign_id: {s['campaign_id']}\n"
            f"batch_size: {s['batch_size']}\n"
            f"cycles completed: {s['cycles_completed']}\n"
            f"unsent valid: {s['unsent_valid']}\n"
            f"total valid: {s['total_valid']}\n"
            f"total sent: {s['total_sent']}\n"
            f"status: {s['last_status']}"
        )

    if cmd == "/list":
        n = int(parts[1]) if len(parts) > 1 else 10
        db = SessionLocal()
        try:
            rows = db.scalars(
                select(Email).where(Email.is_valid.is_(True)).order_by(Email.created_at.desc()).limit(n)
            ).all()
        finally:
            db.close()
        if not rows:
            return "no valid emails yet"
        return "\n".join(f"{e.address} ({e.creator.name if e.creator else '-'})" for e in rows)

    if cmd == "/campaigns":
        db = SessionLocal()
        try:
            rows = db.scalars(select(Campaign)).all()
        finally:
            db.close()
        if not rows:
            return "no campaigns yet -- create one on the dashboard first"
        return "\n".join(f"{c.id}: {c.name}" for c in rows)
        
    if cmd == "/search":
        if len(parts) < 3:
            return "usage: /search <platform> <category>"
        platform = parts[1]
        category = parts[2]
        
        if category != "all" and category not in CATEGORIES:
            return f"unknown category '{category}'"
            
        threading.Thread(target=lambda: _run_manual_search(platform, category), daemon=True).start()
        return f"Triggered manual search in background for {platform}/{category}"
        
    if cmd == "/approve":
        if len(parts) < 2:
            return "usage: /approve <email_id>"
        try:
            email_id = int(parts[1])
        except ValueError:
            return "email_id must be a number"
            
        db = SessionLocal()
        try:
            email = db.get(Email, email_id)
            if not email:
                return f"Email #{email_id} not found."
            email.is_approved = not email.is_approved
            db.commit()
            return f"Email {email.address} approval set to {email.is_approved}"
        finally:
            db.close()

    return HELP_TEXT

def _run_manual_search(platform: str, category: str):
    from app.services import creator_search
    db = SessionLocal()
    try:
        creator_search.search_and_extract_category(db, platform, category, max_queries=6)
    finally:
        db.close()


def _poll_loop():
    offset = 0
    logger.info("telegram bot: polling started")
    while not _stop_event.is_set():
        try:
            resp = httpx.get(_api("getUpdates"), params={"offset": offset, "timeout": 25}, timeout=30)
            data = resp.json()
            for update in data.get("result", []):
                offset = update["update_id"] + 1
                message = update.get("message") or {}
                chat_id = str(message.get("chat", {}).get("id", ""))
                text = message.get("text", "")
                if not text:
                    continue
                if chat_id != str(settings.TELEGRAM_CHAT_ID):
                    logger.warning(f"telegram: ignoring message from unauthorized chat_id {chat_id}")
                    continue
                reply = _handle_command(text)
                send_message(reply, chat_id)
        except Exception as e:
            logger.warning(f"telegram poll error: {e}")
            time.sleep(5)


def start_bot():
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
        logger.info("telegram bot: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, skipping")
        return
    threading.Thread(target=_poll_loop, daemon=True).start()
