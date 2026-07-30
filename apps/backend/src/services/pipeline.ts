import fetch from "node-fetch";
import { env } from "../config/env";
import { REQUEST_ID_HEADER } from "../logger";
import { CacheService, searchCacheKey, validationCacheKey } from "./cache";
import { cacheResultCounter } from "./metrics";
import { createResiliencePolicy } from "./resilience";

export interface ExtractResult {
  email: string | null;
  social_links: string[];
  bio: string;
  source_url: string;
}

export interface ValidateResult {
  is_valid: boolean;
  confidence_score: number;
  reasons: string[];
}

const searchPolicy = createResiliencePolicy("search");
const extractorPolicy = createResiliencePolicy("extractor");
const validatorPolicy = createResiliencePolicy("validator");

async function postJson<T>(url: string, body: unknown, requestId?: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
    },
    body: JSON.stringify(body),
    timeout: env.requestTimeoutMs,
  });
  if (!res.ok) {
    throw new Error(`Pipeline service ${url} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

export function buildPipeline(cache: CacheService) {
  return {
    async search(platform: string, niche: string, requestId?: string): Promise<string[]> {
      const cacheKey = searchCacheKey(platform, niche);
      const cached = await cache.get<string[]>(cacheKey);
      if (cached) {
        cacheResultCounter.labels("search", "hit").inc();
        return cached;
      }
      cacheResultCounter.labels("search", "miss").inc();

      const { urls } = await searchPolicy.execute(() =>
        postJson<{ urls: string[] }>(`${env.searchServiceUrl}/search`, { platform, niche }, requestId)
      );
      await cache.set(cacheKey, urls, env.cacheTtlSeconds);
      return urls;
    },

    async extract(url: string, requestId?: string): Promise<ExtractResult> {
      return extractorPolicy.execute(() =>
        postJson<ExtractResult>(`${env.extractorServiceUrl}/extract`, { url }, requestId)
      );
    },

    async validate(email: string, requestId?: string): Promise<ValidateResult> {
      const cacheKey = validationCacheKey(email);
      const cached = await cache.get<ValidateResult>(cacheKey);
      if (cached) {
        cacheResultCounter.labels("validation", "hit").inc();
        return cached;
      }
      cacheResultCounter.labels("validation", "miss").inc();

      const result = await validatorPolicy.execute(() =>
        postJson<ValidateResult>(`${env.validatorServiceUrl}/validate`, { email }, requestId)
      );
      await cache.set(cacheKey, result, env.validationTtlSeconds);
      return result;
    },
  };
}

export type Pipeline = ReturnType<typeof buildPipeline>;
