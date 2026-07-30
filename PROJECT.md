# PROJECT.md

> **Version:** 1.0
> **Project:** MakeAble
> **Type:** AI Creator Outreach Platform
> **Status:** Production Development

---

# 🚨 READ THIS BEFORE WRITING ANY CODE

Every developer and every AI agent MUST read this file before making any code changes.

The objective is NOT to finish tasks quickly.

The objective is to build a scalable, maintainable, secure, production-ready platform.

Never sacrifice architecture for speed.

Always understand before implementing.

---

# 1. Project Vision

MakeAble helps brands discover creators, find publicly available business contact information, personalize outreach, and manage creator collaborations.

The platform focuses on:

• Quality over quantity
• Long-term maintainability
• Security
• Scalability
• AI-assisted productivity
• Clean architecture

---

# 2. Project Goals

Primary Goals

✓ Discover creators

✓ Extract publicly available business information

✓ Validate business email addresses

✓ AI personalize every outreach email

✓ Send collaboration emails

✓ Track outreach analytics

✓ Prevent duplicate outreach

✓ Scale to millions of creators

---

# 3. Non Goals

This project must NEVER become:

✗ Spam software

✗ Mass mail sender

✗ Email harvester

✗ Private information collector

✗ Platform policy bypass tool

Only publicly available business information may be used.

---

# 4. System Architecture

                        Frontend
                           │
                           ▼
                     Backend API
                           │
 ┌──────────────┬──────────┴───────────┬──────────────┐
 ▼              ▼                      ▼              ▼
Python      AI Service           Email Service     Analytics
Search      Personalization      SMTP/API          Dashboard
Crawler
Extractor
Validator
                           │
                           ▼
                     PostgreSQL
                           │
                           ▼
                         Redis

---

# 5. Tech Stack

Frontend

- React
- Next.js
- TypeScript

Backend

- Node.js
- Express/Fastify
- TypeScript

Python Services

- Search
- Crawling
- Extraction
- Validation

Database

PostgreSQL

Cache

Redis

Queue

BullMQ

Storage

S3

Deployment

Docker

---

# 6. Folder Structure

/apps

/backend

/frontend

/python

/search

/extractor

/validator

/ai

/shared

/docs

/tests

/scripts

---

# 7. Service Responsibilities

Python Search

Responsible for:

Google search

DuckDuckGo search

Public website discovery

Return URLs only

Never send emails

Never use AI

---

Python Extractor

Responsible for:

Visit webpage

Extract public email

Extract creator info

Extract website

Extract social links

Return structured data

No database writes

---

Python Validator

Responsible for:

Syntax validation

MX validation

Disposable detection

Confidence score

Return validation only

---

Node Backend

Responsible for:

Business logic

Authentication

Campaigns

Creator management

Email queue

API

Database

Redis

---

AI Service

Responsible for:

Email personalization

Subject generation

Creator summary

Quality scoring

Spam risk review

Brand fit analysis

AI must NEVER fabricate data.

---

Email Service

Responsible for:

SMTP

Provider APIs

Rate limiting

Retries

Delivery logs

Never generate content.

---

# 8. Daily Targets

Target

200 personalized emails/day

Rules

Every email must be personalized.

No bulk identical emails.

Every recipient must pass validation.

Never exceed configured limits.

---

# 9. Duplicate Prevention

Before sending email check:

Email

Website

Instagram

YouTube

TikTok

Creator UUID

Campaign

If duplicate exists:

Skip

Log reason

Update timestamp

Never send duplicates.

---

# 10. Database Rules

PostgreSQL is source of truth.

Tables

creators

emails

campaigns

email_logs

validation_results

Indexes

email

website

campaign_id

creator_id

instagram

youtube

tiktok

Never use SELECT *

Always paginate.

Always use indexes.

---

# 11. Redis Rules

Redis is mandatory.

Use Redis for:

Duplicate cache

Rate limiting

Job queue

Temporary sessions

Validation cache

Search cache

AI cache

Keys

creator:email:{email}

creator:website:{domain}

