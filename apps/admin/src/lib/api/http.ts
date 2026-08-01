export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Service = "backend" | "ai" | "email";

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** /health,/ready,/metrics are unversioned -- see src/app/api/proxy/ready/route.ts. */
export async function fetchReady(service: Service): Promise<{ status: string; checks: { name: string; ok: boolean; error?: string }[] }> {
  const res = await fetch(`/api/proxy/ready?service=${service}`, { cache: "no-store" });
  return res.json();
}

/**
 * Every client-side call goes to this app's own /api/proxy/<service>/*
 * route (src/app/api/proxy/*), never directly to a backend/ai/email service
 * -- the browser never holds an API key. See docs/ARCHITECTURE.md
 * "Admin app".
 */
export async function apiFetch<T>(
  service: Service,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const res = await fetch(`/api/proxy/${service}/${path}${buildQuery(options.query)}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const contentType = res.headers.get("Content-Type") ?? "";
  const payload = contentType.includes("application/json") ? await res.json() : undefined;

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(err?.message ?? res.statusText, res.status, err?.code ?? "unknown_error", err?.details);
  }

  return payload as T;
}
