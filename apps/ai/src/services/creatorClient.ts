import fetch from "node-fetch";
import { env } from "../config/env";

export interface CreatorDetail {
  id: string;
  handle: string;
  platform: string;
  niche: string;
  websiteUrl: string | null;
  bio: string | null;
  socialLinks: string[];
  email: string | null;
  confidenceScore: number | null;
}

export class CreatorNotFoundError extends Error {
  constructor(creatorId: string) {
    super(`creator ${creatorId} not found`);
    this.name = "CreatorNotFoundError";
  }
}

/**
 * Fetches creator content from the backend's own API rather than querying
 * its Postgres tables directly -- apps/ai owns only its own 6 tables (the
 * "ai" schema), the backend remains the sole owner of Creator/Email/
 * ValidationResult (docs/ARCHITECTURE.md). This is the one cross-service
 * call this service makes.
 */
export async function fetchCreator(creatorId: string, requestId?: string): Promise<CreatorDetail> {
  const res = await fetch(`${env.backendUrl}/api/v1/creators/${creatorId}`, {
    headers: {
      "X-API-Key": env.backendApiKey,
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
    timeout: env.requestTimeoutMs,
  });

  if (res.status === 404) {
    throw new CreatorNotFoundError(creatorId);
  }
  if (!res.ok) {
    throw new Error(`backend returned ${res.status} fetching creator ${creatorId}`);
  }
  return (await res.json()) as CreatorDetail;
}
