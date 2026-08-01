import random
import re
import time
from urllib.parse import urlparse, parse_qs, unquote

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from fp.fp import FreeProxy

from app.extractor.core import extract_emails_from_text, extract_phones_from_text
from app.validator.core import is_valid_email
from app.models.models import Creator, Email, Validation
from app.services.categories import (
    CATEGORIES, EMAIL_DOMAIN_HINTS, REGION_TERMS, US_STATES, is_family_friendly,
)
from app.logger import logger

SITE_MAP = {
    "instagram": "instagram.com",
    "youtube": "youtube.com",
    "tiktok": "tiktok.com",
}

HANDLE_PATTERNS = {
    "tiktok": re.compile(r"tiktok\.com/(@[a-zA-Z0-9_.\-]+)"),
    "instagram": re.compile(r"instagram\.com/([a-zA-Z0-9_.\-]+)/?"),
    "youtube": re.compile(r"youtube\.com/(@[a-zA-Z0-9_.\-]+)"),
}

DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/"
DEFAULT_DELAY_SEC = 3.0


class RateLimitedError(Exception):
    """DuckDuckGo's HTML endpoint returned a non-200 (typically 202) --
    its anti-scraping throttle for this IP, not a structural failure."""


from duckduckgo_search import DDGS

import time

import os

def search_ddg(query: str, max_results: int = 20) -> list[dict]:
    """Query Search Engine using ScraperAPI (Google Autoparse) or Yahoo (direct).
    Returns [{url, snippet}, ...]. Snippet contains the indexed preview text
    which often has emails directly."""
    results = []
    
    scraper_api_key = os.environ.get("SCRAPER_API_KEY")
    
    if scraper_api_key:
        # Route through ScraperAPI using Google JSON Autoparse
        url = "http://api.scraperapi.com/"
        params = {
            "api_key": scraper_api_key,
            "url": f"https://www.google.com/search?q={query}",
            "autoparse": "true"
        }
        
        try:
            resp = httpx.get(
                url, 
                params=params, 
                timeout=45
            )
            
            if resp.status_code == 200:
                data = resp.json()
                organic = data.get("organic_results", [])
                for hit in organic:
                    link = hit.get("link", "")
                    snippet = hit.get("snippet", "")
                    if link and snippet:
                        results.append({"url": link, "snippet": snippet})
                        if len(results) >= max_results:
                            break
                            
            elif resp.status_code == 500 or resp.status_code == 429:
                logger.warning(f"ScraperAPI Rate Limit / Error: {resp.status_code}")
                
        except Exception as e:
            logger.warning(f"ScraperAPI Google search failed: {e}")
            
        return results

    # Direct request fallback (Yahoo) - will likely get blocked by Cookie Consent on cloud IPs
    target_url = "https://search.yahoo.com/search"
    url = target_url
    params = {"p": query}
    timeout = 10

    try:
        resp = httpx.get(
            url, 
            params=params, 
            timeout=timeout, 
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        )
        
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            for div in soup.select("div.algo-sr"):
                a_tag = div.select_one("a.ac-algo")
                snippet_el = div.select_one("div.compText")
                
                if a_tag and snippet_el:
                    href = a_tag.get("href", "")
                    snippet = snippet_el.get_text(" ", strip=True)
                    if href and snippet:
                        results.append({"url": href, "snippet": snippet})
                        if len(results) >= max_results:
                            break
                            
        elif resp.status_code == 500:
            # This is Yahoo's rate limit block. Let it fail and let the main loop catch it
            logger.warning("Yahoo Rate Limit (500 INKApi Error)")
            
    except Exception as e:
        logger.warning(f"Yahoo search failed: {e}")
        
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
    in the given categories with every US state (plus the two generic
    region terms) and every email-domain hint. Used by the target-driven
    loop, which needs many distinct queries to keep finding new pages
    rather than re-hitting the same handful repeatedly."""
    site = SITE_MAP.get(platform.lower())
    if not site:
        raise ValueError(f"unsupported platform: {platform}")

    keywords = []
    for cat in categories:
        cat_keywords = CATEGORIES.get(cat)
        if not cat_keywords:
            raise ValueError(f"unknown category: {cat}")
        keywords.extend(cat_keywords)

    regions = REGION_TERMS + US_STATES
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
                                 delay_sec: float = DEFAULT_DELAY_SEC) -> dict:
    """Run a capped set of dork queries for a creator category, pulling
    emails/phones straight out of DuckDuckGo's indexed snippet text --
    no page fetch needed, since that's already been proven to come back
    empty for these JS-rendered platforms."""
    queries = build_dork_queries(platform, category, max_queries)

    results_seen, creators_found, emails_found, phones_found = 0, 0, 0, 0

    for i, query in enumerate(queries):
        try:
            hits = search_ddg(query, max_results_per_query)
        except RateLimitedError as e:
            logger.warning(f"dork search stopped early (rate-limited): {e}")
            break

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
            time.sleep(delay_sec)

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


# Hard safety ceiling on total DDG requests for one target-search run. A
# literal unbounded loop would keep hammering DuckDuckGo indefinitely if the
# target is never reached (finite keyword/state/domain pool, or a
# persistent block) -- this caps the blast radius while still giving the
# loop plenty of room (50 states x ~4 keywords x 4 domains x several
# categories is already thousands of queries) to reach a 300-email target.
MAX_QUERIES_SAFETY_CAP = 800
MAX_CONSECUTIVE_RATE_LIMITS = 6
RATE_LIMIT_BACKOFF_SEC = 45.0


def search_until_target(db: Session, platform: str, category: str, target_valid: int = 300,
                         delay_sec: float = DEFAULT_DELAY_SEC) -> dict:
    """Keep running dork queries -- cycling through every category if
    category == 'all' -- until `target_valid` validated emails exist in the
    DB, or the query pool / safety cap / repeated rate-limiting forces a
    stop. Every email found is validated (syntax + MX) immediately and only
    counts toward the target once confirmed valid. Never sends anything --
    storage only, so results just accumulate in the dashboard's email list."""
    categories = list(CATEGORIES.keys()) if category == "all" else [category]
    queries = build_query_pool(platform, categories)

    def current_valid_count() -> int:
        return db.scalar(select(func.count(Email.id)).where(Email.is_valid.is_(True))) or 0

    starting_valid = current_valid_count()
    queries_run, results_seen = 0, 0
    creators_found, emails_found, phones_found, valid_found = 0, 0, 0, 0
    consecutive_rate_limits = 0

    for query in queries:
        if queries_run >= MAX_QUERIES_SAFETY_CAP:
            logger.warning(f"search_until_target hit safety cap of {MAX_QUERIES_SAFETY_CAP} queries")
            break
        if current_valid_count() - starting_valid >= target_valid:
            break

        try:
            hits = search_ddg(query, max_results=20)
            consecutive_rate_limits = 0
        except RateLimitedError as e:
            consecutive_rate_limits += 1
            logger.warning(f"rate-limited ({consecutive_rate_limits}/{MAX_CONSECUTIVE_RATE_LIMITS}): {e}")
            if consecutive_rate_limits >= MAX_CONSECUTIVE_RATE_LIMITS:
                logger.warning("too many consecutive rate limits, stopping")
                break
            time.sleep(RATE_LIMIT_BACKOFF_SEC)
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

        time.sleep(delay_sec)

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
