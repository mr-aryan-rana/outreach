import ipaddress
import json
import os
import re
import socket
import sys
from typing import List, Optional
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import AnyHttpUrl, BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))
from email_utils import extract_emails  # noqa: E402
from request_logging import RequestLoggingMiddleware, configure_json_logging  # noqa: E402

app = FastAPI(title="MakeAble Extractor Service")
logger = configure_json_logging("extractor")
app.add_middleware(RequestLoggingMiddleware, logger=logger, service_name="extractor")

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))
MAX_REDIRECTS = 5


class SsrfBlockedError(Exception):
    def __init__(self, url: str, reason: str):
        self.url = url
        self.reason = reason
        super().__init__(f"blocked {url}: {reason}")


def _assert_safe_target(url: str) -> None:
    """
    SSRF guard: this endpoint fetches attacker-influenceable URLs (candidate
    creator pages, ultimately sourced from search results) with no auth of
    its own. Pydantic's AnyHttpUrl only validates *syntax* -- without this,
    a candidate URL (or a redirect target -- see the manual redirect loop in
    extract()) pointing at 127.0.0.1, 169.254.169.254 (cloud metadata),
    RFC1918 ranges, etc. would be fetched exactly like any public page.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SsrfBlockedError(url, f"unsupported scheme {parsed.scheme!r}")
    hostname = parsed.hostname
    if not hostname:
        raise SsrfBlockedError(url, "no hostname")

    try:
        addrinfo = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise SsrfBlockedError(url, f"DNS resolution failed: {exc}") from exc

    for family, _, _, _, sockaddr in addrinfo:
        ip = ipaddress.ip_address(sockaddr[0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise SsrfBlockedError(url, f"resolves to non-public address {ip}")

SOCIAL_LINK_PATTERN = re.compile(
    r'https?://(?:www\.)?(?:instagram|youtube|tiktok|twitter|x)\.com/[^\s"\'<>]+',
    re.IGNORECASE,
)


class ExtractRequest(BaseModel):
    url: AnyHttpUrl


class ExtractResponse(BaseModel):
    email: Optional[str]
    social_links: List[str]
    bio: str
    source_url: str


def parse_page(html: str, url: str) -> ExtractResponse:
    emails = extract_emails(html)
    social_links = sorted(set(SOCIAL_LINK_PATTERN.findall(html)))
    bio = html.strip()[:500]
    return ExtractResponse(
        email=emails[0] if emails else None,
        social_links=social_links,
        bio=bio,
        source_url=url,
    )


@app.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest) -> ExtractResponse:
    url = str(req.url)
    try:
        # Manual redirect loop (not httpx's follow_redirects=True) so every
        # hop -- not just the initial URL -- is re-validated: a same-origin
        # check up front doesn't stop a page from 302-redirecting to an
        # internal address.
        current_url = url
        resp = None
        for _ in range(MAX_REDIRECTS + 1):
            _assert_safe_target(current_url)
            resp = httpx.get(current_url, timeout=REQUEST_TIMEOUT, follow_redirects=False)
            if resp.is_redirect:
                current_url = str(resp.next_request.url)
                continue
            break
        else:
            raise HTTPException(status_code=502, detail=f"Too many redirects fetching {url}")
        resp.raise_for_status()
    except SsrfBlockedError as exc:
        logger.warning(json.dumps({"event": "extract_ssrf_blocked", "url": exc.url, "reason": exc.reason}))
        raise HTTPException(status_code=400, detail=f"URL not allowed: {exc.reason}")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch {url}: {exc}")

    return parse_page(resp.text, url)


@app.get("/health")
def health():
    return {"status": "ok"}
