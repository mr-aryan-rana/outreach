import ipaddress
import socket
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

REQUEST_TIMEOUT = 20
MAX_REDIRECTS = 5


class SsrfBlockedError(Exception):
    def __init__(self, url: str, reason: str):
        self.url = url
        self.reason = reason
        super().__init__(f"blocked {url}: {reason}")


def _assert_safe_target(url: str) -> None:
    """SSRF guard: candidate URLs here ultimately come from search results
    (attacker-influenceable), so before fetching we must confirm the
    resolved address is a real public host -- not localhost, an RFC1918
    range, or the cloud metadata address (169.254.169.254)."""
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
            ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_reserved or ip.is_multicast or ip.is_unspecified
        ):
            raise SsrfBlockedError(url, f"resolves to non-public address {ip}")


def fetch_page(url: str) -> Optional[httpx.Response]:
    """SSRF-safe GET with a manual redirect loop -- each hop is re-validated
    individually, since a same-origin check on the initial URL alone wouldn't
    stop a page from 302-redirecting to an internal address."""
    current_url = url
    resp = None
    try:
        for _ in range(MAX_REDIRECTS + 1):
            _assert_safe_target(current_url)
            resp = httpx.get(
                current_url, timeout=REQUEST_TIMEOUT, follow_redirects=False,
                headers={"User-Agent": "Mozilla/5.0 (compatible; OutreachBot/1.0)"},
            )
            if resp.is_redirect:
                current_url = str(resp.next_request.url)
                continue
            break
        else:
            return None
        resp.raise_for_status()
        return resp
    except (SsrfBlockedError, httpx.HTTPError):
        return None


def fetch_page_content(url: str) -> Optional[str]:
    resp = fetch_page(url)
    return resp.text if resp is not None else None


def extract_page_title(html: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        return og_title["content"].strip()
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    return None


def extract_links_from_page(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links = set()
    for a in soup.find_all("a", href=True):
        links.add(a["href"])
    return list(links)
