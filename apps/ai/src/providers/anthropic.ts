import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { AiProvider, GenerateRequest, GenerateResult } from "./types";

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, model: string = env.anthropicModel) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 800,
      temperature: request.temperature ?? 0.7,
      messages: [{ role: "user", content: request.prompt }],
    });

    const text = res.content.filter((block) => block.type === "text").map((block: any) => block.text).join("");
    return {
      text,
      model: this.model,
      promptTokens: res.usage.input_tokens,
      completionTokens: res.usage.output_tokens,
      totalTokens: res.usage.input_tokens + res.usage.output_tokens,
    };
  }
}
