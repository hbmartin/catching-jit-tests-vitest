import {
  createOpenRouter,
  type OpenRouterProvider,
  type OpenRouterUsageAccounting,
} from "@openrouter/ai-sdk-provider";
import {
  generateText,
  type LanguageModelUsage,
  Output,
  type ProviderMetadata,
} from "ai";
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
    readonly totalTokens: number;
    readonly costUsd?: number;
    readonly costKnown: boolean;
  };
}

interface LLMProviderOptions {
  readonly openrouter?: Record<string, unknown>;
}

interface LLMBudgetConfig {
  readonly maxCostUsd?: number;
  readonly maxTokens?: number;
}

interface LLMClientConfig {
  readonly apiKey?: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly provider?: "openrouter";
  readonly providerOptions?: LLMProviderOptions;
  readonly budget?: LLMBudgetConfig;
}

type BudgetExhaustedReason = "tokens" | "cost";
type BudgetStatus = "within-budget" | "exhausted";
type LLMAuditEvent =
  | {
      readonly type: "call";
      readonly callNumber: number;
      readonly model: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly costUsd?: number;
      readonly costKnown: boolean;
    }
  | {
      readonly type: "missing-cost";
      readonly callNumber: number;
      readonly model: string;
    }
  | {
      readonly type: "budget-exhausted";
      readonly callNumber: number;
      readonly model: string;
      readonly reason: BudgetExhaustedReason;
      readonly limit: number;
      readonly totalTokens: number;
      readonly totalCostUsd: number;
    }
  | {
      readonly type: "llm-skipped";
      readonly model: string;
      readonly reason: "budget-exhausted";
    };

interface LLMModelUsageSummary {
  readonly model: string;
  readonly callCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly costKnown: boolean;
}

interface LLMUsageSummary {
  readonly callCount: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly costKnown: boolean;
  readonly byModel: readonly LLMModelUsageSummary[];
  readonly budget: {
    readonly maxCostUsd?: number;
    readonly maxTokens?: number;
    readonly status: BudgetStatus;
    readonly exhaustedReason?: BudgetExhaustedReason;
    readonly skippedCalls: number;
    readonly overshootAllowed: boolean;
    readonly dollarBudgetEnforced: boolean;
  };
  readonly events: readonly LLMAuditEvent[];
}

interface TokenUsage {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costKnown: boolean;
}

interface SharedLLMStats {
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  costKnown: boolean;
  skippedCalls: number;
  budgetStatus: BudgetStatus;
  exhaustedReason?: BudgetExhaustedReason;
  byModel: Map<string, TokenUsage>;
  events: LLMAuditEvent[];
  budget: LLMBudgetConfig;
}

type GenerateTextResultValue = Awaited<ReturnType<typeof generateText>> & {
  readonly output: unknown;
};
type GenerateTextOptions = Parameters<typeof generateText>[0];
type GenerateTextFn = (
  options: GenerateTextOptions,
) => Promise<GenerateTextResultValue>;

class LLMBudgetExhaustedError extends Error {
  readonly reason: BudgetExhaustedReason;

  constructor(reason: BudgetExhaustedReason) {
    super(`LLM budget exhausted: ${reason}`);
    this.name = "LLMBudgetExhaustedError";
    this.reason = reason;
  }
}

function isLLMBudgetExhaustedError(
  error: unknown,
): error is LLMBudgetExhaustedError {
  return error instanceof LLMBudgetExhaustedError;
}

function createProvider(config: LLMClientConfig): OpenRouterProvider {
  const provider = config.provider ?? "openrouter";
  if (provider !== "openrouter") {
    throw new Error(`Unsupported LLM provider: ${String(provider)}`);
  }

  if (config.apiKey === undefined || config.apiKey.trim().length === 0) {
    throw new Error(
      "An OpenRouter API key is required. Set OPENROUTER_API_KEY.",
    );
  }

  return createOpenRouter({
    apiKey: config.apiKey,
    compatibility: "strict",
  });
}

