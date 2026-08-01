from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://user:password@localhost:5432/outreach"
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    # Gmail SMTP (app password auth, not the account login password)
    GMAIL_USER: str = ""
    GMAIL_APP_PASSWORD: str = ""
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    # Sending policy
    EMAIL_DAILY_LIMIT: int = 200
    EMAIL_SEND_DELAY_MIN_SEC: float = 5.0
    EMAIL_SEND_DELAY_MAX_SEC: float = 15.0
    # Validation
    VALIDATE_DELIVERABILITY: bool = True
    # Telegram control bot
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""
    # Orchestrator (search-then-send loop)
    ORCHESTRATOR_BATCH_SIZE: int = 30
    ORCHESTRATOR_GAP_SEC: float = 120.0
    # Server
    APP_PORT: int = 8000
    # App
    SECRET_KEY: str = "change-this"

    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

settings = Settings()
