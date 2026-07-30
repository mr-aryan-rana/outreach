import OpenAI from "openai";
import { env } from "../config/env";
import { AiProvider, GenerateRequest, GenerateResult } from "./types";

export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(apiKey: string, model: string = env.openaiModel) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: request.prompt }],
      max_tokens: request.maxTokens ?? 800,
      temperature: request.temperature ?? 0.7,
    });

    const text = res.choices[0]?.message?.content ?? "";
    return {
      text,
      model: this.model,
      promptTokens: res.usage?.prompt_tokens,
      completionTokens: res.usage?.completion_tokens,
      totalTokens: res.usage?.total_tokens,
    };
  }
}
