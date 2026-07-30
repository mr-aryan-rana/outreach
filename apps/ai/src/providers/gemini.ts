import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env";
import { AiProvider, GenerateRequest, GenerateResult } from "./types";

export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly client: GoogleGenerativeAI;

  constructor(apiKey: string, model: string = env.geminiModel) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 800,
        temperature: request.temperature ?? 0.7,
      },
    });

    const res = await model.generateContent(request.prompt);
    const text = res.response.text();
    const usage = res.response.usageMetadata;
    return {
      text,
      model: this.model,
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount,
      totalTokens: usage?.totalTokenCount,
    };
  }
}
