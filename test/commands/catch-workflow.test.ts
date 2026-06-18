import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatchCommandOptions } from "../../source/config.js";
import type { DiffContext } from "../../source/diff/types.js";
import type {
  DualExecutionResult,
  TestResult,
} from "../../source/execution/types.js";
import type { GeneratedTest } from "../../source/generation/types.js";
import type { BehaviorReport } from "../../source/reporting/types.js";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const makeOptions = (
  overrides: Partial<CatchCommandOptions> = {},
): CatchCommandOptions => ({
  base: "origin/main",
  head: "HEAD",
  workflow: "both",
  riskThreshold: 0,
  testsPerFunction: 1,
  maxTotalTests: 10,
  batchSize: 2,
  parallelWorktrees: true,
  timeout: 1000,
  output: "console",
  reportThreshold: 0,
  feedbackPath: ".jittest/records.jsonl",
  contextFiles: [],
  include: ["source/**/*.ts"],
  exclude: ["**/*.test.ts"],
  cwd: "/repo",
  prTitle: "Fix auth",
  prBody: "Preserve authorization behavior",
  llmModel: "openai/gpt-4.1",
  ...overrides,
});

const makeDiff = (riskScore = 0.8): DiffContext => ({
  rawDiff: "+return false;",
  additionalContext: "Important domain context",
  pr: {
    title: "Fix auth",
    body: "Preserve authorization behavior",
    branch: "HEAD",
    baseSha: "origin/main",
    headSha: "HEAD",
  },
  files: [
    {
      path: "source/auth.ts",
      hunks: [],
      existingTestFile: null,
      changedExports: ["isAllowed"],
      changedFunctions: [
        {
          name: "isAllowed",
          filePath: "source/auth.ts",
          parentSource: "export const isAllowed = () => true;",
          childSource: "export const isAllowed = () => false;",
          parentFileSource: "export const isAllowed = () => true;",
          childFileSource: "export const isAllowed = () => false;",
          hunks: [],
          signature: "const isAllowed",
          requiredImports: [],
          hasCoverage: false,
        },
      ],
      touchesAuth: true,
      touchesPayments: false,
      touchesDataModel: false,
      touchesAccessControl: true,
    },
  ],
  riskScore,
  riskReasons: ["Touches authentication or session logic."],
  changedSymbols: [
    {
      name: "isAllowed",
      kind: "variable",
      filePath: "source/auth.ts",
      exportType: "named",
    },
  ],
});

const makeGeneratedTest = (
  workflow: GeneratedTest["workflow"],
  testFilePath: string,
): GeneratedTest => ({
  code: "it('detects behavior', () => {});",
  targetSymbol: "isAllowed",
  testFilePath,
  behaviorDescription: `${workflow} behavior`,
  workflow,
  generatorConfidence: 0.8,
  ...(workflow === "intent-aware"
    ? {
        inferredIntent: "Preserve auth",
        mutantValidation: {
          targetFilePath: "source/auth.ts",
          mutantCode: "export const isAllowed = () => false;",
        },
      }
    : {}),
});

const makeResult = (
  test: GeneratedTest,
  status: TestResult["status"],
): TestResult => ({
  testFile: test.testFilePath,
  testName: test.behaviorDescription,
  status,
  failureMessage: status === "failed" ? "Expected true but received false" : "",
  duration: 3,
  failureAnalysis:
    status === "failed"
      ? {
          assertionType: "toBe",
          expected: "true",
          actual: "false",
          stackTrace: "at auth.test.ts:1:1",
          isRuntimeError: false,
          errorClass: null,
        }
      : null,
});

const makeDualResult = (
  test: GeneratedTest,
  childStatus: TestResult["status"],
): DualExecutionResult => ({
  test,
  parentOutcome: makeResult(test, "passed"),
  childOutcome: makeResult(test, childStatus),
  parentExecutionLog: "parent log",
  childExecutionLog: childStatus === "failed" ? "child log" : "child passed",
});

