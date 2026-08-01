# Domain Verification Runbook (Sprint 6)

This is a **documentation/runbook deliverable, not code** — SPF/DKIM/DMARC/warm-up are DNS records and provider-account settings that live outside this repo, on a domain and DNS provider this project doesn't own or have credentials for. Nothing here can be executed by an automated agent; it's the step-by-step guide for whoever owns the sending domain to follow before any real (non-mock) `apps/email` provider goes live. See `DEPLOYMENT.md` "Deliverability setup" for the condensed version and how it ties into `apps/email`'s bounce-webhook auto-suppression.

## Prerequisites

- A domain you control DNS for (a subdomain dedicated to sending, e.g. `mail.yourcompany.com` or `outreach.yourcompany.com`, is strongly recommended over your primary domain — isolates sending reputation from your main domain's, and a reputation problem doesn't take down your primary email).
- An account with your chosen provider (Resend, AWS SES, SendGrid, or an SMTP relay) with that domain added as a "sending domain" / "verified identity."
- Access to your DNS provider's control panel (Cloudflare, Route53, Namecheap, etc.) to add TXT/CNAME/MX records.

## 1. SPF (Sender Policy Framework)

Tells receiving mail servers which servers are allowed to send mail claiming to be from your domain.

1. In your provider's dashboard, find the SPF record they require (each provider publishes their own `include:` value):
   - **Resend**: `include:_spf.resend.com` (their dashboard shows the exact current value).
   - **SES**: `include:amazonses.com` (region-specific, check your SES console).
   - **SendGrid**: `include:sendgrid.net`.
   - **Generic SMTP relay**: whatever your relay provider documents.
2. Add (or merge into an existing) TXT record at your domain root or sending subdomain:
   ```
   v=spf1 include:<provider-value> ~all
   ```
   If you already have an SPF record for another purpose (e.g. Google Workspace), **merge the `include:` values into one record** — a domain can only have one SPF TXT record; two are invalid and will cause SPF to fail entirely.
3. Verify:
   ```bash
   dig TXT yourdomain.com +short | grep spf1
   ```

## 2. DKIM (DomainKeys Identified Mail)

Cryptographically signs outgoing mail so receivers can verify it wasn't tampered with in transit.

1. In your provider's dashboard, enable DKIM signing for your sending domain/identity. The provider generates a key pair and gives you one or more CNAME (or TXT, provider-dependent) records to add — typically 2-3 records like `resend._domainkey.yourdomain.com` or `s1._domainkey.yourdomain.com`.
2. Add each record exactly as given (host/name and value) in your DNS provider.
3. Verify (per record, using the exact host the provider gave you):
   ```bash
   dig CNAME resend._domainkey.yourdomain.com +short
   ```
4. Most providers show a "verified" / green-check status in their dashboard once DNS propagates (can take minutes to a few hours) — wait for that before sending real mail, not just for the `dig` command to resolve.

## 3. DMARC (Domain-based Message Authentication, Reporting & Conformance)

Tells receivers what to do with mail that fails SPF/DKIM, and where to send aggregate reports.

1. Add a TXT record at `_dmarc.yourdomain.com`:
   ```
   v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com; pct=100
   ```
   **Start with `p=none`** (monitor only, don't reject/quarantine anything) for at least 1-2 weeks while you confirm SPF/DKIM alignment is clean via the aggregate reports.
2. Once reports show SPF+DKIM consistently passing for your legitimate sending sources:
   ```
   v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@yourdomain.com; pct=100
   ```
   and eventually `p=reject` once fully confident — this is what actually stops spoofing of your domain.
3. Verify:
   ```bash
   dig TXT _dmarc.yourdomain.com +short
   ```

## 4. Dedicated sending domain/subdomain

Use a subdomain (not your primary domain) for `apps/email` sending — e.g. `SenderProfile.fromEmail` should be `outreach@mail.yourcompany.com`, not `outreach@yourcompany.com`. This isolates sending reputation: if the subdomain's reputation degrades (high bounce/complaint rate), it doesn't affect deliverability of mail from your primary domain (billing receipts, password resets, etc.), and vice versa.

## 5. Warm-up schedule

A brand-new sending domain/IP has zero reputation with receiving mail providers (Gmail, Outlook, etc.) — sending at full volume immediately gets flagged as spam-like behavior. Ramp gradually:

| Week | Suggested `MAX_EMAILS_PER_DAY` | Notes |
|---|---|---|
| 1 | 50 | Send to your most-engaged/likely-to-open list first if possible |
| 2 | 100-200 | Watch bounce/complaint rates via `GET /dashboard/rates` |
| 3 | 500 | Continue only if bounce rate stays under ~2% and complaint rate under ~0.1% |
| 4+ | 1000+ | Increase gradually; large jumps (10x+ week over week) re-trigger spam heuristics even on an established domain |

`apps/email`'s `MAX_EMAILS_PER_DAY`/`MAX_EMAILS_PER_HOUR`/`EMAIL_DELAY_MIN`/`EMAIL_DELAY_MAX` env vars (`sendCampaign()`, `docs/API.md`) space sends out programmatically and cap daily/hourly volume — but **the ceiling values themselves must be raised manually** by whoever owns the sending domain as reputation builds. This service does not automate warm-up ramping or read real-world bounce/complaint signals to auto-adjust these values.

## 6. DNS verification checklist (run before flipping any SenderProfile off `mock`)

```bash
# SPF
dig TXT yourdomain.com +short | grep spf1

# DKIM (substitute your provider's actual selector/host)
dig CNAME <selector>._domainkey.yourdomain.com +short

# DMARC
dig TXT _dmarc.yourdomain.com +short

# Confirm the provider's own dashboard shows "verified" for the domain --
# DNS resolving correctly is necessary but not sufficient; the provider
# needs to have independently re-checked and marked it verified too.
```

## 7. Bounce/complaint webhook registration

Once DNS is verified, register `apps/email`'s webhook URL in the provider's dashboard (`POST https://<your-email-service-host>/api/v1/webhooks/{resend,sendgrid,ses}`) so bounce/complaint events reach `applyEvent()`'s auto-suppression logic (`docs/API.md` "Email Delivery Service"). Set `RESEND_WEBHOOK_SECRET`/`SENDGRID_WEBHOOK_PUBLIC_KEY`/`SES_SNS_VERIFY_SIGNATURE` (`docs/SECURITY.md` "Webhook authentication") **before** registering the real webhook, not after — an unverified webhook accepting unauthenticated requests is a live vulnerability the moment it's publicly reachable, however briefly.

For SES specifically: the SNS topic subscription confirmation handshake is not automated by this service (`POST /webhooks/ses` only logs receipt today — see `docs/API.md`) — you must complete that manually via the SNS console or by hand-crafting the confirmation request before real bounce events will start flowing.
