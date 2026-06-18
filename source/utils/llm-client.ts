import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  createOpenRouter,
  type OpenRouterProvider,
  type OpenRouterUsageAccounting,
} from "@openrouter/ai-sdk-provider";
import {
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  Output,
  type ProviderMetadata,
} from "ai";
import { type ZodType, z } from "zod";

import type { CachedLLMResult, LLMCache } from "./llm-cache.js";
import { computeCacheKey } from "./llm-cache.js";
import { logger } from "./logger.js";

type LLMProvider = "openrouter" | "openai-compatible";

// Resolves a model id to an AI SDK LanguageModel. Code/library users can inject
// their own factory (or a fully-resolved model) to use any AI SDK provider; the
// CLI builds one from provider config.
type ModelFactory = (modelId: string) => LanguageModel;

// Describes the output mode of a request so cache keys never collide across
// plain-text, freeform-JSON, and schema-bound-JSON variants of one prompt.
interface CacheDescriptor {
  readonly kind: "text" | "json" | "object";
  readonly schemaFingerprint?: string;
}

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
  readonly provider?: LLMProvider;
  readonly baseUrl?: string;
  readonly providerOptions?: LLMProviderOptions;
  readonly budget?: LLMBudgetConfig;
  /**
   * A fully-resolved AI SDK model. When supplied, the built-in provider
   * machinery (and the API-key requirement) is bypassed entirely — this is the
   * seam for library users who want to bring their own AI SDK provider.
   */
  readonly languageModel?: LanguageModel;
  /**
   * A factory that resolves a model id to an AI SDK model. Preferred over
   * `languageModel` when the caller needs `withModel` to swap models (e.g. a
   * judge ensemble across several model ids).
   */
  readonly modelFactory?: ModelFactory;
  /**
   * Optional response cache. When supplied, identical requests are served from
   * the cache and recorded as zero-cost cache hits.
   */
  readonly cache?: LLMCache;
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
    }
  | {
      readonly type: "cache-hit";
      readonly model: string;
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
  readonly cacheHits: number;
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
  cacheHits: number;
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

type ResolvedProvider =
  | OpenRouterProvider
  | ReturnType<typeof createOpenAICompatible>;

function createProvider(config: LLMClientConfig): ResolvedProvider {
  const provider = config.provider ?? "openrouter";

  if (provider === "openrouter") {
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

  if (provider === "openai-compatible") {
    if (config.baseUrl === undefined || config.baseUrl.trim().length === 0) {
      throw new Error(
        "A base URL is required for the openai-compatible provider. Set --llm-base-url or LLM_BASE_URL.",
      );
    }

    const apiKey =
      config.apiKey !== undefined && config.apiKey.trim().length > 0
        ? config.apiKey
        : undefined;

    return createOpenAICompatible({
      name: "jittest",
      baseURL: config.baseUrl,
      ...(apiKey === undefined ? {} : { apiKey }),
    });
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}

// Turns the configured/injected provider into a uniform model resolver.
// Library-supplied models and factories take precedence over the built-in
// provider machinery.
function deriveModelFactory(
  config: LLMClientConfig,
  provider: ResolvedProvider | undefined,
): ModelFactory {
  if (config.languageModel !== undefined) {
    const injected = config.languageModel;
    return () => injected;
  }

  if (config.modelFactory !== undefined) {
    return config.modelFactory;
  }

  if (provider === undefined) {
    throw new Error(
      "No LLM provider, languageModel, or modelFactory supplied.",
    );
  }

  const providerName = config.provider ?? "openrouter";
  if (providerName === "openrouter") {
    const openrouter = provider as OpenRouterProvider;
    return (modelId) => openrouter.chat(modelId, { usage: { include: true } });
  }

  const openaiCompatible = provider as ReturnType<
    typeof createOpenAICompatible
  >;
  return (modelId) => openaiCompatible(modelId);
}

function createStats(budget: LLMBudgetConfig = {}): SharedLLMStats {
  return {
    callCount: 0,
    cacheHits: 0,
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
    return;
  }

  const { openrouter: openrouterMetadata } = providerMetadata as {
    openrouter?: unknown;
  };
  if (!isRecord(openrouterMetadata)) {
    return;
  }

  const { usage } = openrouterMetadata as { usage?: unknown };
  if (!isRecord(usage)) {
    return;
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
    return;
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

// Rebuild a generateText-shaped result from a cache entry. The usage is encoded
// as OpenRouter provider metadata so `normalizeUsage` recovers the exact cached
// token/cost numbers regardless of which provider originally produced them.
function reconstructCachedResult(
  cached: CachedLLMResult,
): GenerateTextResultValue {
  const { usage } = cached;
  return {
    text: cached.text,
    output: cached.output,
    totalUsage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
    providerMetadata: {
      openrouter: {
        usage: {
          promptTokens: usage.inputTokens,
          completionTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          ...(usage.costUsd === undefined ? {} : { cost: usage.costUsd }),
        },
      },
    },
  } as unknown as GenerateTextResultValue;
}

function schemaFingerprint(schema: ZodType<unknown>): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema));
  } catch {
    // Unreachable in practice: the AI SDK's Output.object() also calls
    // z.toJSONSchema and throws on an unserializable schema before generation,
    // so such a schema never reaches the cache. Kept as a defensive marker.
    return "unserializable-schema";
  }
}

function createProviderOptions(
  providerOptions: LLMProviderOptions | undefined,
): GenerateTextOptions["providerOptions"] {
  if (providerOptions?.openrouter === undefined) {
    return;
  }

  return {
    openrouter: providerOptions.openrouter,
  } as GenerateTextOptions["providerOptions"];
}

function serializeProviderOptions(
  providerOptions: LLMProviderOptions | undefined,
): string | undefined {
  if (
    providerOptions?.openrouter === undefined ||
    Object.keys(providerOptions.openrouter).length === 0
  ) {
    return;
  }

  return JSON.stringify(providerOptions);
}

class LLMClient {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly providerName: LLMClientConfig["provider"];
  private readonly baseUrl: string | undefined;
  private readonly providerOptions: LLMProviderOptions | undefined;
  private readonly provider: ResolvedProvider | undefined;
  private readonly languageModel: LanguageModel | undefined;
  private readonly injectedModelFactory: ModelFactory | undefined;
  private readonly modelFactory: ModelFactory;
  private readonly cache: LLMCache | undefined;
  private readonly stats: SharedLLMStats;
  private readonly generateText: GenerateTextFn;

  constructor(
    config: LLMClientConfig,
    provider?: ResolvedProvider,
    stats: SharedLLMStats = createStats(config.budget),
    generateTextFn: GenerateTextFn = generateText as GenerateTextFn,
  ) {
    if (config.model.trim().length === 0) {
      throw new Error(
        "An OpenRouter model is required. Set --llm-model, OPENROUTER_MODEL, or llm.model.",
      );
    }

    const hasInjection =
      config.languageModel !== undefined || config.modelFactory !== undefined;
    const resolvedProvider =
      provider ?? (hasInjection ? undefined : createProvider(config));

    this.apiKey = config.apiKey;
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens;
    this.providerName = config.provider;
    this.baseUrl = config.baseUrl;
    this.providerOptions = config.providerOptions;
    this.languageModel = config.languageModel;
    this.injectedModelFactory = config.modelFactory;
    this.provider = resolvedProvider;
    this.modelFactory = deriveModelFactory(config, resolvedProvider);
    this.cache = config.cache;
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

  private recordCacheHit(): void {
    this.stats.cacheHits += 1;
    this.stats.events.push({ type: "cache-hit", model: this.model });
  }

  private cacheKeyFor(
    request: LLMRequest,
    maxTokens: number,
    temperature: number,
    descriptor: CacheDescriptor,
  ): string {
    return computeCacheKey({
      model: this.model,
      prompt: request.prompt,
      system: request.systemPrompt,
      maxTokens,
      temperature,
      outputKind: descriptor.kind,
      schemaFingerprint: descriptor.schemaFingerprint,
      providerOptions: serializeProviderOptions(this.providerOptions),
    });
  }

  private async runGenerate(
    request: LLMRequest,
    descriptor: CacheDescriptor,
    output?: unknown,
  ): Promise<GenerateTextResultValue> {
    this.assertBudgetAvailable();

    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
    const temperature = request.temperature ?? 0;

    const cacheKey = this.cache
      ? this.cacheKeyFor(request, maxTokens, temperature, descriptor)
      : undefined;

    if (this.cache && cacheKey !== undefined) {
      const cached = await this.cache.get(cacheKey);
      if (cached !== undefined) {
        logger.debug(`LLM cache hit for ${this.model}`);
        this.recordCacheHit();
        return reconstructCachedResult(cached);
      }
    }

    logger.debug(
      `LLM call #${String(this.stats.callCount + 1)} to ${this.model} (max ${String(maxTokens)} output tokens)`,
    );

    const result = await this.generateText({
      model: this.modelFactory(this.model),
      maxOutputTokens: maxTokens,
      temperature,
      prompt: request.prompt,
      system: request.systemPrompt,
      providerOptions: createProviderOptions(this.providerOptions),
      ...(output === undefined ? {} : { output }),
    } as GenerateTextOptions);

    const usage = normalizeUsage({
      usage: result.totalUsage,
      providerMetadata: result.providerMetadata,
    });
    this.recordUsage(usage);

    if (this.cache && cacheKey !== undefined) {
      await this.cache.set(cacheKey, {
        text: result.text,
        output: result.output,
        usage,
      });
    }

    return result;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const result = await this.runGenerate(request, { kind: "text" });

    return {
      content: result.text.trim(),
      usage: normalizeUsage({
        usage: result.totalUsage,
        providerMetadata: result.providerMetadata,
      }),
    };
  }

  async completeJson<T>(request: LLMRequest, schema?: ZodType<T>): Promise<T> {
    const descriptor: CacheDescriptor = schema
      ? { kind: "object", schemaFingerprint: schemaFingerprint(schema) }
      : { kind: "json" };
    const result = await this.runGenerate(
      request,
      descriptor,
      schema ? Output.object({ schema: schema as never }) : Output.json(),
    );

    return result.output as T;
  }

  withModel(model: string): LLMClient {
    if (model === this.model) {
      return this;
    }

    if (this.languageModel !== undefined) {
      logger.warn(
        `An injected languageModel cannot be swapped; "${model}" will reuse the injected model. Pass modelFactory instead to vary models.`,
      );
    }

    return new LLMClient(
      {
        apiKey: this.apiKey,
        model,
        maxTokens: this.defaultMaxTokens,
        provider: this.providerName,
        baseUrl: this.baseUrl,
        providerOptions: this.providerOptions,
        budget: this.stats.budget,
        ...(this.languageModel === undefined
          ? {}
          : { languageModel: this.languageModel }),
        ...(this.injectedModelFactory === undefined
          ? {}
          : { modelFactory: this.injectedModelFactory }),
        ...(this.cache === undefined ? {} : { cache: this.cache }),
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
      cacheHits: this.stats.cacheHits,
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

export type { CachedLLMResult, LLMCache } from "./llm-cache.js";
export type {
  LLMAuditEvent,
  LLMBudgetConfig,
  LLMClientConfig,
  LLMProvider,
  LLMProviderOptions,
  LLMRequest,
  LLMResponse,
  LLMUsageSummary,
  ModelFactory,
};
export { isLLMBudgetExhaustedError, LLMBudgetExhaustedError, LLMClient };
