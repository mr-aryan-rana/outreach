# CAN-SPAM Compliance Checklist (Sprint 6 draft)

> **This is a draft engineering checklist, not legal advice.** CAN-SPAM (and equivalent regimes elsewhere — Canada's CASL, the EU's ePrivacy Directive/GDPR, etc., which are stricter than CAN-SPAM in several ways, e.g. requiring opt-in consent rather than opt-out) have real penalties for non-compliance. **Get sign-off from an actual lawyer before sending any real, non-test email** — this has been flagged since RC1 (`docs/SECURITY.md` "Why the original scraper was replaced") and remains unresolved; it's more load-bearing now that Sprint 4/5/6 built a real send path (`apps/email`) and a UI that makes sending easy (`apps/admin`).

## What CAN-SPAM requires (US) — and where this system stands today

| Requirement | Status | Notes |
|---|---|---|
| **Don't use false/misleading header information** (From/Reply-To/routing info must identify the actual sender) | ✅ Enforced by construction | `SenderProfile.fromEmail`/`fromName` are operator-configured real addresses (`docs/API.md` "Sender Profiles"); nothing in `apps/email` spoofs headers. |
| **Don't use deceptive subject lines** | ⚠️ Operator responsibility | AI-generated subject lines (`apps/ai`) are reviewed by a human before a campaign can send (`docs/SECURITY.md` "Sending-without-approval prevention") — but nothing programmatically checks a subject line isn't misleading. Reviewer judgment is the only control. |
| **Identify the message as an ad** (if applicable — collaboration/partnership outreach may or may not legally qualify as "commercial email" depending on content and jurisdiction; get a legal opinion on your specific use case) | ❌ Not implemented | No automatic "this is a commercial message" disclosure is inserted into draft bodies. |
| **Tell recipients where you're located** (a valid physical postal address) | ❌ Not implemented | No footer/postal-address insertion exists in the draft-generation or send pipeline. `apps/ai`'s prompts (`prompts/email-draft/v1.md`) do not currently instruct the model to include one. |
| **Tell recipients how to opt out** (clear, conspicuous unsubscribe mechanism) | ⚠️ Partially implemented, not in the email body itself | `apps/email` has a real suppression list (`docs/API.md` "Suppression List") and honors it before every send — but there is no unsubscribe *link* rendered inside the actual email body a recipient receives. The draft body comes from `apps/ai`, outside `apps/email`'s control, and nothing currently injects an unsubscribe link at send time. |
| **Honor opt-out requests within 10 business days** (and never sell/transfer the address afterward) | ✅ Enforced by construction, effectively immediate | Once an address is in `suppression_list`, it's checked at both campaign-creation time and again immediately before every send (`docs/SECURITY.md` "Suppression and deduplication guarantees") — there is no delay, and no code path sends to a suppressed address. |
| **Monitor what others do on your behalf** (if using a third-party sender/affiliate) | N/A today | No third-party/affiliate sending exists in this system. |

## Concrete gaps to close before real sending (engineering + legal, in order)

1. **Legal review** of whether this system's specific use case (creator partnership/collaboration outreach) constitutes "commercial electronic mail" under CAN-SPAM and any other applicable regime (recipient's jurisdiction matters — a message to an EU-based creator may trigger GDPR/ePrivacy consent requirements CAN-SPAM doesn't have). This determines which of the boxes above are actually legally required for this specific use case.
2. **If required**: add a physical postal address and unsubscribe link to the email template/prompt (`apps/ai/prompts/email-draft/v1.md`), or have `apps/email` append a standard footer at send time (the latter is more reliable — doesn't depend on the LLM consistently including it).
3. **If an unsubscribe link is added**: it needs a working endpoint that adds the clicking address to `suppression_list` (`POST /api/v1/suppression` already exists and could be the target, but a public, unauthenticated, one-click version would be needed — the current endpoint requires an API key, appropriate for internal/admin use but not for a link inside an email a recipient clicks).
4. **Rate/volume compliance**: already covered by `MAX_EMAILS_PER_DAY`/`MAX_EMAILS_PER_HOUR` (not a CAN-SPAM requirement per se, but relevant to avoiding being flagged as spam by receiving providers regardless of legal compliance — see `DOMAIN_VERIFICATION.md` "Warm-up schedule").

## What NOT to do (explicit non-goals this repo has held since `PROJECT.md`)

- Never harvest emails from search-result snippets or private sources (`docs/SECURITY.md` "Why the original scraper was replaced") — only publicly-listed business contact emails, extracted from the creator's own official page.
- Never auto-send without human approval (`docs/SECURITY.md` "Sending-without-approval prevention") — this remains true regardless of CAN-SPAM status.
- Never bypass or delay honoring the suppression list.
