import { describe, expect, it, vi } from "vitest";

import { ensembleJudge } from "../../source/assessors/llm-judge.js";
import type { JudgeOutput } from "../../source/assessors/types.js";
import type { JiTTestConfig } from "../../source/config.js";
import type { LLMClient } from "../../source/utils/llm-client.js";

type JudgeResponse = JudgeOutput | Error;

function makeLLMClient(responses: Record<string, JudgeResponse>): LLMClient {
  const createClient = (model: string): LLMClient => {
    const response = responses[model];
    const completeJson =
      response instanceof Error
        ? vi.fn().mockRejectedValue(response)
        : vi.fn().mockResolvedValue(response);

    return {
      completeJson,
      withModel: (nextModel: string) => createClient(nextModel),
      isBudgetExhausted: vi.fn().mockReturnValue(false),
    } as unknown as LLMClient;
  };

  return createClient("root");
}

const input = {
  testCode: "expect(run()).toBe(true);",
  failureMessage: "Expected: true\nReceived: false",
  executionLog: "Error: mismatch",
  stackTrace: "    at test.ts:1:1",
  diff: "+return false;",
  inferredIntent: "Refactor without changing behavior",
  behaviorChange: {
    summary: "Boolean flipped",
    parentBehavior: "true",
    childBehavior: "false",
    changeType: "boolean-flipped" as const,
  },
};

const config = {
  judgeModels: ["model-a", "model-b", "model-c"],
  llm: {
    model: "model-a",
  },
} as JiTTestConfig;

describe("ensembleJudge", () => {
  it("maps high medium and low likelihoods to paper-aligned scores", async () => {
    const llm = makeLLMClient({
      "model-a": {
        unexpectedLikelihood: "high",
        explanation: "Looks like an unexpected regression.",
      },
      "model-b": {
        unexpectedLikelihood: "medium",
        explanation: "Mixed signals.",
      },
      "model-c": {
        unexpectedLikelihood: "low",
        explanation: "Looks intended.",
      },
    });

    const result = await ensembleJudge(input, llm, config);

    expect(result.score).toBe(0);
    expect(result.rationale).toContain("HIGH unexpected likelihood");
    expect(result.rationale).toContain("MEDIUM unexpected likelihood");
    expect(result.rationale).toContain("LOW unexpected likelihood");
  });

  it("uses the numeric median for even-sized ensembles", async () => {
    const llm = makeLLMClient({
      "model-a": {
        unexpectedLikelihood: "high",
        explanation: "Looks buggy.",
      },
      "model-b": {
        unexpectedLikelihood: "low",
        explanation: "Looks intended.",
      },
    });

    const result = await ensembleJudge(input, llm, {
      ...config,
      judgeModels: ["model-a", "model-b"],
    } as JiTTestConfig);

    expect(result.score).toBe(0);
  });

  it("treats failed model judgments as neutral", async () => {
    const llm = makeLLMClient({
      "model-a": new Error("provider unavailable"),
      "model-b": {
        unexpectedLikelihood: "high",
        explanation: "Looks buggy.",
      },
      "model-c": {
        unexpectedLikelihood: "low",
        explanation: "Looks intended.",
      },
    });

    const result = await ensembleJudge(input, llm, config);

    expect(result.score).toBe(0);
    expect(result.rationale).toContain("MEDIUM unexpected likelihood");
    expect(result.rationale).toContain("treating this judge as neutral");
  });
});