const report: BehaviorReport = {
  headline: "Potential unexpected behavior change: Boolean result flipped",
  senseCheck: "This expression used to evaluate to true.",
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

const defaultLlmUsage = {
  callCount: 2,
  totalInputTokens: 10,
  totalOutputTokens: 5,
  totalTokens: 15,
  totalCostUsd: 0.001,
  costKnown: true,
  byModel: [
    {
      model: "openai/gpt-4.1",
      callCount: 2,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd: 0.001,
      costKnown: true,
    },
  ],
  budget: {
    status: "within-budget" as const,
    skippedCalls: 0,
    overshootAllowed: true,
    dollarBudgetEnforced: true,
  },
  events: [],
};

const mockCatchDependencies = (riskScore = 0.8) => {
  const diffWithoutRisk = makeDiff(0);
  const diffWithRisk = makeDiff(riskScore);
  const cleanupMock = vi.fn().mockResolvedValue(undefined);
  const getStatsMock = vi.fn().mockReturnValue({
    callCount: 2,
    totalInputTokens: 10,
    totalOutputTokens: 5,
    totalTokens: 15,
    estimatedCost: 0.001,
    llmUsage: defaultLlmUsage,
  });
  const isBudgetExhaustedMock = vi.fn().mockReturnValue(false);

  const mocks = {
    extractDiffContextMock: vi.fn().mockResolvedValue(diffWithoutRisk),
    applyRiskAnalysisMock: vi.fn().mockResolvedValue(diffWithRisk),
    loadIntentContextMock: vi.fn().mockResolvedValue("loaded context"),
    dodgyDiffWorkflowMock: vi.fn().mockResolvedValue([]),
    intentAwareWorkflowMock: vi.fn().mockResolvedValue([]),
    setupWorktreesMock: vi.fn().mockResolvedValue({
      parentDir: "/tmp/parent",
      childDir: "/tmp/child",
      cleanup: cleanupMock,
    }),
    cleanupMock,
    installWorktreeDependenciesMock: vi.fn().mockResolvedValue(undefined),
    validateIntentAwareTestsMock: vi
      .fn()
      .mockImplementation(async (tests) => tests),
    flakeGuardTestsMock: vi
      .fn()
      .mockImplementation(async (tests: GeneratedTest[]) => ({
        stableTests: tests,
        droppedCount: 0,
      })),
    dualExecutionMock: vi.fn().mockResolvedValue([]),
    assessWeakCatchMock: vi.fn().mockResolvedValue({
      assessments: [],
      combinedScore: 0.7,
      verdict: "strong-catch",
      shouldReport: true,
      dismissalDifficulty: "trivial",
    }),
    appendAssessmentFeedbackRecordMock: vi.fn().mockResolvedValue(undefined),
    buildAssessmentFeedbackRecordMock: vi
      .fn()
      .mockReturnValue({ id: "record" }),
    generateBehaviorReportMock: vi.fn().mockReturnValue(report),
    LLMClientMock: vi.fn(function LLMClientMock() {
      return {
        getStats: getStatsMock,
        isBudgetExhausted: isBudgetExhaustedMock,
      };
    }),
    getStatsMock,
    isBudgetExhaustedMock,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };

  vi.doMock("../../source/utils/logger.js", () => ({
    logger: mocks.logger,
  }));
  vi.doMock("../../source/diff/extractor.js", () => ({
    extractDiffContext: mocks.extractDiffContextMock,
  }));
  vi.doMock("../../source/diff/risk-scorer.js", () => ({
    applyRiskAnalysis: mocks.applyRiskAnalysisMock,
  }));
  vi.doMock("../../source/generation/intent-context.js", () => ({
    loadIntentContext: mocks.loadIntentContextMock,
  }));
  vi.doMock("../../source/generation/dodgy-diff.js", () => ({
    dodgyDiffWorkflow: mocks.dodgyDiffWorkflowMock,
  }));
  vi.doMock("../../source/generation/intent-aware.js", () => ({
    intentAwareWorkflow: mocks.intentAwareWorkflowMock,
  }));
  vi.doMock("../../source/execution/git-worktree.js", () => ({
    installWorktreeDependencies: mocks.installWorktreeDependenciesMock,
    setupWorktrees: mocks.setupWorktreesMock,
  }));
  vi.doMock("../../source/execution/runner.js", () => ({
    dualExecution: mocks.dualExecutionMock,
    flakeGuardTests: mocks.flakeGuardTestsMock,
    validateIntentAwareTests: mocks.validateIntentAwareTestsMock,
  }));
  vi.doMock("../../source/assessors/pipeline.js", () => ({
    assessWeakCatch: mocks.assessWeakCatchMock,
  }));
  vi.doMock("../../source/feedback/store.js", () => ({
    appendAssessmentFeedbackRecord: mocks.appendAssessmentFeedbackRecordMock,
    buildAssessmentFeedbackRecord: mocks.buildAssessmentFeedbackRecordMock,
  }));
  vi.doMock("../../source/reporting/behavior-change.js", () => ({
    generateBehaviorReport: mocks.generateBehaviorReportMock,
  }));
  vi.doMock("../../source/utils/llm-client.js", () => ({
    LLMClient: mocks.LLMClientMock,
  }));

  return mocks;
};

describe("createCatchCommandResult", () => {
  it("skips generation when diff risk is below the threshold", async () => {
    const mocks = mockCatchDependencies(0.2);
    const { createCatchCommandResult } = await import(
      "../../source/commands/catch.js"
    );

    const result = await createCatchCommandResult(
      makeOptions({ riskThreshold: 0.5 }),
    );

    expect(result).toMatchObject({
      eligibleForGeneration: false,
      stats: null,
      statusMessage: "Skipped because the risk score is below the threshold.",
    });
    expect(mocks.dodgyDiffWorkflowMock).not.toHaveBeenCalled();
    expect(mocks.applyRiskAnalysisMock).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({ additionalContext: "loaded context" }),
    );
  });

  it("returns a no-tests result when generation produces nothing", async () => {
    const mocks = mockCatchDependencies(0.9);
    const { createCatchCommandResult } = await import(
      "../../source/commands/catch.js"
    );

    const result = await createCatchCommandResult(makeOptions());

    expect(result).toMatchObject({
      eligibleForGeneration: true,
      stats: {
        totalTestsGenerated: 0,
        llmUsage: defaultLlmUsage,
      },
      statusMessage: "No tests were generated for the current diff.",
    });
    expect(mocks.dodgyDiffWorkflowMock).toHaveBeenCalled();
    expect(mocks.intentAwareWorkflowMock).toHaveBeenCalled();
    expect(mocks.setupWorktreesMock).not.toHaveBeenCalled();
  });

  it("executes generated tests, assesses weak catches, and records stats", async () => {
    const mocks = mockCatchDependencies(0.95);
    const dodgyTest = makeGeneratedTest(
      "dodgy-diff",
      "test/dodgy.jittest.test.ts",
    );
    const intentTest = makeGeneratedTest(
      "intent-aware",
      "test/intent.jittest.test.ts",
    );
    const extraIntentTest = makeGeneratedTest(
      "intent-aware",
      "test/extra.jittest.test.ts",
    );
    mocks.dodgyDiffWorkflowMock.mockResolvedValue([dodgyTest]);
    mocks.intentAwareWorkflowMock.mockResolvedValue([
      intentTest,
      extraIntentTest,
    ]);
    mocks.validateIntentAwareTestsMock.mockRejectedValue(
      new Error("validation unavailable"),
    );
    mocks.dualExecutionMock.mockResolvedValue([
      makeDualResult(dodgyTest, "failed"),
      makeDualResult(intentTest, "passed"),
    ]);
    mocks.appendAssessmentFeedbackRecordMock.mockRejectedValue(
      new Error("read-only feedback file"),
    );

    const { createCatchCommandResult } = await import(
      "../../source/commands/catch.js"
    );
    const result = await createCatchCommandResult(
      makeOptions({ maxTotalTests: 2 }),
    );

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Generated 3 tests; executing first 2"),
    );
    expect(mocks.installWorktreeDependenciesMock).toHaveBeenCalledWith(
      "/tmp/parent",
      "/tmp/child",
      true,
    );
    expect(mocks.dualExecutionMock).toHaveBeenCalledWith(
      [dodgyTest, intentTest],
      "/tmp/parent",
      "/tmp/child",
      2,
      1000,
      true,
    );
    expect(mocks.assessWeakCatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ test: dodgyTest }),
      expect.any(Object),
      "child log",
      expect.any(Object),
      expect.any(Object),
    );
    expect(mocks.appendAssessmentFeedbackRecordMock).toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to record assessment feedback"),
    );
    expect(mocks.cleanupMock).toHaveBeenCalled();
    expect(result.reports).toEqual([report]);
    expect(result.stats).toMatchObject({
      totalTestsGenerated: 2,
      testsPassedOnParent: 2,
      testsFailedOnChild: 1,
      weakCatchCount: 1,
      hardeningCandidateCount: 1,
      reportsGenerated: 1,
      byWorkflow: {
        dodgyDiff: {
          generated: 1,
          weakCatches: 1,
          hardeningCandidates: 0,
        },
        intentAware: {
          generated: 1,
          weakCatches: 0,
          hardeningCandidates: 1,
        },
      },
      llmCallCount: 2,
      estimatedTokens: 15,
      estimatedCost: 0.001,
      llmUsage: defaultLlmUsage,
      diffRiskScore: 0.95,
    });
  });

  it("continues execution and non-LLM assessment after budget exhaustion", async () => {
    const mocks = mockCatchDependencies(0.95);
    const dodgyTest = makeGeneratedTest(
      "dodgy-diff",
      "test/dodgy.jittest.test.ts",
    );
    const exhaustedUsage = {
      ...defaultLlmUsage,
      budget: {
        status: "exhausted" as const,
        exhaustedReason: "tokens" as const,
        skippedCalls: 1,
        overshootAllowed: true,
        dollarBudgetEnforced: true,
      },
    };
    mocks.getStatsMock.mockReturnValue({
      callCount: 2,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalTokens: 15,
      estimatedCost: 0.001,
      llmUsage: exhaustedUsage,
    });
    mocks.isBudgetExhaustedMock.mockReturnValue(true);
    mocks.dodgyDiffWorkflowMock.mockResolvedValue([dodgyTest]);
    mocks.dualExecutionMock.mockResolvedValue([
      makeDualResult(dodgyTest, "failed"),
    ]);

    const { createCatchCommandResult } = await import(
      "../../source/commands/catch.js"
    );
    const result = await createCatchCommandResult(makeOptions());

    expect(mocks.intentAwareWorkflowMock).not.toHaveBeenCalled();
    expect(mocks.dualExecutionMock).toHaveBeenCalled();
    expect(mocks.assessWeakCatchMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ llmJudgeEnabled: false }),
    );
    // Budget exhaustion is surfaced via structured stats, not duplicated into
    // statusMessage (reporters render it from stats.llmUsage.budget).
    expect(result.statusMessage).toBeUndefined();
    expect(result.stats?.llmUsage.budget.status).toBe("exhausted");
  });
});

