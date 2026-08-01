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
    # Daily scheduled send (UTC)
    SCHEDULER_SEND_HOUR: int = 9
    SCHEDULER_SEND_MINUTE: int = 0
    # Orchestrator (search-then-send loop)
    ORCHESTRATOR_BATCH_SIZE: int = 30
    ORCHESTRATOR_GAP_MIN_SEC: float = 90.0
    ORCHESTRATOR_GAP_MAX_SEC: float = 150.0
    # Search rate limiting (DuckDuckGo dork queries)
    SEARCH_MAX_QUERIES_PER_RUN: int = 800
    SEARCH_MAX_CONSECUTIVE_RATE_LIMITS: int = 6
    SEARCH_RATE_LIMIT_BACKOFF_MIN_SEC: float = 30.0
    SEARCH_RATE_LIMIT_BACKOFF_MAX_SEC: float = 60.0
    SEARCH_QUERY_DELAY_MIN_SEC: float = 1.0
    SEARCH_QUERY_DELAY_MAX_SEC: float = 4.0
    SEARCH_INCLUDE_STATE_TERMS: bool = False
    SEARCH_LOCK_TTL_SEC: float = 900.0
    # Send-quota enforcement
    SEND_COUNTER_TTL_SEC: int = 93600
    # Email validation (MX/DNS lookup) throttling
    VALIDATION_DELAY_MIN_SEC: float = 0.2
    VALIDATION_DELAY_MAX_SEC: float = 0.6
    # Server
    APP_PORT: int = 8000
    # App
    SECRET_KEY: str = "change-this"
    # Dashboard/API auth (HTTP Basic) -- unset DASHBOARD_PASSWORD disables
    # enforcement (single-operator local tool default); set it before
    # exposing this app beyond localhost. Field name matches the
    # DASHBOARD_USER/DASHBOARD_PASSWORD keys already present in .env.
    DASHBOARD_USER: str = "admin"
    DASHBOARD_PASSWORD: str = ""

    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

settings = Settings()
