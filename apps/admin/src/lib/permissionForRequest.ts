import type { Permission } from "./rbac";

/**
 * Classifies a proxied request into the permission bucket that must be
 * checked before it's allowed through (src/app/api/proxy/*\/[...path]/route.ts).
 * GET requests are never gated by role -- every authenticated user (down to
 * "readonly") can view everything; only mutations are permission-checked.
 * Returns `undefined` for a mutating action that doesn't map to a known
 * permission -- callers must treat that as "admin only" (fail closed, never
 * fail open on an unrecognized route).
 */
export function permissionForRequest(method: string, service: string, path: string): Permission | null | undefined {
  if (method === "GET") return null; // no gate

  const segments = path.split("/").filter(Boolean);

  if (service === "ai") {
    if (segments[0] === "ai" && segments[1] === "drafts") return "draft.review"; // PATCH /ai/drafts/:id
    if (segments[0] === "ai" && ["summary", "brand-fit", "draft"].includes(segments[1])) return "ai.generate";
    return undefined;
  }

  if (service === "email") {
    if (segments[0] === "campaigns") {
      if (segments.includes("mark-replied")) return "recipient.manage";
      return "campaign.manage"; // create, approve, send, pause, resume
    }
    if (segments[0] === "suppression") return "suppression.manage";
    if (segments[0] === "sender-profiles") return "sender_profile.manage";
    if (segments[0] === "dashboard" && segments.includes("retry")) return "queue.retry";
    return undefined;
  }

  if (service === "backend") {
    if (segments[0] === "ingest") return "ingest.run";
    return undefined;
  }

  return undefined;
}
