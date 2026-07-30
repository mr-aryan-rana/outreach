import pytest

from main import SsrfBlockedError, _assert_safe_target, parse_page

FIXTURE_HTML = """
<html>
  <body>
    <h1>The Quist Family</h1>
    <p>Business inquiries: CourtneyandAlexQuist@gmail.com</p>
    <a href="https://instagram.com/thequistfamily">Instagram</a>
    <a href="https://www.youtube.com/thequistfamily">YouTube</a>
  </body>
</html>
"""


def test_parse_page_extracts_email_lowercased():
    result = parse_page(FIXTURE_HTML, "https://example.com/bio")
    assert result.email == "courtneyandalexquist@gmail.com"


def test_parse_page_extracts_social_links():
    result = parse_page(FIXTURE_HTML, "https://example.com/bio")
    assert "https://instagram.com/thequistfamily" in result.social_links
    assert any("youtube.com" in link for link in result.social_links)


def test_parse_page_no_email_returns_none():
    result = parse_page("<html><body>no contact info</body></html>", "https://example.com")
    assert result.email is None


def test_parse_page_sets_source_url():
    result = parse_page(FIXTURE_HTML, "https://example.com/bio")
    assert result.source_url == "https://example.com/bio"


# SSRF guard (apps/python/extractor/main.py _assert_safe_target). Uses
# IP-literal URLs so socket.getaddrinfo needs no real DNS lookup -- these
# run offline/deterministically in CI.
@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://127.0.0.1:6379/",
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata endpoint
        "http://10.0.0.5/",
        "http://172.16.0.5/",
        "http://192.168.1.5/",
        "http://[::1]/",
        "http://0.0.0.0/",
    ],
)
def test_assert_safe_target_blocks_internal_addresses(url):
    with pytest.raises(SsrfBlockedError):
        _assert_safe_target(url)


def test_assert_safe_target_blocks_non_http_scheme():
    with pytest.raises(SsrfBlockedError):
        _assert_safe_target("file:///etc/passwd")


def test_assert_safe_target_allows_public_ip_literal():
    _assert_safe_target("http://8.8.8.8/")  # does not raise
