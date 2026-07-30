import { ProviderName } from "../config/env";

export interface GenerateRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * One implementation per provider (OpenAI, Anthropic, Gemini, Mock). Kept
 * deliberately minimal -- a single `generate` method -- so adding a fourth
 * provider later never requires touching pipeline/orchestration code, only
 * adding one new file here and registering it in registry.ts. This is what
 * "never lock the project to one provider" means structurally: nothing
 * upstream of this interface knows which provider it's talking to.
 */
export interface AiProvider {
  readonly name: ProviderName;
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/**
 * Approximate USD per 1K tokens. Update as pricing changes -- these are not
 * fetched live from any provider. Used only for the estimatedCostUsd field
 * tracked per generation (requirement #6); never used to enforce a hard
 * spend limit (no such limit exists in this slice).
 */
export const TOKEN_PRICING_USD_PER_1K: Record<string, { prompt: number; completion: number }> = {
  "gpt-4o-mini": { prompt: 0.00015, completion: 0.0006 },
  "gpt-4o": { prompt: 0.0025, completion: 0.01 },
  "claude-3-5-sonnet-20241022": { prompt: 0.003, completion: 0.015 },
  "claude-3-5-haiku-20241022": { prompt: 0.0008, completion: 0.004 },
  "gemini-1.5-flash": { prompt: 0.000075, completion: 0.0003 },
  "gemini-1.5-pro": { prompt: 0.00125, completion: 0.005 },
  mock: { prompt: 0, completion: 0 },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined
): number | undefined {
  const pricing = TOKEN_PRICING_USD_PER_1K[model];
  if (!pricing || promptTokens === undefined || completionTokens === undefined) return undefined;
  return (promptTokens / 1000) * pricing.prompt + (completionTokens / 1000) * pricing.completion;
}
