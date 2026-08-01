# Terms of Service (Sprint 6 draft — NOT legal advice, needs real legal review)

> **This is a placeholder/skeleton, not a legally reviewed Terms of Service.** Terms of Service are highly specific to the actual business relationship (who's the operator, who are the users, what's the liability model, what jurisdiction's law governs, what happens on a dispute). None of that is something an engineering pass can responsibly draft from first principles. Do not publish this without a lawyer's involvement.

## What would need to be defined (checklist for legal drafting, not filled in here)

- **Parties**: who operates this platform (the legal entity), and who the "users" are (internal team members using `apps/admin`? External customers if this is ever offered as a service to other brands? The spec so far describes an internal tool, not a multi-tenant SaaS product — `docs/ARCHITECTURE.md` "Explicitly not built yet" confirms per-tenant auth doesn't exist).
- **Acceptable use**: this system is explicitly built to *not* be an email harvester or mass-sender (`PROJECT.md` non-goals, `docs/SECURITY.md`) — any real ToS should codify these same limits as binding terms, not just internal engineering discipline, if the platform is ever exposed to users outside the immediate operating team.
- **Data ownership**: who owns the creator data collected, the AI-generated drafts, the campaign/send history.
- **Liability/warranty disclaimers**: standard "as-is" language, appropriate for the actual risk profile (a system that sends real email on a company's behalf carries real deliverability/reputation/legal risk if misused — see `docs/legal/CAN_SPAM_CHECKLIST.md`).
- **Termination**: what happens to stored data if an internal user's access is revoked, or if the operator discontinues the platform.
- **Governing law/jurisdiction**.

## What this document is NOT

It is not a substitute for the above being drafted by counsel. Treat its presence as a marker that "Terms of Service" was flagged as a Sprint 6 deliverable and requires real legal work before this system is used beyond internal, trusted-operator testing — not as evidence that terms are actually in force.