describe("runCatchCommand", () => {
  it("writes JSON reports", async () => {
    mockCatchDependencies(0.9);
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const { runCatchCommand } = await import("../../source/commands/catch.js");

    await runCatchCommand(makeOptions({ output: "json" }));

    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('"statusMessage": "No tests were generated'),
    );
  });

  it("writes console summaries", async () => {
    mockCatchDependencies(0.1);
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const { runCatchCommand } = await import("../../source/commands/catch.js");

    await runCatchCommand(
      makeOptions({ output: "console", riskThreshold: 0.5 }),
    );

    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("JiTTest catch analysis"),
    );
  });

  it("omits empty GitHub comments", async () => {
    const mocks = mockCatchDependencies(0.9);
    const dodgyTest = makeGeneratedTest(
      "dodgy-diff",
      "test/dodgy.jittest.test.ts",
    );
    mocks.dodgyDiffWorkflowMock.mockResolvedValue([dodgyTest]);
    mocks.dualExecutionMock.mockResolvedValue([
      makeDualResult(dodgyTest, "passed"),
    ]);
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const { runCatchCommand } = await import("../../source/commands/catch.js");

    await runCatchCommand(makeOptions({ output: "github-comment" }));

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("flake-guards candidates and excludes dropped tests from execution", async () => {
    const mocks = mockCatchDependencies(0.9);
    const stableTest = makeGeneratedTest(
      "dodgy-diff",
      "test/stable.jittest.test.ts",
    );
    const flakyTest = makeGeneratedTest(
      "dodgy-diff",
      "test/flaky.jittest.test.ts",
    );
    mocks.dodgyDiffWorkflowMock.mockResolvedValue([stableTest, flakyTest]);
    mocks.flakeGuardTestsMock.mockResolvedValue({
      stableTests: [stableTest],
      droppedCount: 1,
    });
    mocks.dualExecutionMock.mockResolvedValue([
      makeDualResult(stableTest, "passed"),
    ]);

    const { createCatchCommandResult } = await import(
      "../../source/commands/catch.js"
    );
    await createCatchCommandResult(
      makeOptions({ workflow: "dodgy-diff", flakeGuardRuns: 2 }),
    );

    expect(mocks.flakeGuardTestsMock).toHaveBeenCalledWith(
      [stableTest, flakyTest],
      "/tmp/parent",
      1000,
      2,
      2,
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Flake guard dropped 1"),
    );
    // The dropped flaky test never reaches dual execution.
    expect(mocks.dualExecutionMock).toHaveBeenCalledWith(
      [stableTest],
      "/tmp/parent",
      "/tmp/child",
      2,
      1000,
      true,
    );
  });
});
