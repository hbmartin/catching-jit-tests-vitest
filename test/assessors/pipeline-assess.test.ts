import { afterEach, describe, expect, it, vi } from "vitest";

import type { Assessment } from "../../source/assessors/types.js";
import {
  assessorsConfigSchema,
  type JiTTestConfig,
} from "../../source/config.js";
import type { DiffContext } from "../../source/diff/types.js";
import type { WeakCatch } from "../../source/harvest/types.js";
import type { LLMClient } from "../../source/utils/llm-client.js";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const makeAssessment = (
  score: number,
  rationale: string,
  detectedPatterns: Assessment["detectedPatterns"] = [],
): Assessment => ({
  score,
  rationale,
  detectedPatterns,
  assessor: "rubfake",
});

const makeWeakCatch = (
  changeType: WeakCatch["behaviorChange"]["changeType"] = "boolean-flipped",
  inferredIntent: string | null = "  Keep auth strict  ",
): WeakCatch => ({
  test: {
    code: "expect(isAllowed()).toBe(true);",
    targetSymbol: "isAllowed",
    testFilePath: "test/auth.jittest.test.ts",
    behaviorDescription: "auth changed",
    workflow: "intent-aware",
    generatorConfidence: 0.8,
    inferredIntent,
  },
  parentResult: {
    testFile: "test/auth.jittest.test.ts",
    testName: "auth changed",
    status: "passed",
    failureMessage: "",
    duration: 1,
    failureAnalysis: null,
  },
  childResult: {
    testFile: "test/auth.jittest.test.ts",
    testName: "auth changed",
    status: "failed",
    failureMessage: "Expected true but received false",
    duration: 1,
    failureAnalysis: {
      assertionType: "toBe",
      expected: "true",
      actual: "false",
      stackTrace: "at auth.test.ts:1:1",
      isRuntimeError: false,
      errorClass: null,
    },
  },
  behaviorChange: {
    summary: "Boolean result flipped",
    parentBehavior: "true",
    childBehavior: "false",
    changeType,
  },
});

const diff: DiffContext = {
  rawDiff: "+return false;",
  pr: {
    title: "Fix auth",
    body: "Preserve access behavior",
    branch: "feature",
    baseSha: "base",
    headSha: "head",
  },
  files: [],
  riskScore: 0.7,
  changedSymbols: [],
};

const config = {
  rubfakeEnabled: true,
  llmJudgeEnabled: true,
  judgeModels: ["judge-a"],
  reportThreshold: 0,
  assessors: assessorsConfigSchema.parse({}),
} as JiTTestConfig;

const llm = {
  isBudgetExhausted: vi.fn().mockReturnValue(false),
} as unknown as LLMClient;

const mockAssessors = (
  rubfake: Assessment | null,
  llmAssessment: Assessment,
) => {
  const evaluateRubFakeMock = vi.fn().mockReturnValue(rubfake);
  const ensembleJudgeMock = vi.fn().mockResolvedValue(llmAssessment);

  vi.doMock("../../source/assessors/rubfake.js", () => ({
    evaluateRubFake: evaluateRubFakeMock,
  }));
  vi.doMock("../../source/assessors/llm-judge.js", () => ({
    ensembleJudge: ensembleJudgeMock,
  }));

  return { evaluateRubFakeMock, ensembleJudgeMock };
};

describe("assessWeakCatch", () => {
  it("uses high-confidence false-positive rubfake results as an override", async () => {
    const mocks = mockAssessors(
      makeAssessment(-0.9, "generated test shape", [
        {
          name: "mock artifact",
          direction: "false-positive",
          confidence: "high",
          evidence: "test only checks mocks",
        },
      ]),
      makeAssessment(1, "LLM thinks this is real"),
    );
    const { assessWeakCatch } = await import(
      "../../source/assessors/pipeline.js"
    );

    const result = await assessWeakCatch(
      makeWeakCatch(),
      diff,
      "child log",
      llm,
      config,
    );

    expect(result.combinedScore).toBe(-0.9);
    expect(result.verdict).toBe("false-positive");
    expect(result.shouldReport).toBe(false);
    expect(mocks.ensembleJudgeMock.mock.calls[0]?.[0]).toMatchObject({
      inferredIntent: "Keep auth strict",
      executionLog: "child log",
    });
  });

  it("weights rubfake and LLM results when no override applies", async () => {
    mockAssessors(
      makeAssessment(0.4, "rubfake signal"),
      makeAssessment(1, "LLM signal"),
    );
    const { assessWeakCatch } = await import(
      "../../source/assessors/pipeline.js"
    );

    const result = await assessWeakCatch(
      makeWeakCatch("null-introduced", null),
      diff,
      "child log",
      llm,
      config,
    );

    expect(result.combinedScore).toBeCloseTo(0.76);
    expect(result.verdict).toBe("strong-catch");
    expect(result.dismissalDifficulty).toBe("easy");
    expect(result.shouldReport).toBe(true);
  });

  it("handles disabled assessors with difficulty-adjusted thresholds", async () => {
    mockAssessors(makeAssessment(1, "unused"), makeAssessment(1, "unused"));
    const { assessWeakCatch } = await import(
      "../../source/assessors/pipeline.js"
    );

    const result = await assessWeakCatch(
      makeWeakCatch("output-shape-changed", null),
      diff,
      "child log",
      llm,
      {
        ...config,
        rubfakeEnabled: false,
        llmJudgeEnabled: false,
        reportThreshold: 0.1,
      } as JiTTestConfig,
    );

    expect(result.assessments).toEqual([]);
    expect(result.combinedScore).toBe(0);
    expect(result.dismissalDifficulty).toBe("hard");
    expect(result.shouldReport).toBe(false);
  });
});
