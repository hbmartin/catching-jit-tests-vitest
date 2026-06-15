import { describe, expect, it } from "vitest";

import {
  assessmentBundleSchema,
  reportCommandResultSchema,
  runStatsSchema,
  testResultSchema,
  vitestJsonOutputSchema,
  weakCatchBundleSchema,
} from "../source/runtime-schemas.js";

const weakCatchBundle = {
  diff: {
    rawDiff: "diff --git a/source/auth.ts b/source/auth.ts",
    pr: {
      title: "Refactor access checks",
      body: "Cleanup only",
    },
  },
  weakCatches: [
    {
      test: {
        code: "it('works', () => expect(result).toBe(true));",
        targetSymbol: "isAllowed",
        testFilePath: "generated/is-allowed.test.ts",
        behaviorDescription: "Checks an auth gate",
        workflow: "dodgy-diff",
        generatorConfidence: 0.8,
      },
      parentResult: {
        testFile: "generated/is-allowed.test.ts",
        testName: "works",
        status: "passed",
        failureMessage: "",
        duration: 10,
        failureAnalysis: null,
      },
      childResult: {
        testFile: "generated/is-allowed.test.ts",
        testName: "works",
        status: "failed",
        failureMessage: "Expected true but received false",
        duration: 12,
        failureAnalysis: null,
      },
      behaviorChange: {
        summary: "Boolean result flipped from true to false",
        parentBehavior: "true",
        childBehavior: "false",
        changeType: "boolean-flipped",
      },
    },
  ],
};

describe("runtime schemas", () => {
  it("parses weak catch bundles", () => {
    expect(weakCatchBundleSchema.parse(weakCatchBundle)).toEqual(
      weakCatchBundle,
    );
  });

  it("parses assessment bundles", () => {
    const assessmentBundle = {
      diff: weakCatchBundle.diff,
      assessments: [
        {
          weakCatch: weakCatchBundle.weakCatches[0],
          assessment: {
            assessments: [
              {
                score: 0.6,
                rationale: "A boolean condition changed across revisions.",
                detectedPatterns: [],
                assessor: "rubfake",
              },
            ],
            combinedScore: 0.6,
            verdict: "likely-strong",
            shouldReport: true,
            dismissalDifficulty: "trivial",
          },
        },
      ],
    };

    expect(assessmentBundleSchema.parse(assessmentBundle)).toEqual(
      assessmentBundle,
    );
  });

  it("parses report command results", () => {
    const result = {
      format: "json",
      reports: [
        {
          headline: "Unexpected behavior change detected: auth flipped",
          senseCheck: "This expression used to evaluate to true.",
          details: {
            behaviorChange: {
              summary: "auth flipped",
              parentBehavior: "true",
              childBehavior: "false",
              changeType: "boolean-flipped",
            },
            verdict: "likely-strong",
            assessorRationales: ["Boolean changed"],
            testCode: "it('works')",
            dismissalEstimate: "~30 seconds",
          },
        },
      ],
    };

    expect(reportCommandResultSchema.parse(result)).toEqual(result);
  });

  it("accepts skipped test statuses", () => {
    expect(
      testResultSchema.parse({
        testFile: "test/example.test.ts",
        testName: "skips cleanly",
        status: "skipped",
        failureMessage: "",
        duration: 0,
        failureAnalysis: null,
      }),
    ).toMatchObject({ status: "skipped" });
  });

  it("accepts non-binary Vitest reporter statuses", () => {
    expect(
      vitestJsonOutputSchema.parse({
        testResults: [
          {
            name: "test/example.test.ts",
            status: "pending",
            assertionResults: [
              {
                ancestorTitles: ["suite"],
                title: "todo item",
                status: "todo",
                failureMessages: [],
                duration: 0,
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      testResults: [
        {
          status: "pending",
          assertionResults: [{ status: "todo" }],
        },
      ],
    });
  });

  it("parses run stats with detailed LLM usage", () => {
    const stats = {
      duration: "5s",
      diffExtractionMs: 10,
      testGenerationMs: 20,
      executionMs: 30,
      assessmentMs: 40,
      filesAnalyzed: 1,
      functionsAnalyzed: 1,
      totalTestsGenerated: 1,
      testsPassedOnParent: 1,
      testsFailedOnChild: 1,
      weakCatchCount: 1,
      hardeningCandidateCount: 0,
      assessedAsTP: 1,
      assessedAsFP: 0,
      assessedAsUncertain: 0,
      reportsGenerated: 1,
      byWorkflow: {
        dodgyDiff: {
          generated: 1,
          weakCatches: 1,
          hardeningCandidates: 0,
        },
        intentAware: {
          generated: 0,
          weakCatches: 0,
          hardeningCandidates: 0,
        },
      },
      llmCallCount: 1,
      estimatedTokens: 15,
      estimatedCost: 0.001,
      llmUsage: {
        callCount: 1,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalTokens: 15,
        totalCostUsd: 0.001,
        costKnown: true,
        byModel: [
          {
            model: "openai/gpt-4.1",
            callCount: 1,
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            costUsd: 0.001,
            costKnown: true,
          },
        ],
        budget: {
          maxTokens: 10,
          status: "exhausted",
          exhaustedReason: "tokens",
          skippedCalls: 1,
          overshootAllowed: true,
          dollarBudgetEnforced: true,
        },
        events: [
          {
            type: "call",
            callNumber: 1,
            model: "openai/gpt-4.1",
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            costUsd: 0.001,
            costKnown: true,
          },
          {
            type: "budget-exhausted",
            callNumber: 1,
            model: "openai/gpt-4.1",
            reason: "tokens",
            limit: 10,
            totalTokens: 15,
            totalCostUsd: 0.001,
          },
          {
            type: "llm-skipped",
            model: "openai/gpt-4.1",
            reason: "budget-exhausted",
          },
        ],
      },
      diffRiskScore: 0.7,
    };

    expect(runStatsSchema.parse(stats)).toEqual(stats);
  });
});
