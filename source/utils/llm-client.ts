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
  readonly provider?: "anthropic";
}

interface LLMProviderRequest extends LLMRequest {
  readonly model: string;
  readonly maxTokens: number;
  readonly temperature: number;
}

interface LLMProvider {
  readonly complete: (request: LLMProviderRequest) => Promise<LLMResponse>;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface SharedLLMStats {
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: Map<string, TokenUsage>;
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

class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: LLMProviderRequest): Promise<LLMResponse> {
    const message = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
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

    return {
      content,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  }
}

function createProvider(config: LLMClientConfig): LLMProvider {
  switch (config.provider ?? "anthropic") {
    case "anthropic": {
      return new AnthropicProvider(config.apiKey);
    }
    default: {
      throw new Error(`Unsupported LLM provider: ${String(config.provider)}`);
    }
  }
}

function createStats(): SharedLLMStats {
  return {
    callCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byModel: new Map(),
  };
}

class LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly providerName: LLMClientConfig["provider"];
  private readonly provider: LLMProvider;
  private readonly stats: SharedLLMStats;

  constructor(
    config: LLMClientConfig,
    provider: LLMProvider = createProvider(config),
    stats: SharedLLMStats = createStats(),
  ) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens;
    this.providerName = config.provider;
    this.provider = provider;
    this.stats = stats;
  }

  private recordUsage(usage: LLMResponse["usage"]): void {
    this.stats.totalInputTokens += usage.inputTokens;
    this.stats.totalOutputTokens += usage.outputTokens;
    this.stats.callCount += 1;

    const modelUsage = this.stats.byModel.get(this.model) ?? {
      inputTokens: 0,
      outputTokens: 0,
    };
    modelUsage.inputTokens += usage.inputTokens;
    modelUsage.outputTokens += usage.outputTokens;
    this.stats.byModel.set(this.model, modelUsage);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
    const temperature = request.temperature ?? 0;

    logger.debug(
      `LLM call #${String(this.stats.callCount + 1)} to ${this.model} (max ${String(maxTokens)} tokens)`,
    );

    const response = await this.provider.complete({
      model: this.model,
      maxTokens,
      temperature,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
    });

    this.recordUsage(response.usage);

    return response;
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

    return new LLMClient(
      {
        apiKey: this.apiKey,
        model,
        maxTokens: this.defaultMaxTokens,
        provider: this.providerName,
      },
      this.provider,
      this.stats,
    );
  }

  getStats(): {
    callCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    estimatedCost: number;
  } {
    let estimatedCost = 0;
    for (const [model, usage] of this.stats.byModel) {
      const pricing = getModelPricing(model);
      estimatedCost += (usage.inputTokens / 1_000_000) * pricing.input;
      estimatedCost += (usage.outputTokens / 1_000_000) * pricing.output;
    }

    return {
      callCount: this.stats.callCount,
      totalInputTokens: this.stats.totalInputTokens,
      totalOutputTokens: this.stats.totalOutputTokens,
      estimatedCost,
    };
  }
}

export type { LLMClientConfig, LLMRequest, LLMResponse };
export { LLMClient };