function createStats(budget: LLMBudgetConfig = {}): SharedLLMStats {
  return {
    callCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    costKnown: true,
    skippedCalls: 0,
    budgetStatus: "within-budget",
    byModel: new Map(),
    events: [],
    budget,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getOpenRouterUsage(
  providerMetadata: ProviderMetadata | undefined,
): OpenRouterUsageAccounting | undefined {
  if (!isRecord(providerMetadata)) {
    return undefined;
  }

  const { openrouter: openrouterMetadata } = providerMetadata as {
    openrouter?: unknown;
  };
  if (!isRecord(openrouterMetadata)) {
    return undefined;
  }

  const { usage } = openrouterMetadata as { usage?: unknown };
  if (!isRecord(usage)) {
    return undefined;
  }

  const usageRecord = usage as {
    promptTokens?: unknown;
    completionTokens?: unknown;
    totalTokens?: unknown;
    cost?: unknown;
  };
  const promptTokens = readNumber(usageRecord.promptTokens);
  const completionTokens = readNumber(usageRecord.completionTokens);
  const totalTokens = readNumber(usageRecord.totalTokens);
  if (
    promptTokens === undefined ||
    completionTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cost: readNumber(usageRecord.cost),
  };
}

function normalizeUsage(input: {
  readonly usage: LanguageModelUsage;
  readonly providerMetadata: ProviderMetadata | undefined;
}): LLMResponse["usage"] {
  const openrouterUsage = getOpenRouterUsage(input.providerMetadata);
  const inputTokens =
    openrouterUsage?.promptTokens ?? input.usage.inputTokens ?? 0;
  const outputTokens =
    openrouterUsage?.completionTokens ?? input.usage.outputTokens ?? 0;
  const totalTokens =
    openrouterUsage?.totalTokens ??
    input.usage.totalTokens ??
    inputTokens + outputTokens;
  const costUsd = openrouterUsage?.cost;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    costKnown: costUsd !== undefined,
  };
}

function createProviderOptions(
  providerOptions: LLMProviderOptions | undefined,
): GenerateTextOptions["providerOptions"] {
  if (providerOptions?.openrouter === undefined) {
    return undefined;
  }

  return {
    openrouter: providerOptions.openrouter,
  } as GenerateTextOptions["providerOptions"];
}

class LLMClient {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly providerName: LLMClientConfig["provider"];
  private readonly providerOptions: LLMProviderOptions | undefined;
  private readonly provider: OpenRouterProvider;
  private readonly stats: SharedLLMStats;
  private readonly generateText: GenerateTextFn;

  constructor(
    config: LLMClientConfig,
    provider: OpenRouterProvider = createProvider(config),
    stats: SharedLLMStats = createStats(config.budget),
    generateTextFn: GenerateTextFn = generateText as GenerateTextFn,
  ) {
    if (config.model.trim().length === 0) {
      throw new Error(
        "An OpenRouter model is required. Set --llm-model, OPENROUTER_MODEL, or llm.model.",
      );
    }

    this.apiKey = config.apiKey;
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens;
    this.providerName = config.provider;
    this.providerOptions = config.providerOptions;
    this.provider = provider;
    this.stats = stats;
    this.generateText = generateTextFn;
  }

  private recordSkip(): never {
    this.stats.skippedCalls += 1;
    this.stats.events.push({
      type: "llm-skipped",
      model: this.model,
      reason: "budget-exhausted",
    });

    throw new LLMBudgetExhaustedError(this.stats.exhaustedReason ?? "tokens");
  }

  private assertBudgetAvailable(): void {
    if (this.stats.budgetStatus === "exhausted") {
      this.recordSkip();
    }
  }

  private markBudgetExhausted(
    callNumber: number,
    reason: BudgetExhaustedReason,
    limit: number,
  ): void {
    if (this.stats.budgetStatus === "exhausted") {
      return;
    }

    this.stats.budgetStatus = "exhausted";
    this.stats.exhaustedReason = reason;
    this.stats.events.push({
      type: "budget-exhausted",
      callNumber,
      model: this.model,
      reason,
      limit,
      totalTokens: this.stats.totalTokens,
      totalCostUsd: this.stats.totalCostUsd,
    });
    logger.warn(
      `LLM ${reason} budget exhausted after call #${String(callNumber)}; future LLM calls will be skipped`,
    );
  }

  private checkBudgetAfterCall(callNumber: number): void {
    const { maxTokens, maxCostUsd } = this.stats.budget;

    if (maxTokens !== undefined && this.stats.totalTokens > maxTokens) {
      this.markBudgetExhausted(callNumber, "tokens", maxTokens);
      return;
    }

    if (maxCostUsd !== undefined && this.stats.totalCostUsd > maxCostUsd) {
      this.markBudgetExhausted(callNumber, "cost", maxCostUsd);
    }
  }

  private recordUsage(usage: LLMResponse["usage"]): void {
    this.stats.callCount += 1;
    this.stats.totalInputTokens += usage.inputTokens;
    this.stats.totalOutputTokens += usage.outputTokens;
    this.stats.totalTokens += usage.totalTokens;
    this.stats.totalCostUsd += usage.costUsd ?? 0;
    this.stats.costKnown = this.stats.costKnown && usage.costKnown;

    const modelUsage = this.stats.byModel.get(this.model) ?? {
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costKnown: true,
    };
    modelUsage.callCount += 1;
    modelUsage.inputTokens += usage.inputTokens;
    modelUsage.outputTokens += usage.outputTokens;
    modelUsage.totalTokens += usage.totalTokens;
    modelUsage.costUsd += usage.costUsd ?? 0;
    modelUsage.costKnown = modelUsage.costKnown && usage.costKnown;
    this.stats.byModel.set(this.model, modelUsage);

    const callNumber = this.stats.callCount;
    this.stats.events.push({
      type: "call",
      callNumber,
      model: this.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costUsd: usage.costUsd,
      costKnown: usage.costKnown,
    });

    if (!usage.costKnown) {
      this.stats.events.push({
        type: "missing-cost",
        callNumber,
        model: this.model,
      });
    }

    this.checkBudgetAfterCall(callNumber);
  }

  private async runGenerate(
    request: LLMRequest,
    output?: unknown,
  ): Promise<GenerateTextResultValue> {
    this.assertBudgetAvailable();

    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
    const temperature = request.temperature ?? 0;

    logger.debug(
      `LLM call #${String(this.stats.callCount + 1)} to ${this.model} (max ${String(maxTokens)} output tokens)`,
    );

    const result = await this.generateText({
      model: this.provider.chat(this.model, { usage: { include: true } }),
      maxOutputTokens: maxTokens,
      temperature,
      prompt: request.prompt,
      system: request.systemPrompt,
      providerOptions: createProviderOptions(this.providerOptions),
      ...(output === undefined ? {} : { output }),
    } as GenerateTextOptions);

    this.recordUsage(
      normalizeUsage({
        usage: result.totalUsage,
        providerMetadata: result.providerMetadata,
      }),
    );

    return result;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const result = await this.runGenerate(request);

    return {
      content: result.text.trim(),
      usage: normalizeUsage({
        usage: result.totalUsage,
        providerMetadata: result.providerMetadata,
      }),
    };
  }

  async completeJson<T>(request: LLMRequest, schema?: ZodType<T>): Promise<T> {
    const result = await this.runGenerate(
      request,
      schema ? Output.object({ schema: schema as never }) : Output.json(),
    );

    return result.output as T;
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
        providerOptions: this.providerOptions,
        budget: this.stats.budget,
      },
      this.provider,
      this.stats,
      this.generateText,
    );
  }

  isBudgetExhausted(): boolean {
    return this.stats.budgetStatus === "exhausted";
  }

  getStats(): {
    callCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    llmUsage: LLMUsageSummary;
  } {
    const byModel = [...this.stats.byModel.entries()].map(([model, usage]) => ({
      model,
      callCount: usage.callCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costUsd: usage.costUsd,
      costKnown: usage.costKnown,
    }));

    const llmUsage: LLMUsageSummary = {
      callCount: this.stats.callCount,
      totalInputTokens: this.stats.totalInputTokens,
      totalOutputTokens: this.stats.totalOutputTokens,
      totalTokens: this.stats.totalTokens,
      totalCostUsd: this.stats.totalCostUsd,
      costKnown: this.stats.costKnown,
      byModel,
      budget: {
        maxCostUsd: this.stats.budget.maxCostUsd,
        maxTokens: this.stats.budget.maxTokens,
        status: this.stats.budgetStatus,
        exhaustedReason: this.stats.exhaustedReason,
        skippedCalls: this.stats.skippedCalls,
        overshootAllowed: true,
        dollarBudgetEnforced:
          this.stats.budget.maxCostUsd === undefined || this.stats.costKnown,
      },
      events: [...this.stats.events],
    };

    return {
      callCount: this.stats.callCount,
      totalInputTokens: this.stats.totalInputTokens,
      totalOutputTokens: this.stats.totalOutputTokens,
      totalTokens: this.stats.totalTokens,
      estimatedCost: this.stats.totalCostUsd,
      llmUsage,
    };
  }
}

export type {
  LLMAuditEvent,
  LLMBudgetConfig,
  LLMClientConfig,
  LLMProviderOptions,
  LLMRequest,
  LLMResponse,
  LLMUsageSummary,
};
export { isLLMBudgetExhaustedError, LLMBudgetExhaustedError, LLMClient };
