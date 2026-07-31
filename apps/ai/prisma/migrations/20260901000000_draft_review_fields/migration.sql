-- Additive only: adds human-review tracking columns to draft_emails for the
-- Sprint 5 (apps/admin) draft approve/reject workflow. No existing column
-- dropped or altered, no data loss.
ALTER TABLE "draft_emails" ADD COLUMN "reviewedBy" TEXT;
ALTER TABLE "draft_emails" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "draft_emails" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
