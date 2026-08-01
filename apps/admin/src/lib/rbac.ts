export const ROLES = ["admin", "reviewer", "operator", "readonly"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Every mutating proxy request is classified into one of these permission
 * buckets by its HTTP method + path (src/lib/permissionForRequest.ts), then
 * checked against the caller's role here. This is the actual enforcement
 * point -- server-side, in the proxy route handler, not just a UI affordance
 * hidden/shown by role. A "readonly" user calling the real endpoint via curl
 * with a valid session cookie is refused exactly the same as one clicking a
 * hidden button would have been.
 */
export type Permission =
  | "draft.review" // approve/reject/edit a draft
  | "ai.generate" // trigger AI summary/brand-fit/draft generation
  | "campaign.manage" // create/approve/send/pause/resume a campaign
  | "suppression.manage" // add a suppression entry
  | "sender_profile.manage" // create a sender profile
  | "queue.retry" // retry a dead-lettered job
  | "recipient.manage" // mark-replied
  | "ingest.run"; // trigger the backend discovery pipeline

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    "draft.review",
    "ai.generate",
    "campaign.manage",
    "suppression.manage",
    "sender_profile.manage",
    "queue.retry",
    "recipient.manage",
    "ingest.run",
  ]),
  reviewer: new Set<Permission>(["draft.review"]),
  operator: new Set<Permission>([
    "ai.generate",
    "campaign.manage",
    "suppression.manage",
    "sender_profile.manage",
    "queue.retry",
    "recipient.manage",
    "ingest.run",
  ]),
  readonly: new Set<Permission>([]),
};

export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
