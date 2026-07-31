-- Additive only: index to support apps/admin (Sprint 5)'s Creator Detail
-- "Campaign History" tab, which queries campaign_recipients by creatorId.
CREATE INDEX "campaign_recipients_creatorId_idx" ON "campaign_recipients"("creatorId");
