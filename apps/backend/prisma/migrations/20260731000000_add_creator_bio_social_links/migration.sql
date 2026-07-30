-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "socialLinks" TEXT[] DEFAULT ARRAY[]::TEXT[];

