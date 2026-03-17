import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

import { logger } from "./logger.js";

interface LLMRequest {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

interface LLMResponse {
  readonly content: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

interface LLMClientConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
}

const modelPricing: Readonly<
  Record<string, { input: number; output: number }>
> = {
  "claude-sonnet-4-20250514": {
    input: 3,
    output: 15,
  },
};

function getModelPricing(model: string): { input: number; output: number } {
  return (
    modelPricing[model] ??
    modelPricing["claude-sonnet-4-20250514"] ?? {
      input: 3,
      output: 15,
    }
  );
}

class LLMClient {
  private readonly client: Anthropic;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private callCount = 0;

  constructor(config: LLMClientConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
    const temperature = request.temperature ?? 0;

    logger.debug(
      `LLM call #${String(this.callCount + 1)} to ${this.model} (max ${String(maxTokens)} tokens)`,
    );

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      system: request.systemPrompt ?? "",
      messages: [{ role: "user", content: request.prompt }],
    });

    const content = message.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => {
        return block.type === "text";
      })
      .map((block) => block.text)
      .join("\n")
      .trim();

    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };

    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    this.callCount += 1;

    return { content, usage };
  }

  async completeJson<T>(request: LLMRequest, schema?: ZodType<T>): Promise<T> {
    const response = await this.complete(request);
    const cleaned = response.content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned) as unknown;

    if (schema) {
      return schema.parse(parsed);
    }

    return parsed as T;
  }

  withModel(model: string): LLMClient {
    if (model === this.model) {
      return this;
    }

    return new LLMClient({
      apiKey: this.apiKey,
      model,
      maxTokens: this.defaultMaxTokens,
    });
  }

  getStats(): {
    callCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    estimatedCost: number;
  } {
    const pricing = getModelPricing(this.model);
    const inputCost = (this.totalInputTokens / 1_000_000) * pricing.input;
    const outputCost = (this.totalOutputTokens / 1_000_000) * pricing.output;
    return {
      callCount: this.callCount,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      estimatedCost: inputCost + outputCost,
    };
  }
}

export type { LLMClientConfig, LLMRequest, LLMResponse };
export { LLMClient };
