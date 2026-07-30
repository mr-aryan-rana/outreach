import fetch from "node-fetch";
import { env } from "../config/env";

export interface DraftDetail {
  id: string;
  creatorId: string;
  subject: string;
  body: string;
  status: string;
}

export class DraftNotFoundError extends Error {
  constructor(draftId: string) {
    super(`draft ${draftId} not found`);
    this.name = "DraftNotFoundError";
  }
}

/** Reads draft content from apps/ai over HTTP -- see docs/ARCHITECTURE.md "Email delivery pipeline" for why this service never copies draft content into its own tables ahead of send time. */
export async function fetchDraft(draftId: string, requestId?: string): Promise<DraftDetail> {
  const res = await fetch(`${env.aiServiceUrl}/api/v1/ai/drafts/${draftId}`, {
    headers: { "X-API-Key": env.aiServiceApiKey, ...(requestId ? { "x-request-id": requestId } : {}) },
    timeout: env.requestTimeoutMs,
  });

  if (res.status === 404) throw new DraftNotFoundError(draftId);
  if (!res.ok) throw new Error(`apps/ai returned ${res.status} fetching draft ${draftId}`);
  return (await res.json()) as DraftDetail;
}
