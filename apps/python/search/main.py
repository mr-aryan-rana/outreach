import os
import sys
from typing import List, Literal

from ddgs import DDGS
from fastapi import FastAPI
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))
from request_logging import RequestLoggingMiddleware, configure_json_logging  # noqa: E402

app = FastAPI(title="MakeAble Search Service")
logger = configure_json_logging("search")
app.add_middleware(RequestLoggingMiddleware, logger=logger, service_name="search")

SITE_MAP = {
    "instagram": "site:instagram.com",
    "youtube": "site:youtube.com",
    "tiktok": "site:tiktok.com",
}

MAX_RESULTS = int(os.getenv("SEARCH_MAX_RESULTS", "20"))


class SearchRequest(BaseModel):
    platform: Literal["instagram", "youtube", "tiktok"]
    niche: str = Field(min_length=1, max_length=200)


class SearchResponse(BaseModel):
    urls: List[str]


def build_query(platform: str, niche: str) -> str:
    site = SITE_MAP.get(platform.lower())
    if not site:
        raise ValueError(f"Unsupported platform: {platform}")
    return f'{site} "{niche}"'


def extract_urls(results) -> List[str]:
    """Return only the profile/page URLs from search results -- never touch
    result bodies/snippets for email extraction. Emails are only ever pulled
    from the real page by the extractor service.
    """
    urls: List[str] = []
    for result in results:
        url = result.get("href") or result.get("url")
        if url and url not in urls:
            urls.append(url)
    return urls


@app.post("/search", response_model=SearchResponse)
def search(req: SearchRequest) -> SearchResponse:
    query = build_query(req.platform, req.niche)
    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=MAX_RESULTS))
    return SearchResponse(urls=extract_urls(results))


@app.get("/health")
def health():
    return {"status": "ok"}
