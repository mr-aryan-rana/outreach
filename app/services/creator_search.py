import json
import random
import re
import time
from typing import Callable
from urllib.parse import urlparse, parse_qs, unquote

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from sqlalchemy import select, func
import urllib.parse

from app.extractor.core import extract_emails_from_text, extract_phones_from_text
from app.validator.core import is_valid_email
from app.models.models import Creator, Email, Validation
from app.services.categories import (
    CATEGORIES, EMAIL_DOMAIN_HINTS, REGION_TERMS, US_STATES, is_family_friendly,
)
from app.utils.config import settings
from app.logger import logger

SITE_MAP = {
    "instagram": "instagram.com",
    "tiktok": "tiktok.com",
}

HANDLE_PATTERNS = {
    "tiktok": re.compile(r"tiktok\.com/(@[a-zA-Z0-9_.\-]+)"),
    "instagram": re.compile(r"instagram\.com/([a-zA-Z0-9_.\-]+)/?"),
}

DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/"
DEFAULT_DELAY_SEC = 3.0


DEFAULT_DELAY_SEC = 3.0

class RateLimitedError(Exception):
    """Playwright hit DDG Rate Limit or CAPTCHA."""


def _query_jitter() -> float:
    return random.uniform(settings.SEARCH_QUERY_DELAY_MIN_SEC, settings.SEARCH_QUERY_DELAY_MAX_SEC)


def _rate_limit_backoff() -> float:
    return random.uniform(settings.SEARCH_RATE_LIMIT_BACKOFF_MIN_SEC, settings.SEARCH_RATE_LIMIT_BACKOFF_MAX_SEC)


def search_serper(query: str, max_results: int = 10) -> list[dict]:
    """Query Google using the Serper API."""
    if not settings.SERPER_KEY:
        logger.warning("SERPER_KEY is not set. Cannot perform search.")
        return []
        
    url = "https://google.serper.dev/search"
    payload = json.dumps({
        "q": query,
        "num": max_results,
        "gl": "us"
    })
    headers = {
        'X-API-KEY': settings.SERPER_KEY,
        'Content-Type': 'application/json'
    }
    
    results = []
    try:
        response = httpx.post(url, headers=headers, data=payload, timeout=15.0)
        
        if response.status_code == 429:
            raise RateLimitedError("Serper hit Rate Limit (429)")
        response.raise_for_status()
        
        data = response.json()
        for item in data.get("organic", [])[:max_results]:
            link = item.get("link")
            snippet = item.get("snippet", "")
            if link and snippet:
                results.append({"url": link, "snippet": snippet})
    except RateLimitedError:
        raise
    except Exception as e:
        logger.warning(f"Serper search failed: {e}")
            
    return results


def build_dork_queries(platform: str, category: str, max_queries: int = 6) -> list[str]:
    """Combine bio keywords + region qualifier + email-domain hint into
    site-scoped dork queries, capped so a single search run stays polite
    to DuckDuckGo's rate limit."""
    site = SITE_MAP.get(platform.lower())
    if not site:
        raise ValueError(f"unsupported platform: {platform}")
    if category == "all":
        keywords = [kw for kws in CATEGORIES.values() for kw in kws]
    else:
        keywords = CATEGORIES.get(category)
        if not keywords:
            raise ValueError(f"unknown category: {category}")

    combos = []
    for keyword in keywords:
        for email_hint in EMAIL_DOMAIN_HINTS:
            region = REGION_TERMS[0] if len(combos) % 2 == 0 else REGION_TERMS[1]
            combos.append(f'site:{site} "{keyword}" "{region}" "{email_hint}"')

    random.shuffle(combos)
    return combos[:max_queries]


