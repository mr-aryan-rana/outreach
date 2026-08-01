import "server-only";
import { PrismaClient } from "@prisma/client";

// Singleton pattern to avoid exhausting the connection pool with a new
// PrismaClient per hot-reload in dev -- same pattern as apps/backend/apps/ai/
// apps/email's own src/db.ts.
const globalForPrisma = globalThis as unknown as { adminPrisma?: PrismaClient };

export const adminDb = globalForPrisma.adminPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.adminPrisma = adminDb;
}
