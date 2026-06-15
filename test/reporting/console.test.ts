import { describe, expect, it } from "vitest";

import {
  formatAssessmentRecords,
  formatBehaviorReports,
  formatCatchResult,
} from "../../source/reporting/console.js";

describe("formatCatchResult", () => {
  it("renders a diff risk summary", () => {
    const result = formatCatchResult({
      baseRef: "origin/main",
      headRef: "HEAD",
      workflow: "both",
      riskThreshold: 0.4,
      eligibleForGeneration: true,
      fileCount: 2,
      riskScore: 0.72,
      riskReasons: ["Touches authentication or session logic."],
    });

    expect(result).toContain("Risk score: 0.72");
    expect(result).toContain("Eligible for generation: yes");
  });

  it("renders empty reasons when none are present", () => {
    const result = formatCatchResult({
      baseRef: "origin/main",
      headRef: "HEAD",
      workflow: "both",
      riskThreshold: 0.4,
      eligibleForGeneration: false,
      fileCount: 0,
      riskScore: 0,
      riskReasons: [],
    });

    expect(result).toContain("- none");
  });

  it("renders generated report summaries", () => {
    const result = formatCatchResult({
      baseRef: "origin/main",
      headRef: "HEAD",
      workflow: "both",
      riskThreshold: 0.4,
      eligibleForGeneration: true,
      fileCount: 1,
      riskScore: 0.8,
      riskReasons: ["Touches payment or billing flows."],
      totalTestsGenerated: 3,
      weakCatchCount: 1,
      hardeningCandidateCount: 2,
      reportsGenerated: 1,
      duration: "8s",
      estimatedCost: 0.0042,
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
    });

    expect(result).toContain("Tests generated: 3");
    expect(result).toContain("Hardening candidates: 2");
    expect(result).toContain("Reports generated: 1");
    expect(result).toContain("1. Unexpected behavior change detected");
  });

  it("renders LLM budget status", () => {
    const result = formatCatchResult({
      baseRef: "origin/main",
      headRef: "HEAD",
      workflow: "both",
      riskThreshold: 0,
      eligibleForGeneration: true,
      fileCount: 1,
      riskScore: 0.8,
      riskReasons: [],
      llmUsage: {
        callCount: 1,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalTokens: 15,
        totalCostUsd: 0,
        costKnown: false,
        byModel: [],
        budget: {
          status: "exhausted",
          exhaustedReason: "tokens",
          skippedCalls: 3,
          overshootAllowed: true,
          dollarBudgetEnforced: false,
        },
        events: [],
      },
    });

    expect(result).toContain("LLM budget: exhausted (tokens)");
    expect(result).toContain("OpenRouter cost: unverified");
  });
});

describe("formatAssessmentRecords", () => {
  it("renders empty state", () => {
    expect(formatAssessmentRecords([])).toBe("No assessments found.");
  });

  it("renders assessment summaries", () => {
    const result = formatAssessmentRecords([
      {
        weakCatch: {
          test: {
            code: "it('works')",
            targetSymbol: "isAllowed",
            testFilePath: "generated/is-allowed.test.ts",
            behaviorDescription: "Checks auth",
            workflow: "dodgy-diff",
            generatorConfidence: 0.8,
          },
          parentResult: {
            testFile: "generated/is-allowed.test.ts",
            testName: "works",
            status: "passed",
            failureMessage: "",
            duration: 9,
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
        assessment: {
          assessments: [],
          combinedScore: 0.6,
          verdict: "likely-strong",
          shouldReport: true,
          dismissalDifficulty: "trivial",
        },
      },
    ]);

    expect(result).toContain("likely-strong");
    expect(result).toContain("score: 0.60");
  });
});

describe("formatBehaviorReports", () => {
  it("renders empty state", () => {
    expect(formatBehaviorReports([])).toBe(
      "No engineer-facing reports met the threshold.",
    );
  });

  it("renders behavior reports", () => {
    const result = formatBehaviorReports([
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
    ]);

    expect(result).toContain("Verdict: likely-strong");
    expect(result).toContain("Dismissal estimate: ~30 seconds");
  });
});
