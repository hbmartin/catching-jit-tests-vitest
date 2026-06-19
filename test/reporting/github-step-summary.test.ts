import { describe, expect, it } from "vitest";

import { formatGithubStepSummary } from "../../source/reporting/github-step-summary.js";
import type { BehaviorReport, RunStats } from "../../source/reporting/types.js";

const report: BehaviorReport = {
  headline: "Boolean result flipped | with pipe",
  senseCheck: "This changed\nacross revisions.",
  details: {
    behaviorChange: {
      summary: "Boolean result flipped",
      parentBehavior: "true",
      childBehavior: "false",
      changeType: "boolean-flipped",
    },
    verdict: "strong-catch",
    assessorRationales: ["High confidence"],
    testCode: "it('detects behavior', () => {});",
    dismissalEstimate: "~30 seconds",
  },
};

const stats: RunStats = {
  duration: "5s",
  diffExtractionMs: 1,
  testGenerationMs: 2,
  executionMs: 3,
  assessmentMs: 4,
  filesAnalyzed: 1,
  functionsAnalyzed: 1,
  totalTestsGenerated: 2,
  testsPassedOnParent: 2,
  testsFailedOnChild: 1,
  weakCatchCount: 1,
  hardeningCandidateCount: 1,
  assessedAsTP: 1,
  assessedAsFP: 0,
  assessedAsUncertain: 0,
  reportsGenerated: 1,
  byWorkflow: {
    dodgyDiff: { generated: 1, weakCatches: 1, hardeningCandidates: 0 },
    intentAware: { generated: 1, weakCatches: 0, hardeningCandidates: 1 },
  },
  llmCallCount: 1,
  estimatedTokens: 10,
  estimatedCost: 0.001,
  llmUsage: {
    callCount: 1,
    cacheHits: 0,
    totalInputTokens: 5,
    totalOutputTokens: 5,
    totalTokens: 10,
    totalCostUsd: 0.001,
    costKnown: true,
    byModel: [
      {
        model: "model",
        callCount: 1,
        inputTokens: 5,
        outputTokens: 5,
        totalTokens: 10,
        costUsd: 0.001,
        costKnown: true,
      },
    ],
    budget: {
      status: "within-budget",
      skippedCalls: 0,
      overshootAllowed: true,
      dollarBudgetEnforced: true,
    },
    events: [],
  },
  diffRiskScore: 0.5,
};

describe("formatGithubStepSummary", () => {
  it("formats reports as a markdown table", () => {
    const result = formatGithubStepSummary([report], stats);

    expect(result).toContain("## JiTTest");
    expect(result).toContain("| # | Verdict | Summary | Sense check |");
    expect(result).toContain("Boolean result flipped \\| with pipe");
    expect(result).toContain("This changed<br>across revisions.");
  });

  it("includes a status when there are no reports", () => {
    const result = formatGithubStepSummary([], null, "Skipped.");

    expect(result).toContain("Skipped.");
  });
});
