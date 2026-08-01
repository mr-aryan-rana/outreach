from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from app.utils.config import settings


def _psycopg2_safe_url(url: str) -> str:
    """Strip Prisma-only query params (e.g. `pgbouncer=true`) that
    psycopg2/libpq doesn't recognize as a connection option."""
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k != "pgbouncer"]
    return urlunsplit(parts._replace(query=urlencode(query)))


engine = create_engine(_psycopg2_safe_url(settings.DATABASE_URL), pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    from app.models import models  # noqa: F401  (register model metadata)
    Base.metadata.create_all(bind=engine)
    # create_all only creates missing tables, never alters existing ones --
    # this covers columns added after the tables already existed.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE creators ADD COLUMN IF NOT EXISTS phone VARCHAR"))
