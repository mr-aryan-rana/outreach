import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { permissionForRequest } from "./permissionForRequest";
import { roleCan } from "./rbac";
import { recordAudit } from "./audit";
import { logger } from "./logger";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
// Generous: the AI draft pipeline (8 sequential stages, each its own
// provider call + retry/circuit-breaker policy) legitimately takes ~15-20s
// even with the zero-cost mock provider, measured live during Sprint 5.
const REQUEST_TIMEOUT_MS = 60_000;

export interface ProxyTarget {
  baseUrl: string;
  apiKey: string;
}

/**
 * Every request from the browser to a real backend service goes through one
 * of these three route handlers (proxy/backend, proxy/ai, proxy/email), never
 * directly -- the browser never holds BACKEND_API_KEY/AI_SERVICE_API_KEY/
 * EMAIL_SERVICE_API_KEY (src/lib/serverEnv.ts, "server-only"). This handler:
 *  1. Requires a valid session (middleware.ts already enforces this for the
 *     page routes, but this route handler enforces it independently too --
 *     never assume a caller reached here only via the UI).
 *  2. For mutating methods, checks the caller's role against the permission
 *     the request maps to (src/lib/rbac.ts) -- server-side enforcement, not
 *     just hiding a button. An unmapped mutating route fails closed
 *     (admin-only), not open.
 *  3. Overwrites any client-supplied identity fields (the `approvedBy` body
 *     field, the legacy `X-Reviewed-By` header) with the authenticated
 *     session's real email -- closes the Sprint 5-flagged gap where these
 *     were free-text, unverified strings.
 *  4. Records an audit_log row for every mutating request, before returning
 *     the response, whether it succeeded, was refused, or errored upstream.
 *  5. Does NOT forward the incoming request's own cookies/auth header to the
 *     downstream service -- the only credential attached is this app's own
 *     server-side API key.
 */
export async function proxyRequest(
  req: NextRequest,
  target: ProxyTarget,
  service: "backend" | "ai" | "email",
  pathSegments: string[]
): Promise<NextResponse> {
  if (!ALLOWED_METHODS.has(req.method)) {
    return NextResponse.json(
      { error: { code: "method_not_allowed", message: `${req.method} not supported` } },
      { status: 405 }
    );
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: { code: "unauthorized", message: "not signed in" } }, { status: 401 });
  }
  const { role } = session.user;
  const userEmail = session.user.email ?? "unknown";
  const path = pathSegments.join("/");

  const permission = permissionForRequest(req.method, service, path);
  const isMutating = req.method !== "GET";
  const action = permission ?? (isMutating ? `unmapped:${service}:${req.method}` : `read:${service}`);

  if (isMutating) {
    const allowed = permission ? roleCan(role, permission) : role === "admin"; // fail closed on unmapped routes
    if (!allowed) {
      await recordAudit({ userId: session.user.id, userEmail, role, action, method: req.method, path, statusCode: 403 });
      return NextResponse.json(
        { error: { code: "forbidden", message: `role "${role}" is not permitted to perform this action` } },
        { status: 403 }
      );
    }
  }

  const search = req.nextUrl.search;
  const url = `${target.baseUrl}/api/v1/${pathSegments.map(encodeURIComponent).join("/")}${search}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const hasBody = req.method === "POST" || req.method === "PATCH";
    const body = hasBody ? await rewriteBodyIdentity(await req.text(), service, path, userEmail) : undefined;

    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": target.apiKey,
        "X-Request-Id": req.headers.get("x-request-id") ?? crypto.randomUUID(),
        // Always the authenticated identity now, never a client-supplied
        // header -- see PATCH /ai/drafts/:id's reviewedBy handling.
        ...(isMutating ? { "X-Reviewed-By": userEmail } : {}),
      },
      body,
      signal: controller.signal,
    });

    const text = await upstream.text();

    if (isMutating) {
      await recordAudit({ userId: session.user.id, userEmail, role, action, method: req.method, path, statusCode: upstream.status });
    }

    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isMutating) {
      await recordAudit({
        userId: session.user.id,
        userEmail,
        role,
        action,
        method: req.method,
        path,
        metadata: { error: (err as Error).message },
      });
    }
    logger.warn({ event: "proxy_upstream_error", service, path, error: (err as Error).message });
    return NextResponse.json(
      {
        error: {
          code: isAbort ? "upstream_timeout" : "upstream_unreachable",
          message: isAbort ? `${target.baseUrl} did not respond in time` : (err as Error).message,
        },
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `POST /campaigns/:id/approve` expects `approvedBy` in the JSON body (not a
 * header, per its API contract) -- overwrite it with the real session
 * identity the same way X-Reviewed-By is overwritten for draft review.
 */
async function rewriteBodyIdentity(rawBody: string, service: string, path: string, userEmail: string): Promise<string> {
  const isApprove = service === "email" && path.startsWith("campaigns/") && path.endsWith("/approve");
  if (!isApprove || !rawBody) return rawBody;

  try {
    const parsed = JSON.parse(rawBody);
    parsed.approvedBy = userEmail;
    return JSON.stringify(parsed);
  } catch {
    return rawBody; // malformed JSON -- let the upstream service's own validation reject it
  }
}
