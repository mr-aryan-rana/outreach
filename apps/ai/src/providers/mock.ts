import { createHash } from "crypto";
import { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Deterministic, zero-cost, zero-network provider used for tests and for
 * local/CI verification where no real provider API key is configured. Never
 * calls any external API. Output is a function of the prompt only (a short
 * hash-derived "response"), so tests can assert on it without depending on
 * a real model's non-deterministic output.
 */
export class MockProvider implements AiProvider {
  readonly name = "mock" as const;
  readonly model = "mock";

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const hash = createHash("sha256").update(request.prompt).digest("hex").slice(0, 8);
    const promptTokens = Math.ceil(request.prompt.length / 4);
    const text = `[mock-${hash}] ${request.prompt.slice(0, 60).replace(/\s+/g, " ")}...`;
    const completionTokens = Math.ceil(text.length / 4);
    return {
      text,
      model: this.model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }
}
