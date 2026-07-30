import { env, ProviderName } from "../config/env";
import { logger } from "../logger";
import {
  aiFallbackUsedTotal,
  aiGenerationDuration,
  aiProviderFailuresTotal,
} from "../services/metrics";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { MockProvider } from "./mock";
import { OpenAiProvider } from "./openai";
import { getResiliencePolicy } from "./resilience";
import { AiProvider, GenerateRequest, GenerateResult } from "./types";

const instances = new Map<ProviderName, AiProvider>();

/**
 * Lazily constructs and caches one provider instance per name. Throws only
 * when that specific provider is actually requested without its key
 * configured -- not at service boot (config/env.ts deliberately doesn't
 * require every provider's key, so this service still starts and serves
 * health checks / prompt management even with just one provider configured).
 */
export function getProvider(name: ProviderName): AiProvider {
  const cached = instances.get(name);
  if (cached) return cached;

  let provider: AiProvider;
  switch (name) {
    case "openai":
      if (!env.openaiApiKey) throw new Error("OPENAI_API_KEY is not configured");
      provider = new OpenAiProvider(env.openaiApiKey);
      break;
    case "anthropic":
      if (!env.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
      provider = new AnthropicProvider(env.anthropicApiKey);
      break;
    case "gemini":
      if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");
      provider = new GeminiProvider(env.geminiApiKey);
      break;
    case "mock":
      provider = new MockProvider();
      break;
  }
  instances.set(name, provider);
  return provider;
}

export interface GenerationOutcome {
  result: GenerateResult;
  provider: ProviderName;
  usedFallback: boolean;
  latencyMs: number;
}

async function callProvider(provider: AiProvider, stage: string, request: GenerateRequest): Promise<GenerateResult> {
  const policy = getResiliencePolicy(provider.name);
  const start = process.hrtime.bigint();
  try {
    const result = await policy.execute(() => provider.generate(request));
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    aiGenerationDuration.labels(provider.name, stage, "success").observe(latencyMs / 1000);
    return result;
  } catch (err) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    aiGenerationDuration.labels(provider.name, stage, "failure").observe(latencyMs / 1000);
    aiProviderFailuresTotal.labels(provider.name, (err as Error).name || "error").inc();
    throw err;
  }
}

/**
 * Requirement #7 ("Fallback provider"): tries AI_PRIMARY_PROVIDER first; if
 * that call fails for any reason (timeout, circuit open, API error), tries
 * AI_FALLBACK_PROVIDER once before giving up. Never locks the pipeline to a
 * single provider being available.
 */
export async function generateWithFallback(stage: string, request: GenerateRequest): Promise<GenerationOutcome> {
  const overallStart = process.hrtime.bigint();

  try {
    // getProvider() belongs inside the try, not before it: it throws
    // synchronously when the primary's API key isn't configured, and that
    // failure must trigger fallback exactly like a runtime call failure --
    // found live during Sprint 3 verification, where a misconfigured
    // primary provider skipped fallback entirely and 500'd instead.
    const primary = getProvider(env.primaryProvider);
    const result = await callProvider(primary, stage, request);
    return {
      result,
      provider: primary.name,
      usedFallback: false,
      latencyMs: Number(process.hrtime.bigint() - overallStart) / 1e6,
    };
  } catch (primaryErr) {
    if (env.fallbackProvider === env.primaryProvider) {
      throw primaryErr;
    }
    logger.warn({
      event: "ai_provider_fallback",
      stage,
      primary: env.primaryProvider,
      fallback: env.fallbackProvider,
      error: (primaryErr as Error).message,
    });
    try {
      const fallback = getProvider(env.fallbackProvider);
      const result = await callProvider(fallback, stage, request);
      aiFallbackUsedTotal.labels(env.primaryProvider, env.fallbackProvider, stage).inc();
      return {
        result,
        provider: fallback.name,
        usedFallback: true,
        latencyMs: Number(process.hrtime.bigint() - overallStart) / 1e6,
      };
    } catch (fallbackErr) {
      throw new Error(
        `both primary (${env.primaryProvider}: ${(primaryErr as Error).message}) and fallback ` +
          `(${env.fallbackProvider}: ${(fallbackErr as Error).message}) providers failed for stage ${stage}`
      );
    }
  }
}