campaign:{id}

validation:{email}

TTL configurable.

---

# 12. Environment Variables

DATABASE_URL=

REDIS_URL=

OPENAI_API_KEY=

ANTHROPIC_API_KEY=

SMTP_HOST=

SMTP_PORT=

SMTP_USERNAME=

SMTP_PASSWORD=

EMAIL_FROM=

EMAIL_REPLY_TO=

EMAIL_PROVIDER=

MAX_EMAILS_PER_DAY=200

MAX_EMAILS_PER_HOUR=30

EMAIL_DELAY_MIN=30

EMAIL_DELAY_MAX=120

SEARCH_CONCURRENCY=5

REQUEST_TIMEOUT=20

CACHE_TTL=3600

VALIDATION_TTL=86400

LOG_LEVEL=info

---

# 13. Search Rules

Search only public sources.

Allowed

Google

DuckDuckGo

Official websites

Public contact pages

Public creator pages

Extract

Name

Website

Business email

Social links

Location (public)

Bio

Never collect:

Passwords

Private emails

Hidden information

---

# 14. Email Validation Rules

Every email must pass

Syntax

Domain

MX

Disposable check

Optional

SMTP verification

Assign confidence score.

Reject low confidence emails.

---

# 15. AI Rules

AI may

Generate subject

Generate email

Summarize creator

Score creator quality

Improve grammar

Improve tone

Review spam risk

AI must NEVER

Invent facts

Guess emails

Guess creator names

Guess company info

Send emails

Ignore validation

Ignore duplicate detection

---

# 16. Email Sending Rules

Before sending verify

Validation passed

Duplicate check passed

Campaign active

Rate limit passed

Daily limit passed

AI personalization complete

If any fails

DO NOT SEND.

Log reason.

---

# 17. Rate Limits

Maximum

200/day

30/hour

Random delay

30-120 seconds

Automatic retry

Maximum 3 retries

Exponential backoff

---

# 18. Logging

Every important event logs

Timestamp

Campaign

Creator

Email

Duration

Result

Validation score

AI score

SMTP response

Duplicate reason

Never log

Passwords

API Keys

Secrets

Tokens

---

# 19. Security

Validate everything.

Sanitize inputs.

Use prepared statements.

Use environment variables.

Rate limit APIs.

Encrypt secrets.

Never expose credentials.

---

# 20. Performance

Avoid duplicate requests.

Use async.

Use caching.

Use indexes.

Queue expensive work.

Measure performance.

No premature optimization.

---

# 21. Error Handling

Never swallow exceptions.

Provide meaningful errors.

Retry temporary failures.

Log unexpected failures.

---

# 22. Testing

Every feature requires

Unit tests

Integration tests

Edge cases

Failure tests

Performance review

---

# 23. Git Workflow

Feature Branch

↓

Review

↓

Testing

↓

Merge

↓

Production

Never commit directly to main.

---

# 24. Documentation

Every module must include

Purpose

Inputs

Outputs

Dependencies

Examples

Limitations

---

# 25. Code Review Checklist

Architecture

Security

Performance

Scalability

Database

Redis

API

Testing

Documentation

Edge cases

Error handling

Logging

Maintainability

---

# 26. AI Response Requirements

Every AI response MUST contain

1. Understanding

2. Current Implementation

3. Problems

4. Root Cause

5. Questions

6. Solution Options

7. Recommended Solution

8. Architecture Impact

9. Database Impact

10. Redis Impact

11. Security Review

12. Performance Review

13. Risks

14. Implementation Plan

15. Code

16. Self Review

17. Future Improvements

Never return code only.

Always explain reasoning.

---

# 27. Success Criteria

The project is successful when:

✓ Clean Architecture

✓ Production Ready

✓ Secure

✓ Scalable

✓ Maintainable

✓ Well Documented

✓ Low Technical Debt

✓ High Performance

✓ No Duplicate Outreach

✓ AI Assists Developers, Not Replaces Engineering Judgment

Every implementation should make the codebase easier to maintain than before.