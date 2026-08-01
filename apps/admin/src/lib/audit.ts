import "server-only";
import type { Prisma } from "@prisma/client";
import { adminDb } from "./adminDb";
import { logger } from "./logger";
import type { Role } from "./rbac";

export interface AuditEntry {
  userId: string | null;
  userEmail: string;
  role: Role;
  action: string;
  method: string;
  path: string;
  statusCode?: number;
  metadata?: unknown;
}

/**
 * Best-effort: an audit-log write failure must never block or fail the
 * actual admin action (that would make this app's own observability a new
 * single point of failure). Logged loudly instead so a broken audit trail
 * is visible in ops, not silently swallowed.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await adminDb.auditLog.create({
      data: {
        userId: entry.userId,
        userEmail: entry.userEmail,
        role: entry.role,
        action: entry.action,
        method: entry.method,
        path: entry.path,
        statusCode: entry.statusCode ?? null,
        metadata: entry.metadata === undefined ? undefined : (entry.metadata as Prisma.InputJsonValue),
      },
    });
  } catch (err) {
    logger.error({ event: "audit_log_write_failed", error: (err as Error).message, entry });
  }
}
