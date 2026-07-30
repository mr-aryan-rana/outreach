-- Generated via `prisma migrate diff --from-empty --to-schema-datamodel` (no live DB needed for this).
-- Verified to match apps/backend/prisma/schema.prisma exactly; still run
-- `npx prisma migrate deploy` against the real Supabase instance before trusting it in production.

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "instagram" TEXT,
    "youtube" TEXT,
    "tiktok" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationResult" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_websiteUrl_key" ON "Creator"("websiteUrl");

-- CreateIndex
CREATE INDEX "Creator_niche_idx" ON "Creator"("niche");

-- CreateIndex
CREATE INDEX "Creator_platform_idx" ON "Creator"("platform");

-- CreateIndex
CREATE INDEX "Creator_niche_platform_idx" ON "Creator"("niche", "platform");

-- CreateIndex
CREATE INDEX "Creator_instagram_idx" ON "Creator"("instagram");

-- CreateIndex
CREATE INDEX "Creator_youtube_idx" ON "Creator"("youtube");

-- CreateIndex
CREATE INDEX "Creator_tiktok_idx" ON "Creator"("tiktok");

-- CreateIndex
CREATE INDEX "Creator_createdAt_idx" ON "Creator"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_handle_platform_key" ON "Creator"("handle", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Email_address_key" ON "Email"("address");

-- CreateIndex
CREATE INDEX "Email_creatorId_idx" ON "Email"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidationResult_emailId_key" ON "ValidationResult"("emailId");

-- CreateIndex
CREATE INDEX "ValidationResult_checkedAt_idx" ON "ValidationResult"("checkedAt");

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationResult" ADD CONSTRAINT "ValidationResult_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

