import pytest

from main import build_query, extract_urls


def test_build_query_known_platform():
    assert build_query("instagram", "couple vlog") == 'site:instagram.com "couple vlog"'


def test_build_query_unknown_platform_raises():
    with pytest.raises(ValueError):
        build_query("mastodon", "couple vlog")


def test_extract_urls_dedupes_and_ignores_snippets():
    results = [
        {"href": "https://instagram.com/a", "body": "email: a@gmail.com"},
        {"href": "https://instagram.com/a", "body": "duplicate"},
        {"href": "https://instagram.com/b", "body": "email: b@gmail.com"},
    ]
    urls = extract_urls(results)
    assert urls == ["https://instagram.com/a", "https://instagram.com/b"]


def test_extract_urls_skips_missing_href():
    results = [{"body": "no url here"}]
    assert extract_urls(results) == []