def build_query_pool(platform: str, categories: list[str]) -> list[str]:
    """Large, deduped, shuffled pool of dork queries crossing every keyword
    in the given categories with the region terms (plus every US state, if
    SEARCH_INCLUDE_STATE_TERMS is on) and every email-domain hint. Used by
    the target-driven loop, which needs many distinct queries to keep
    finding new pages rather than re-hitting the same handful repeatedly.

    State terms are opt-in: crossing all 50 states into the pool multiplies
    query volume ~26x for marginal result diversity, which is what drove
    the DDG rate limiting in the first place -- see SEARCH_INCLUDE_STATE_TERMS."""
    site = SITE_MAP.get(platform.lower())
    if not site:
        raise ValueError(f"unsupported platform: {platform}")

    keywords = []
    for cat in categories:
        cat_keywords = CATEGORIES.get(cat)
        if not cat_keywords:
            raise ValueError(f"unknown category: {cat}")
        keywords.extend(cat_keywords)

    regions = REGION_TERMS + US_STATES if settings.SEARCH_INCLUDE_STATE_TERMS else list(REGION_TERMS)
    pool = [
        f'site:{site} "{keyword}" "{region}" "{email_hint}"'
        for keyword in keywords
        for region in regions
        for email_hint in EMAIL_DOMAIN_HINTS
    ]
    pool = list(dict.fromkeys(pool))  # dedupe, preserve nothing in particular
    random.shuffle(pool)
    return pool


def _extract_handle(platform: str, url: str) -> str | None:
    pattern = HANDLE_PATTERNS.get(platform.lower())
    if not pattern:
        return None
    m = pattern.search(url)
    return m.group(1) if m else None


def search_and_extract_category(db: Session, platform: str, category: str,
                                 max_results_per_query: int = 20, max_queries: int = 6,
                                 delay_sec: float = DEFAULT_DELAY_SEC,
                                 on_iteration: Callable[[], None] | None = None) -> dict:
    """Run a capped set of dork queries for a creator category, pulling
    emails/phones straight out of DuckDuckGo's indexed snippet text --
    no page fetch needed, since that's already been proven to come back
    empty for these JS-rendered platforms.

    `on_iteration`, if given, is called once per query loop iteration
    (callers use it to refresh a held search lock so a long run doesn't
    lose it to TTL expiry mid-run)."""
    queries = build_dork_queries(platform, category, max_queries)

    results_seen, creators_found, emails_found, phones_found = 0, 0, 0, 0
    consecutive_rate_limits = 0

    for i, query in enumerate(queries):
        if on_iteration:
            on_iteration()

        try:
            hits = search_serper(query, max_results_per_query)
            consecutive_rate_limits = 0
        except RateLimitedError as e:
            consecutive_rate_limits += 1
            logger.warning(
                f"dork search rate-limited ({consecutive_rate_limits}/"
                f"{settings.SEARCH_MAX_CONSECUTIVE_RATE_LIMITS}): {e}"
            )
            if consecutive_rate_limits >= settings.SEARCH_MAX_CONSECUTIVE_RATE_LIMITS:
                logger.warning("dork search: too many consecutive rate limits, stopping")
                break
            time.sleep(_rate_limit_backoff())
            continue

        for hit in hits:
            results_seen += 1
            url, snippet = hit["url"], hit["snippet"]
            if SITE_MAP.get(platform.lower(), "") not in url:
                continue
            if not is_family_friendly(snippet):
                continue

            emails = extract_emails_from_text(snippet)
            phones = extract_phones_from_text(snippet)
            if not emails:
                continue

            handle = _extract_handle(platform, url)
            creator = db.scalar(select(Creator).where(Creator.profile_url == url))
            if creator is None:
                creator = Creator(name=handle or url, platform=platform, profile_url=url)
                db.add(creator)
                db.flush()
                creators_found += 1

            if phones and not creator.phone:
                creator.phone = phones[0]
                phones_found += 1

            for address in emails:
                existing = db.scalar(select(Email).where(Email.address == address))
                if existing is None:
                    ok, reason = is_valid_email(address)
                    email_row = Email(address=address, creator_id=creator.id, is_valid=ok)
                    db.add(email_row)
                    db.flush()
                    db.add(Validation(email_id=email_row.id, syntax_check=True, smtp_check=ok, reason=reason))
                    emails_found += 1

            db.commit()

        if i < len(queries) - 1:
            time.sleep(delay_sec + _query_jitter())

    logger.info(
        f"dork_search platform={platform} category={category}: "
        f"{len(queries)} queries, {results_seen} results seen, "
        f"{creators_found} creators, {emails_found} emails, {phones_found} phones"
    )
    return {
        "platform": platform,
        "category": category,
        "queries_run": len(queries),
        "results_seen": results_seen,
        "creators_found": creators_found,
        "emails_found": emails_found,
        "phones_found": phones_found,
    }


