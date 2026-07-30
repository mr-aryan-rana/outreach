from main import parse_page

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
