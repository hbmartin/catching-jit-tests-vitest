import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("@anthropic-ai/sdk");
});

describe("LLMClient", () => {
  it("uses the Anthropic provider and records usage", async () => {
    const createMessageMock = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: "hello" },
        { type: "tool_use", name: "ignored" },
        { type: "text", text: "world" },
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 8,
      },
    });
    const AnthropicMock = vi.fn(function AnthropicConstructor() {
      return {
        messages: {
          create: createMessageMock,
        },
      };
    });

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: AnthropicMock,
    }));

    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const client = new LLMClient({
      apiKey: "test-key",
      model: "claude-sonnet-4-20250514",
      maxTokens: 99,
    });

    const response = await client.complete({
      prompt: "Say hello",
      systemPrompt: "Be terse",
      maxTokens: 20,
      temperature: 0.4,
    });

    expect(AnthropicMock).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(createMessageMock).toHaveBeenCalledWith({
      model: "claude-sonnet-4-20250514",
      max_tokens: 20,
      temperature: 0.4,
      system: "Be terse",
      messages: [{ role: "user", content: "Say hello" }],
    });
    expect(response).toEqual({
      content: "hello\nworld",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
      },
    });
    expect(client.getStats()).toMatchObject({
      callCount: 1,
      totalInputTokens: 12,
      totalOutputTokens: 8,
    });
  });

  it("parses fenced JSON responses with an optional schema", async () => {
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const provider = {
      complete: vi.fn().mockResolvedValue({
        content: '```json\n{"ok":true,"count":2}\n```',
        usage: {
          inputTokens: 3,
          outputTokens: 4,
        },
      }),
    };
    const client = new LLMClient(
      {
        apiKey: "",
        model: "claude-sonnet-4-20250514",
        maxTokens: 50,
      },
      provider,
    );

    const parsed = await client.completeJson(
      { prompt: "json please" },
      z.object({ ok: z.boolean(), count: z.number() }),
    );

    expect(parsed).toEqual({ ok: true, count: 2 });
  });

  it("shares provider and token stats across model variants", async () => {
    const { LLMClient } = await import("../../source/utils/llm-client.js");
    const provider = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: "known",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
          },
        })
        .mockResolvedValueOnce({
          content: "fallback",
          usage: {
            inputTokens: 2_000_000,
            outputTokens: 3_000_000,
          },
        }),
    };
    const client = new LLMClient(
      {
        apiKey: "",
        model: "claude-sonnet-4-20250514",
        maxTokens: 100,
      },
      provider,
    );

    expect(client.withModel("claude-sonnet-4-20250514")).toBe(client);

    const fallbackModel = client.withModel("unknown-model");
    await client.complete({ prompt: "first" });
    await fallbackModel.complete({
      prompt: "second",
      maxTokens: 7,
      temperature: 0.1,
    });

    expect(provider.complete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: "unknown-model",
        maxTokens: 7,
        temperature: 0.1,
      }),
    );
    expect(fallbackModel.getStats()).toEqual({
      callCount: 2,
      totalInputTokens: 3_000_000,
      totalOutputTokens: 4_000_000,
      estimatedCost: 69,
    });
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
});
