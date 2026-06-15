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
  hardeningCandidateCount: 3,
  assessedAsTP: 1,
  assessedAsFP: 1,
  assessedAsUncertain: 0,
  reportsGenerated: 1,
  byWorkflow: {
    dodgyDiff: { generated: 6, weakCatches: 1, hardeningCandidates: 2 },
    intentAware: { generated: 4, weakCatches: 1, hardeningCandidates: 1 },
  },
  llmCallCount: 15,
  estimatedTokens: 50_000,
  estimatedCost: 0.25,
  llmUsage: {
    callCount: 15,
    totalInputTokens: 25_000,
    totalOutputTokens: 25_000,
    totalTokens: 50_000,
    totalCostUsd: 0.25,
    costKnown: true,
    byModel: [
      {
        model: "openai/gpt-4.1",
        callCount: 15,
        inputTokens: 25_000,
        outputTokens: 25_000,
        totalTokens: 50_000,
        costUsd: 0.25,
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
  diffRiskScore: 0.7,
};

describe("formatPRComment", () => {
  it("returns empty string for no reports", () => {
    const result = formatPRComment([], defaultStats);
    expect(result).toBe("");
  });

  it("renders a status message when no reports were generated", () => {
    const result = formatPRComment(
      [],
      null,
      "No tests were generated for the current diff.",
    );

    expect(result).toContain("JiTTest: Status");
    expect(result).toContain("No tests were generated for the current diff.");
  });

  it("formats a single report correctly", () => {
    const reports: BehaviorReport[] = [
      {
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
      },
    ];

    const result = formatPRComment(reports, defaultStats);
    expect(result).toContain("JiTTest");
    expect(result).toContain("Boolean flipped in isActive");
    expect(result).toContain("Is this expected?");
    expect(result).toContain("1 potential regression");
    expect(result).toContain("strong-catch");
    expect(result).toContain("3 hardening candidates retained");
  });

  it("pluralizes for multiple reports", () => {
    const reports: BehaviorReport[] = [
      {
        headline: "Change 1",
        senseCheck: "Expected?",
        details: {
          behaviorChange: {
            summary: "",
            parentBehavior: "",
            childBehavior: "",
            changeType: "other",
          },
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
          behaviorChange: {
            summary: "",
            parentBehavior: "",
            childBehavior: "",
            changeType: "other",
          },
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

  it("escapes report text before interpolation", () => {
    const reports: BehaviorReport[] = [
      {
        headline: "<script>alert(1)</script>",
        senseCheck: "Line 1\n<script>",
        details: {
          behaviorChange: {
            summary: "unsafe",
            parentBehavior: "<b>before</b>",
            childBehavior: "<i>after</i>",
            changeType: "other",
          },
          verdict: "uncertain",
          assessorRationales: ["<unsafe> rationale"],
          testCode: "expect(true).toBe(true);",
          dismissalEstimate: "~5 minutes",
        },
      },
    ];

    const result = formatPRComment(reports, defaultStats);
    expect(result).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result).toContain("> &lt;script&gt;");
    expect(result).toContain("&lt;b&gt;before&lt;/b&gt;");
    expect(result).toContain("&lt;unsafe&gt; rationale");
  });

  it("mentions exhausted budgets and unverified dollar enforcement", () => {
    const stats: RunStats = {
      ...defaultStats,
      llmUsage: {
        ...defaultStats.llmUsage,
        costKnown: false,
        budget: {
          ...defaultStats.llmUsage.budget,
          status: "exhausted",
          exhaustedReason: "tokens",
          skippedCalls: 2,
          dollarBudgetEnforced: false,
        },
      },
    };

    const result = formatPRComment(
      [
        {
          headline: "Change",
          senseCheck: "Expected?",
          details: {
            behaviorChange: {
              summary: "",
              parentBehavior: "",
              childBehavior: "",
              changeType: "other",
            },
            verdict: "uncertain",
            assessorRationales: [],
            testCode: "",
            dismissalEstimate: "~5 minutes",
          },
        },
      ],
      stats,
    );

    expect(result).toContain("LLM budget exhausted (tokens)");
    expect(result).toContain("dollar enforcement is unverified");
  });
});
