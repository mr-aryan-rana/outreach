from unittest.mock import patch

from main import validate_email


def test_invalid_syntax_rejected():
    result = validate_email("not-an-email")
    assert result.is_valid is False
    assert "invalid_syntax" in result.reasons


def test_disposable_domain_rejected():
    result = validate_email("someone@mailinator.com")
    assert result.is_valid is False
    assert "disposable_domain" in result.reasons


@patch("main.has_mx_record", return_value=True)
def test_valid_email_with_mx_accepted(_mock_mx):
    result = validate_email("courtneyandalexquist@gmail.com")
    assert result.is_valid is True
    assert result.confidence_score == 1.0
    assert "mx_ok" in result.reasons


@patch("main.has_mx_record", return_value=False)
def test_valid_syntax_but_no_mx_rejected(_mock_mx):
    result = validate_email("someone@nonexistent-domain-xyz.com")
    assert result.is_valid is False
    assert "mx_failed" in result.reasons
