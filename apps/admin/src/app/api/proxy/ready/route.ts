import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/serverEnv";

const TARGETS = {
  backend: serverEnv.backendUrl,
  ai: serverEnv.aiServiceUrl,
  email: serverEnv.emailServiceUrl,
} as const;

/**
 * /health, /ready, /metrics are unversioned on every service (no /api/v1
 * prefix, see docs/API.md) -- kept as a separate tiny route rather than
 * complicating proxyHandler.ts's path-building for one special case. Used by
 * the Dashboard and Settings pages' system-status views.
 */
export async function GET(req: NextRequest) {
  const service = req.nextUrl.searchParams.get("service") as keyof typeof TARGETS | null;
  if (!service || !(service in TARGETS)) {
    return NextResponse.json({ error: { code: "invalid_query", message: "service must be backend|ai|email" } }, { status: 400 });
  }

  try {
    const res = await fetch(`${TARGETS[service]}/ready`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { status: "not_ready", checks: [{ name: service, ok: false, error: (err as Error).message }] },
      { status: 503 }
    );
  }
}
