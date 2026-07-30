import os
import sys
from typing import List

import dns.resolver
from fastapi import FastAPI
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))
from email_utils import clean_email, domain_of, is_disposable  # noqa: E402
from request_logging import RequestLoggingMiddleware, configure_json_logging  # noqa: E402

app = FastAPI(title="MakeAble Validator Service")
logger = configure_json_logging("validator")
app.add_middleware(RequestLoggingMiddleware, logger=logger, service_name="validator")


class ValidateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class ValidateResponse(BaseModel):
    is_valid: bool
    confidence_score: float
    reasons: List[str]


def has_mx_record(domain: str) -> bool:
    try:
        answers = dns.resolver.resolve(domain, "MX")
        return len(answers) > 0
    except Exception:
        return False


def validate_email(raw_email: str) -> ValidateResponse:
    reasons: List[str] = []
    score = 0.0

    cleaned = clean_email(raw_email)
    if not cleaned:
        return ValidateResponse(is_valid=False, confidence_score=0.0, reasons=["invalid_syntax"])
    reasons.append("syntax_ok")
    score += 0.3

    if is_disposable(cleaned):
        reasons.append("disposable_domain")
        return ValidateResponse(is_valid=False, confidence_score=round(score, 2), reasons=reasons)
    reasons.append("not_disposable")
    score += 0.2

    if has_mx_record(domain_of(cleaned)):
        reasons.append("mx_ok")
        score += 0.5
    else:
        reasons.append("mx_failed")
        return ValidateResponse(is_valid=False, confidence_score=round(score, 2), reasons=reasons)

    return ValidateResponse(is_valid=True, confidence_score=round(min(score, 1.0), 2), reasons=reasons)


@app.post("/validate", response_model=ValidateResponse)
def validate(req: ValidateRequest) -> ValidateResponse:
    return validate_email(req.email)


@app.get("/health")
def health():
    return {"status": "ok"}
