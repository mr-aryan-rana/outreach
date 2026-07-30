import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "shared"))
from email_utils import clean_email, domain_of, extract_emails, is_disposable  # noqa: E402


def test_clean_email_trims_sentence_runon_after_known_tld():
    # Regression: bios/snippets often run straight into the next sentence,
    # e.g. "...email: emily.krogsbol@gmail.com.Watch emily.and.christian's..."
    # and the regex folds ".Watch" into the domain.
    assert clean_email("emily.krogsbol@gmail.com.watch") == "emily.krogsbol@gmail.com"


def test_clean_email_rejects_garbage():
    assert clean_email("not-an-email") is None


def test_clean_email_keeps_legit_subdomain():
    assert clean_email("user@sub.example.com") == "user@sub.example.com"


def test_extract_emails_lowercases_and_dedupes():
    text = "Collab: A@Example.com or a@example.com"
    assert extract_emails(text) == ["a@example.com"]


def test_is_disposable():
    assert is_disposable("x@mailinator.com") is True
    assert is_disposable("x@gmail.com") is False


def test_domain_of():
    assert domain_of("x@gmail.com") == "gmail.com"
