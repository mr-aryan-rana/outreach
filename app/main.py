from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.database.core import init_db, SessionLocal
from app.api.routes import router as api_router
from app.api.dashboard import router as dashboard_router
from app.scheduler.jobs import start_scheduler
from app.services import sender
from app.utils.auth import warn_if_auth_disabled
from app.logger import logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        sender.sync_send_counter_from_db(db)
    finally:
        db.close()
    start_scheduler()
    warn_if_auth_disabled()
    logger.info("Outreach monolith started")
    yield


app = FastAPI(
    title="Outreach Monolith",
    description="Single FastAPI application for the Outreach workflow.",
    lifespan=lifespan,
)

app.include_router(api_router)
app.include_router(dashboard_router)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/")
def read_root():
    return RedirectResponse("/dashboard")


@app.get("/health")
def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    from app.utils.config import settings
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.APP_PORT, reload=True)
