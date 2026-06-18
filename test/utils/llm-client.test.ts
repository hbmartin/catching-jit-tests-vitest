import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("@openrouter/ai-sdk-provider");
  vi.doUnmock("@ai-sdk/openai-compatible");
  vi.doUnmock("ai");
});

const makeProvider = () => {
  const languageModel = { provider: "openrouter", modelId: "test-model" };
  return {
    languageModel,
    provider: {
      chat: vi.fn().mockReturnValue(languageModel),
    },
  };
};

const makeAiResult = (input: {
  text?: string;
  output?: unknown;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  providerMetadata?: unknown;
}) => {
  const providerMetadata =
    input.providerMetadata === undefined
      ? {
          openrouter: {
            usage: {
              promptTokens: input.inputTokens,
              completionTokens: input.outputTokens,
              totalTokens: input.inputTokens + input.outputTokens,
              ...(input.costUsd === undefined ? {} : { cost: input.costUsd }),
            },
          },
        }
      : input.providerMetadata;

  return {
    text: input.text ?? "",
    output: input.output,
    totalUsage: {
      inputTokens: input.inputTokens,
      inputTokenDetails: {
        noCacheTokens: input.inputTokens,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokens: input.outputTokens,
      outputTokenDetails: {
        textTokens: input.outputTokens,
        reasoningTokens: undefined,
      },
      totalTokens: input.inputTokens + input.outputTokens,
    },
    providerMetadata,
  };
};

describe("LLMClient", () => {
  it("uses the OpenRouter provider through AI SDK and records usage", async () => {
    const { provider, languageModel } = makeProvider();
    const createOpenRouterMock = vi.fn().mockReturnValue(provider);
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: " hello world ",
        inputTokens: 12,
        outputTokens: 8,
        costUsd: 0.004,
      }),
    );

    vi.doMock("@openrouter/ai-sdk-provider", () => ({
      createOpenRouter: createOpenRouterMock,
    }));
    vi.doMock("ai", async (importOriginal) => ({
      ...(await importOriginal<typeof import("ai")>()),
      generateText: generateTextMock,
    }));

    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient({
      apiKey: "test-key",
      model: "openai/gpt-4.1",
      maxTokens: 99,
      providerOptions: {
        openrouter: {
          models: ["anthropic/claude-sonnet-4"],
          user: "test-user",
        },
      },
    });

    const response = await client.complete({
      prompt: "Say hello",
      systemPrompt: "Be terse",
      maxTokens: 20,
      temperature: 0.4,
    });

    expect(createOpenRouterMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      compatibility: "strict",
    });
    expect(provider.chat).toHaveBeenCalledWith("openai/gpt-4.1", {
      usage: { include: true },
    });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: languageModel,
        maxOutputTokens: 20,
        temperature: 0.4,
        prompt: "Say hello",
        system: "Be terse",
        providerOptions: {
          openrouter: {
            models: ["anthropic/claude-sonnet-4"],
            user: "test-user",
          },
        },
      }),
    );
    expect(response).toEqual({
      content: "hello world",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        costUsd: 0.004,
        costKnown: true,
      },
    });
    expect(client.getStats()).toMatchObject({
      callCount: 1,
      totalInputTokens: 12,
      totalOutputTokens: 8,
      totalTokens: 20,
      estimatedCost: 0.004,
      llmUsage: {
        costKnown: true,
        totalCostUsd: 0.004,
      },
    });
  });

  it("returns AI SDK structured output for schema-bound JSON", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        output: { ok: true, count: 2 },
        inputTokens: 3,
        outputTokens: 4,
        costUsd: 0.001,
      }),
    );
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 50,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    const parsed = await client.completeJson(
      { prompt: "json please" },
      z.object({ ok: z.boolean(), count: z.number() }),
    );

    expect(parsed).toEqual({ ok: true, count: 2 });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.any(Object),
      }),
    );
  });

  it("returns AI SDK JSON output when no schema is supplied", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        output: { values: [1, 2] },
        inputTokens: 1,
        outputTokens: 2,
        costUsd: 0.001,
      }),
    );
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 50,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    await expect(
      client.completeJson({ prompt: "json please" }),
    ).resolves.toEqual({
      values: [1, 2],
    });
  });

  it("shares provider and usage stats across model variants", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeAiResult({
          text: "known",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.01,
        }),
      )
      .mockResolvedValueOnce(
        makeAiResult({
          text: "fallback",
          inputTokens: 200,
          outputTokens: 300,
          costUsd: 0.02,
        }),
      );
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    expect(client.withModel("openai/gpt-4.1")).toBe(client);

    const fallbackModel = client.withModel("anthropic/claude-sonnet-4");
    await client.complete({ prompt: "first" });
    await fallbackModel.complete({
      prompt: "second",
      maxTokens: 7,
      temperature: 0.1,
    });

    expect(provider.chat).toHaveBeenNthCalledWith(
      2,
      "anthropic/claude-sonnet-4",
      { usage: { include: true } },
    );
    expect(fallbackModel.getStats()).toMatchObject({
      callCount: 2,
      totalInputTokens: 300,
      totalOutputTokens: 350,
      totalTokens: 650,
      estimatedCost: 0.03,
      llmUsage: {
        byModel: [
          expect.objectContaining({
            model: "openai/gpt-4.1",
            callCount: 1,
            costUsd: 0.01,
          }),
          expect.objectContaining({
            model: "anthropic/claude-sonnet-4",
            callCount: 1,
            costUsd: 0.02,
          }),
        ],
      },
    });
  });

  it("marks token budget exhaustion and skips future LLM calls", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "over budget",
        inputTokens: 7,
        outputTokens: 6,
        costUsd: 0.001,
      }),
    );
    const { LLMClient, LLMBudgetExhaustedError } = await import(
      "../../source/utils/llm-client.js"
    );
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
        budget: { maxTokens: 10 },
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    await client.complete({ prompt: "first" });
    await expect(client.complete({ prompt: "second" })).rejects.toBeInstanceOf(
      LLMBudgetExhaustedError,
    );

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(client.getStats().llmUsage).toMatchObject({
      budget: {
        status: "exhausted",
        exhaustedReason: "tokens",
        skippedCalls: 1,
      },
      events: expect.arrayContaining([
        expect.objectContaining({ type: "budget-exhausted", reason: "tokens" }),
        expect.objectContaining({ type: "llm-skipped" }),
      ]),
    });
  });

  it("marks dollar enforcement unverified when cost metadata is missing", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "missing cost",
        inputTokens: 7,
        outputTokens: 6,
      }),
    );
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
        budget: { maxCostUsd: 0.0001 },
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    await client.complete({ prompt: "first" });

    expect(client.isBudgetExhausted()).toBe(false);
    expect(client.getStats().llmUsage).toMatchObject({
      totalCostUsd: 0,
      costKnown: false,
      budget: {
        status: "within-budget",
        dollarBudgetEnforced: false,
      },
      events: expect.arrayContaining([
        expect.objectContaining({ type: "missing-cost" }),
      ]),
    });
  });

  it("stays silent about dollar enforcement when no cost budget is set", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "missing cost",
        inputTokens: 7,
        outputTokens: 6,
      }),
    );
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    await client.complete({ prompt: "first" });

    expect(client.getStats().llmUsage.costKnown).toBe(false);
    expect(client.getStats().llmUsage.budget.dollarBudgetEnforced).toBe(true);
  });

  it("requires an API key on the real provider path", async () => {
    const createOpenRouterMock = vi.fn();
    vi.doMock("@openrouter/ai-sdk-provider", () => ({
      createOpenRouter: createOpenRouterMock,
    }));

    const { LLMClient } = await import("../../source/utils/llm-client.js");

    expect(
      () =>
        new LLMClient({
          apiKey: "   ",
          model: "openai/gpt-4.1",
          maxTokens: 1,
        }),
    ).toThrow("An OpenRouter API key is required");
    expect(createOpenRouterMock).not.toHaveBeenCalled();
  });

  it("uses AI SDK token usage when OpenRouter metadata is absent", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "fallback usage",
        inputTokens: 11,
        outputTokens: 13,
        providerMetadata: null,
      }),
    );
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    await client.complete({ prompt: "first" });

    expect(client.getStats()).toMatchObject({
      totalInputTokens: 11,
      totalOutputTokens: 13,
      totalTokens: 24,
      estimatedCost: 0,
      llmUsage: {
        costKnown: false,
      },
    });
  });

  it("marks cost budget exhaustion and reports budget status", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "over budget",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.05,
      }),
    );
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
        budget: { maxCostUsd: 0.01 },
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    await client.complete({ prompt: "first" });

    expect(client.isBudgetExhausted()).toBe(true);
    expect(client.getStats().llmUsage).toMatchObject({
      budget: {
        status: "exhausted",
        exhaustedReason: "cost",
      },
      events: expect.arrayContaining([
        expect.objectContaining({ type: "budget-exhausted", reason: "cost" }),
      ]),
    });
  });

  it("rejects missing model ids before making LLM calls", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn();
    const { LLMClient } = await import("../../source/utils/llm-client.js");

    expect(
      () =>
        new LLMClient(
          {
            apiKey: "",
            model: " ",
            maxTokens: 1,
          },
          provider as never,
          undefined,
          generateTextMock as never,
        ),
    ).toThrow("An OpenRouter model is required");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("identifies budget exhaustion errors", async () => {
    const { LLMBudgetExhaustedError, isLLMBudgetExhaustedError } = await import(
      "../../source/utils/llm-client.js"
    );

    expect(
      isLLMBudgetExhaustedError(new LLMBudgetExhaustedError("tokens")),
    ).toBe(true);
    expect(isLLMBudgetExhaustedError(new Error("other"))).toBe(false);
  });

  it("rejects unsupported provider names", async () => {
    const { LLMClient } = await import("../../source/utils/llm-client.js");

    expect(
      () =>
        new LLMClient({
          apiKey: "",
          model: "model",
          maxTokens: 1,
          provider: "openai" as never,
        }),
    ).toThrow("Unsupported LLM provider: openai");
  });

  it("uses an injected languageModel without requiring an API key", async () => {
    const languageModel = { provider: "custom", modelId: "byo" };
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "injected",
        inputTokens: 1,
        outputTokens: 1,
        providerMetadata: null,
      }),
    );
    const { LLMClient } = await import("../../source/utils/llm-client.js");

    // No apiKey, no provider machinery — library users bring their own model.
    const client = new LLMClient(
      {
        model: "label/model",
        maxTokens: 10,
        languageModel: languageModel as never,
      },
      undefined,
      undefined,
      generateTextMock as never,
    );

    const response = await client.complete({ prompt: "hello" });

    expect(response.content).toBe("injected");
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: languageModel }),
    );
  });

  it("resolves and swaps models through an injected modelFactory", async () => {
    const modelA = { id: "a" };
    const modelB = { id: "b" };
    const modelFactory = vi.fn((id: string) =>
      id === "m-a" ? modelA : modelB,
    );
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "ok",
        inputTokens: 1,
        outputTokens: 1,
        providerMetadata: null,
      }),
    );
    const { LLMClient } = await import("../../source/utils/llm-client.js");

    const client = new LLMClient(
      {
        model: "m-a",
        maxTokens: 10,
        modelFactory: modelFactory as never,
      },
      undefined,
      undefined,
      generateTextMock as never,
    );

    await client.complete({ prompt: "first" });
    const swapped = client.withModel("m-b");
    await swapped.complete({ prompt: "second" });

    expect(modelFactory).toHaveBeenCalledWith("m-a");
    expect(modelFactory).toHaveBeenCalledWith("m-b");
    expect(generateTextMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: modelB }),
    );
  });

  it("builds an openai-compatible provider and resolves models through it", async () => {
    const languageModel = { provider: "oai-compat", modelId: "z" };
    const providerFn = vi.fn().mockReturnValue(languageModel);
    const createOpenAICompatibleMock = vi.fn().mockReturnValue(providerFn);
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "compat",
        inputTokens: 2,
        outputTokens: 2,
        providerMetadata: null,
      }),
    );

    vi.doMock("@ai-sdk/openai-compatible", () => ({
      createOpenAICompatible: createOpenAICompatibleMock,
    }));
    vi.doMock("ai", async (importOriginal) => ({
      ...(await importOriginal<typeof import("ai")>()),
      generateText: generateTextMock,
    }));

    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient({
      apiKey: "compat-key",
      model: "meta-llama/Llama-3-70b",
      maxTokens: 10,
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
    });

    await client.complete({ prompt: "hello" });

    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: "jittest",
      baseURL: "https://api.example.com/v1",
      apiKey: "compat-key",
    });
    expect(providerFn).toHaveBeenCalledWith("meta-llama/Llama-3-70b");
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: languageModel }),
    );
  });

  it("requires a base URL for the openai-compatible provider", async () => {
    const { LLMClient } = await import("../../source/utils/llm-client.js");

    expect(
      () =>
        new LLMClient({
          apiKey: "k",
          model: "model",
          maxTokens: 1,
          provider: "openai-compatible",
        }),
    ).toThrow(/base URL is required/);
  });

  it("serves repeated requests from cache as zero-cost hits", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "cached body",
        inputTokens: 9,
        outputTokens: 6,
        costUsd: 0.003,
      }),
    );

    const store = new Map<string, unknown>();
    const cache = {
      get: vi.fn(async (key: string) => store.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
    };

    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
        cache: cache as never,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    const first = await client.complete({ prompt: "same prompt" });
    const second = await client.complete({ prompt: "same prompt" });

    // The model is only invoked once; the second call is a cache hit.
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(first.content).toBe("cached body");
    expect(second.content).toBe("cached body");

    const stats = client.getStats();
    // The hit does not increment the (real) call count or token/cost totals.
    expect(stats.callCount).toBe(1);
    expect(stats.totalTokens).toBe(15);
    expect(stats.estimatedCost).toBeCloseTo(0.003);
    expect(stats.llmUsage.cacheHits).toBe(1);
    expect(stats.llmUsage.events).toContainEqual(
      expect.objectContaining({ type: "cache-hit" }),
    );
  });

  it("separates cached responses by provider options end-to-end", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "provider-specific body",
        inputTokens: 9,
        outputTokens: 6,
        costUsd: 0.003,
      }),
    );

    const store = new Map<string, unknown>();
    const cache = {
      get: vi.fn(async (key: string) => store.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
    };

    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const lowReasoningClient = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
        providerOptions: {
          openrouter: {
            reasoning: { effort: "low" },
          },
        },
        cache: cache as never,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );
    const highReasoningClient = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
        providerOptions: {
          openrouter: {
            reasoning: { effort: "high" },
          },
        },
        cache: cache as never,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    await lowReasoningClient.complete({ prompt: "same prompt" });
    await highReasoningClient.complete({ prompt: "same prompt" });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(cache.set).toHaveBeenCalledTimes(2);

    const cacheKeys = cache.set.mock.calls.map(([key]) => key);
    expect(new Set(cacheKeys).size).toBe(2);
  });

  it("uses the same cache key for absent and empty provider options", async () => {
    const { provider } = makeProvider();
    const generateTextMock = vi.fn().mockResolvedValue(
      makeAiResult({
        text: "shared body",
        inputTokens: 9,
        outputTokens: 6,
        costUsd: 0.003,
      }),
    );

    const store = new Map<string, unknown>();
    const cache = {
      get: vi.fn(async (key: string) => store.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
    };

    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const absentOptionsClient = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
        cache: cache as never,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );
    const emptyOptionsClient = new LLMClient(
      {
        apiKey: "",
        model: "openai/gpt-4.1",
        maxTokens: 100,
        providerOptions: {},
        cache: cache as never,
      },
      provider as never,
      undefined,
      generateTextMock as never,
    );

    await absentOptionsClient.complete({ prompt: "same prompt" });
    await emptyOptionsClient.complete({ prompt: "same prompt" });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.get.mock.calls[0]?.[0]).toBe(cache.get.mock.calls[1]?.[0]);
  });
});
