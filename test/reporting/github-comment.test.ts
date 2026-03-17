import { describe, expect, it } from "vitest";

import { formatPRComment } from "../../source/reporting/github-comment.js";
import type { BehaviorReport, RunStats } from "../../source/reporting/types.js";

const defaultStats: RunStats = {
  duration: "5s",
  diffExtractionMs: 100,
  testGenerationMs: 200,
  executionMs: 300,
  assessmentMs: 100,
  filesAnalyzed: 3,
  functionsAnalyzed: 5,
  totalTestsGenerated: 10,
  testsPassedOnParent: 8,
  testsFailedOnChild: 4,
  weakCatchCount: 2,
  assessedAsTP: 1,
  assessedAsFP: 1,
  assessedAsUncertain: 0,
  reportsGenerated: 1,
  byWorkflow: {
    dodgyDiff: { generated: 6, weakCatches: 1 },
    intentAware: { generated: 4, weakCatches: 1 },
  },
  llmCallCount: 15,
  estimatedTokens: 50000,
  estimatedCost: 0.25,
  diffRiskScore: 0.7,
};

describe("formatPRComment", () => {
  it("returns empty string for no reports", () => {
    const result = formatPRComment([], defaultStats);
    expect(result).toBe("");
  });

  it("formats a single report correctly", () => {
    const reports: BehaviorReport[] = [{
      headline: "Boolean flipped in isActive",
      senseCheck: "Is this expected?",
      details: {
        behaviorChange: {
          summary: "Boolean flipped",
          parentBehavior: "true",
          childBehavior: "false",
          changeType: "boolean-flipped",
        },
        verdict: "strong-catch",
        assessorRationales: ["Good catch"],
        testCode: "expect(isActive()).toBe(true);",
        dismissalEstimate: "~30 seconds",
      },
    }];

    const result = formatPRComment(reports, defaultStats);
    expect(result).toContain("JiTTest");
    expect(result).toContain("Boolean flipped in isActive");
    expect(result).toContain("Is this expected?");
    expect(result).toContain("1 potential regression");
    expect(result).toContain("strong-catch");
  });

  it("pluralizes for multiple reports", () => {
    const reports: BehaviorReport[] = [
      {
        headline: "Change 1",
        senseCheck: "Expected?",
        details: {
          behaviorChange: { summary: "", parentBehavior: "", childBehavior: "", changeType: "other" },
          verdict: "strong-catch",
          assessorRationales: [],
          testCode: "",
          dismissalEstimate: "~30 seconds",
        },
      },
      {
        headline: "Change 2",
        senseCheck: "Expected?",
        details: {
          behaviorChange: { summary: "", parentBehavior: "", childBehavior: "", changeType: "other" },
          verdict: "likely-strong",
          assessorRationales: [],
          testCode: "",
          dismissalEstimate: "~1-2 minutes",
        },
      },
    ];

    const result = formatPRComment(reports, defaultStats);
    expect(result).toContain("2 potential regressions");
  });
});
