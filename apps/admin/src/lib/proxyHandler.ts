import "server-only";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
// Generous: the AI draft pipeline (8 sequential stages, each its own
// provider call + retry/circuit-breaker policy) legitimately takes ~15-20s
// even with the zero-cost mock provider, measured live during this sprint.
const REQUEST_TIMEOUT_MS = 60_000;

export interface ProxyTarget {
  baseUrl: string;
  apiKey: string;
}

/**
 * Every request from the browser to a real backend service goes through one
 * of these three route handlers (proxy/backend, proxy/ai, proxy/email), never
 * directly -- the browser never holds BACKEND_API_KEY/AI_SERVICE_API_KEY/
 * EMAIL_SERVICE_API_KEY (src/lib/serverEnv.ts, "server-only"). This handler
 * only forwards the path/query/method/body; it does NOT forward the
 * incoming request's own headers (cookies, auth) to the downstream service --
 * the only credential attached is this app's own server-side API key.
 */
export async function proxyRequest(
  req: NextRequest,
  target: ProxyTarget,
  pathSegments: string[]
): Promise<NextResponse> {
  if (!ALLOWED_METHODS.has(req.method)) {
    return NextResponse.json(
      { error: { code: "method_not_allowed", message: `${req.method} not supported` } },
      { status: 405 }
    );
  }

  const path = pathSegments.map(encodeURIComponent).join("/");
  const search = req.nextUrl.search;
  const url = `${target.baseUrl}/api/v1/${path}${search}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const hasBody = req.method === "POST" || req.method === "PATCH";
    const body = hasBody ? await req.text() : undefined;

    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": target.apiKey,
        "X-Request-Id": req.headers.get("x-request-id") ?? crypto.randomUUID(),
        ...(req.headers.get("x-reviewed-by") ? { "X-Reviewed-By": req.headers.get("x-reviewed-by")! } : {}),
      },
      body,
      signal: controller.signal,
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
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
