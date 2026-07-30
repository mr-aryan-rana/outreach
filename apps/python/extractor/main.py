import os
import re
import sys
from typing import List, Optional

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
        resp = httpx.get(url, timeout=REQUEST_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch {url}: {exc}")

    return parse_page(resp.text, url)


@app.get("/health")
def health():
    return {"status": "ok"}