def search_until_target(db: Session, platform: str, category: str, target_valid: int = 300,
                         delay_sec: float = DEFAULT_DELAY_SEC,
                         on_iteration: Callable[[], None] | None = None) -> dict:
    """Keep running dork queries -- cycling through every category if
    category == 'all' -- until `target_valid` validated emails exist in the
    DB, or the query pool / safety cap / repeated rate-limiting forces a
    stop. Every email found is validated (syntax + MX) immediately and only
    counts toward the target once confirmed valid. Never sends anything --
    storage only, so results just accumulate in the dashboard's email list.

    `on_iteration`, if given, is called once per query loop iteration
    (callers use it to refresh a held search lock so a long run doesn't
    lose it to TTL expiry mid-run)."""
    categories = list(CATEGORIES.keys()) if category == "all" else [category]
    queries = build_query_pool(platform, categories)

    def current_valid_count() -> int:
        return db.scalar(select(func.count(Email.id)).where(Email.is_valid.is_(True))) or 0

    starting_valid = current_valid_count()
    queries_run, results_seen = 0, 0
    creators_found, emails_found, phones_found, valid_found = 0, 0, 0, 0
    consecutive_rate_limits = 0

    for query in queries:
        if on_iteration:
            on_iteration()

        if queries_run >= settings.SEARCH_MAX_QUERIES_PER_RUN:
            logger.warning(f"search_until_target hit safety cap of {settings.SEARCH_MAX_QUERIES_PER_RUN} queries")
            break
        if current_valid_count() - starting_valid >= target_valid:
            break

        try:
            hits = search_serper(query, max_results=10)
            consecutive_rate_limits = 0
        except RateLimitedError as e:
            consecutive_rate_limits += 1
            logger.warning(
                f"rate-limited ({consecutive_rate_limits}/{settings.SEARCH_MAX_CONSECUTIVE_RATE_LIMITS}): {e}"
            )
            if consecutive_rate_limits >= settings.SEARCH_MAX_CONSECUTIVE_RATE_LIMITS:
                logger.warning("too many consecutive rate limits, stopping")
                break
            time.sleep(_rate_limit_backoff())
            continue

        queries_run += 1

        for hit in hits:
            results_seen += 1
            url, snippet = hit["url"], hit["snippet"]
            if SITE_MAP.get(platform.lower(), "") not in url or not is_family_friendly(snippet):
                continue

            emails = extract_emails_from_text(snippet)
            phones = extract_phones_from_text(snippet)
            if not emails:
                continue

            handle = _extract_handle(platform, url)
            creator = db.scalar(select(Creator).where(Creator.profile_url == url))
            if creator is None:
                creator = Creator(name=handle or url, platform=platform, profile_url=url)
                db.add(creator)
                db.flush()
                creators_found += 1

            if phones and not creator.phone:
                creator.phone = phones[0]
                phones_found += 1

            for address in emails:
                existing = db.scalar(select(Email).where(Email.address == address))
                if existing is not None:
                    continue
                ok, reason = is_valid_email(address)
                email_row = Email(address=address, creator_id=creator.id, is_valid=ok)
                db.add(email_row)
                db.flush()
                db.add(Validation(email_id=email_row.id, syntax_check=True, smtp_check=ok, reason=reason))
                emails_found += 1
                valid_found += int(ok)

            db.commit()

        time.sleep(delay_sec + _query_jitter())

    total_valid_now = current_valid_count()
    logger.info(
        f"search_until_target platform={platform} category={category} target={target_valid}: "
        f"{queries_run} queries run, {results_seen} results seen, {emails_found} new emails "
        f"({valid_found} valid), total valid in DB now {total_valid_now}"
    )
    return {
        "platform": platform,
        "category": category,
        "target_valid": target_valid,
        "queries_run": queries_run,
        "results_seen": results_seen,
        "creators_found": creators_found,
        "emails_found": emails_found,
        "valid_found_this_run": valid_found,
        "total_valid_in_db": total_valid_now,
        "target_reached": total_valid_now - starting_valid >= target_valid,
    }
