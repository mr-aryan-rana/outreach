"""HTTP Basic auth for the dashboard and API routers -- every POST endpoint
under /dashboard and /api (send, search, campaigns, validate, orchestrator
start/stop) was previously open to anyone who could reach the app, which
matters the moment this is exposed beyond localhost (a tunnel, a public
deploy, port-forwarding).

Opt-in via DASHBOARD_PASSWORD: this is a single-operator local tool, so if
no password is configured we don't block usage -- we log a loud warning
once at startup instead. Setting DASHBOARD_USERNAME/DASHBOARD_PASSWORD in
.env turns enforcement on with no code change."""

import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.utils.config import settings
from app.logger import logger

_security = HTTPBasic(auto_error=False)


def require_auth(credentials: HTTPBasicCredentials | None = Depends(_security)) -> None:
    if not settings.DASHBOARD_PASSWORD:
        return  # auth disabled -- see module docstring

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Basic"},
        )

    # secrets.compare_digest for constant-time comparison -- avoids a
    # timing side-channel on the username/password check.
    user_ok = secrets.compare_digest(credentials.username, settings.DASHBOARD_USER)
    pass_ok = secrets.compare_digest(credentials.password, settings.DASHBOARD_PASSWORD)
    if not (user_ok and pass_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )


def warn_if_auth_disabled() -> None:
    if not settings.DASHBOARD_PASSWORD:
        logger.warning(
            "AUTH DISABLED: DASHBOARD_PASSWORD is not set -- every dashboard/API "
            "route (send, search, campaigns, orchestrator control) is open to "
            "anyone who can reach this app. Set DASHBOARD_USERNAME/DASHBOARD_PASSWORD "
            "in .env before exposing this beyond localhost."
        )
