import { randomUUID } from "node:crypto";
import path from "node:path";

import { assessWeakCatch } from "../assessors/pipeline.js";
import type { CatchCommandOptions } from "../config.js";
import { loadConfig } from "../config.js";
import { extractDiffContext } from "../diff/extractor.js";
import { applyRiskAnalysis } from "../diff/risk-scorer.js";
import type { DiffContext } from "../diff/types.js";
import {
  installDependencies,
  setupWorktrees,
} from "../execution/git-worktree.js";
import {
  dualExecution,
  validateIntentAwareTests,
} from "../execution/runner.js";
import {
  appendAssessmentFeedbackRecord,
  buildAssessmentFeedbackRecord,
} from "../feedback/store.js";
import { dodgyDiffWorkflow } from "../generation/dodgy-diff.js";
import { intentAwareWorkflow } from "../generation/intent-aware.js";
import { loadIntentContext } from "../generation/intent-context.js";
import type { GeneratedTest } from "../generation/types.js";
import {
  harvestHardeningCandidates,
  harvestWeakCatches,
} from "../harvest/harvester.js";
import type { HardeningCandidate } from "../harvest/types.js";
import { generateBehaviorReport } from "../reporting/behavior-change.js";
import { formatCatchResult } from "../reporting/console.js";
import { formatPRComment } from "../reporting/github-comment.js";
import { formatJsonReport } from "../reporting/json-report.js";
import type { BehaviorReport, RunStats } from "../reporting/types.js";
import { runStatsSchema } from "../runtime-schemas.js";
import { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";

interface CatchCommandResult {
  baseRef: string;
  headRef: string;
  workflow: CatchCommandOptions["workflow"];
  riskThreshold: number;
  diff: DiffContext;
  eligibleForGeneration: boolean;
  reports: readonly BehaviorReport[];
  hardeningCandidates: readonly HardeningCandidate[];
  stats: RunStats | null;
  statusMessage?: string;
}

const writeStdout = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

const createCommandConfig = (options: CatchCommandOptions) =>
  loadConfig({
    workflow: options.workflow,
    riskThreshold: options.riskThreshold,
    testsPerFunction: options.testsPerFunction,
    maxTotalTests: options.maxTotalTests,
    batchSize: options.batchSize,
    parallelWorktrees: options.parallelWorktrees,
    testTimeout: options.timeout,
    outputFormat: options.output,
    reportThreshold: options.reportThreshold,
    feedbackPath: options.feedbackPath,
    contextFiles: options.contextFiles,
    include: options.include,
    exclude: options.exclude,
    llm: {
      ...(options.llmModel === undefined ? {} : { model: options.llmModel }),
      budget: {
        maxCostUsd: options.maxCostUsd,
        maxTokens: options.maxTokens,
      },
    },
  });

const createResult = (
  options: CatchCommandOptions,
  workflow: CatchCommandOptions["workflow"],
  riskThreshold: number,
  diff: DiffContext,
  eligibleForGeneration: boolean,
  reports: readonly BehaviorReport[],
  hardeningCandidates: readonly HardeningCandidate[],
  stats: RunStats | null,
  statusMessage?: string,
): CatchCommandResult => ({
  baseRef: options.base,
  headRef: options.head,
  workflow,
  riskThreshold,
  diff,
  eligibleForGeneration,
  reports,
  hardeningCandidates,
  stats,
  statusMessage,
});

const loadDiffWithRisk = async (
  options: CatchCommandOptions,
): Promise<{
  diff: DiffContext;
  diffMs: number;
}> => {
  logger.info("Extracting diff context...");
  const diffStart = Date.now();
  const diffContext = await extractDiffContext({
    baseRef: options.base,
    headRef: options.head,
    cwd: options.cwd,
    prTitle: options.prTitle,
    prBody: options.prBody,
    include: options.include,
    exclude: options.exclude,
  });
  const additionalContext = await loadIntentContext(
    options.cwd,
    options.contextFiles,
  );

  return {
    diff: await applyRiskAnalysis(options.cwd, {
      ...diffContext,
      additionalContext,
    }),
    diffMs: Date.now() - diffStart,
  };
};

const generateTests = async (
  diff: DiffContext,
  repoRoot: string,
  llm: LLMClient,
  config: ReturnType<typeof createCommandConfig>,
): Promise<{
  allTests: GeneratedTest[];
  genMs: number;
}> => {
  logger.info("Generating tests...");
  const genStart = Date.now();
  const allTests: GeneratedTest[] = [];

  if (config.workflow === "dodgy-diff" || config.workflow === "both") {
    allTests.push(...(await dodgyDiffWorkflow(diff, repoRoot, llm, config)));
  }

  if (
    (config.workflow === "intent-aware" || config.workflow === "both") &&
    !llm.isBudgetExhausted()
  ) {
    allTests.push(...(await intentAwareWorkflow(diff, repoRoot, llm, config)));
  }

  if (allTests.length > config.maxTotalTests) {
    logger.warn(
      `Generated ${String(allTests.length)} tests; executing first ${String(
        config.maxTotalTests,
      )} because maxTotalTests is configured`,
    );
  }

  return {
    allTests: allTests.slice(0, config.maxTotalTests),
    genMs: Date.now() - genStart,
  };
};

const buildRunStats = (input: {
  diff: DiffContext;
  diffMs: number;
  genMs: number;
  execMs: number;
  assessMs: number;
  totalMs: number;
  allTests: readonly GeneratedTest[];
  dualResults: Awaited<ReturnType<typeof dualExecution>>;
  weakCatches: ReturnType<typeof harvestWeakCatches>;
  hardeningCandidates: ReturnType<typeof harvestHardeningCandidates>;
  reports: readonly BehaviorReport[];
  llmStats: ReturnType<LLMClient["getStats"]>;
}): RunStats =>
  runStatsSchema.parse({
    duration: `${String(Math.round(input.totalMs / 1000))}s`,
    diffExtractionMs: input.diffMs,
    testGenerationMs: input.genMs,
    executionMs: input.execMs,
    assessmentMs: input.assessMs,
    filesAnalyzed: input.diff.files.length,
    functionsAnalyzed: input.diff.files.reduce(
      (sum, file) => sum + file.changedFunctions.length,
      0,
    ),
    totalTestsGenerated: input.allTests.length,
    testsPassedOnParent: input.dualResults.filter(
      (result) => result.parentOutcome.status === "passed",
    ).length,
    testsFailedOnChild: input.dualResults.filter(
      (result) => result.childOutcome.status === "failed",
    ).length,
    weakCatchCount: input.weakCatches.length,
    hardeningCandidateCount: input.hardeningCandidates.length,
    assessedAsTP: input.reports.length,
    assessedAsFP: input.weakCatches.length - input.reports.length,
    assessedAsUncertain: 0,
    reportsGenerated: input.reports.length,
    byWorkflow: {
      dodgyDiff: {
        generated: input.allTests.filter(
          (test) => test.workflow === "dodgy-diff",
        ).length,
        weakCatches: input.weakCatches.filter(
          (weakCatch) => weakCatch.test.workflow === "dodgy-diff",
        ).length,
        hardeningCandidates: input.hardeningCandidates.filter(
          (candidate) => candidate.test.workflow === "dodgy-diff",
        ).length,
      },
      intentAware: {
        generated: input.allTests.filter(
          (test) => test.workflow === "intent-aware",
        ).length,
        weakCatches: input.weakCatches.filter(
          (weakCatch) => weakCatch.test.workflow === "intent-aware",
        ).length,
        hardeningCandidates: input.hardeningCandidates.filter(
          (candidate) => candidate.test.workflow === "intent-aware",
        ).length,
      },
    },
    llmCallCount: input.llmStats.callCount,
    estimatedTokens: input.llmStats.totalTokens,
    estimatedCost: input.llmStats.estimatedCost,
    llmUsage: input.llmStats.llmUsage,
    diffRiskScore: input.diff.riskScore,
  });

const executeInWorktrees = async (input: {
  options: CatchCommandOptions;
  config: ReturnType<typeof createCommandConfig>;
  allTests: readonly GeneratedTest[];
}): Promise<{
  dualResults: Awaited<ReturnType<typeof dualExecution>>;
  weakCatches: ReturnType<typeof harvestWeakCatches>;
  hardeningCandidates: ReturnType<typeof harvestHardeningCandidates>;
  execMs: number;
}> => {
  logger.info(
    `Generated ${String(input.allTests.length)} tests, setting up worktrees...`,
  );
  const execStart = Date.now();
  const worktrees = await setupWorktrees(
    input.options.cwd,
    input.options.base,
    input.options.head,
  );

  try {
    if (input.config.parallelWorktrees) {
      await Promise.all([
        installDependencies(worktrees.parentDir),
        installDependencies(worktrees.childDir),
      ]);
    } else {
      await installDependencies(worktrees.parentDir);
      await installDependencies(worktrees.childDir);
    }

    let executableTests = input.allTests;
    try {
      executableTests = await validateIntentAwareTests(
        input.allTests,
        worktrees.parentDir,
        input.config.testTimeout,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Intent-aware validation failed; executing generated tests without pre-validation: ${message}`,
      );
    }

    logger.info("Running dual execution...");
    const dualResults = await dualExecution(
      executableTests,
      worktrees.parentDir,
      worktrees.childDir,
      input.config.batchSize,
      input.config.testTimeout,
      input.config.parallelWorktrees,
    );

    logger.info("Harvesting weak catches...");
    const weakCatches = harvestWeakCatches(dualResults);
    const hardeningCandidates = harvestHardeningCandidates(dualResults);
    logger.info(`Found ${String(weakCatches.length)} weak catches`);
    logger.info(
      `Found ${String(hardeningCandidates.length)} hardening candidates`,
    );

    return {
      dualResults,
      weakCatches,
      hardeningCandidates,
      execMs: Date.now() - execStart,
    };
  } finally {
    await worktrees.cleanup();
  }
};

const recordAssessmentFeedback = async (input: {
  options: CatchCommandOptions;
  config: ReturnType<typeof createCommandConfig>;
  runId: string;
  recordedAt: string;
  diff: DiffContext;
  weakCatch: ReturnType<typeof harvestWeakCatches>[number];
  assessment: Awaited<ReturnType<typeof assessWeakCatch>>;
}): Promise<void> => {
  const feedbackPath = path.resolve(
    input.options.cwd,
    input.config.feedbackPath,
  );

  try {
    await appendAssessmentFeedbackRecord(
      feedbackPath,
      buildAssessmentFeedbackRecord({
        runId: input.runId,
        recordedAt: input.recordedAt,
        baseRef: input.options.base,
        headRef: input.options.head,
        workflow: input.config.workflow,
        diff: input.diff,
        weakCatch: input.weakCatch,
        assessment: input.assessment,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to record assessment feedback: ${message}`);
  }
};

const selectAssessmentExecutionLog = (
  executionLog: string | undefined,
  failureMessage: string,
): string =>
  executionLog && executionLog.trim().length > 0
    ? executionLog
    : failureMessage;

const assessWeakCatches = async (input: {
  options: CatchCommandOptions;
  weakCatches: ReturnType<typeof harvestWeakCatches>;
  diff: DiffContext;
  llm: LLMClient;
  config: ReturnType<typeof createCommandConfig>;
  runId: string;
}): Promise<{
  reports: readonly BehaviorReport[];
  assessMs: number;
}> => {
  const assessStart = Date.now();
  const reports: BehaviorReport[] = [];

  for (const weakCatch of input.weakCatches) {
    const recordedAt = new Date().toISOString();
    const assessmentConfig = input.llm.isBudgetExhausted()
      ? { ...input.config, llmJudgeEnabled: false }
      : input.config;
    const assessment = await assessWeakCatch(
      weakCatch,
      input.diff,
      selectAssessmentExecutionLog(
        weakCatch.executionLog,
        weakCatch.childResult.failureMessage,
      ),
      input.llm,
      assessmentConfig,
    );
    await recordAssessmentFeedback({
      options: input.options,
      config: input.config,
      runId: input.runId,
      recordedAt,
      diff: input.diff,
      weakCatch,
      assessment,
    });

    if (assessment.shouldReport) {
      reports.push(generateBehaviorReport(assessment, weakCatch));
    }
  }

  return {
    reports,
    assessMs: Date.now() - assessStart,
  };
};

const executeCatchWorkflow = async (input: {
  options: CatchCommandOptions;
  diff: DiffContext;
  llm: LLMClient;
  config: ReturnType<typeof createCommandConfig>;
  allTests: readonly GeneratedTest[];
  diffMs: number;
  genMs: number;
  startTime: number;
  runId: string;
}): Promise<{
  reports: readonly BehaviorReport[];
  hardeningCandidates: readonly HardeningCandidate[];
  stats: RunStats;
}> => {
  const executed = await executeInWorktrees({
    options: input.options,
    config: input.config,
    allTests: input.allTests,
  });
  const assessed = await assessWeakCatches({
    options: input.options,
    weakCatches: executed.weakCatches,
    diff: input.diff,
    llm: input.llm,
    config: input.config,
    runId: input.runId,
  });

  return {
    reports: assessed.reports,
    hardeningCandidates: executed.hardeningCandidates,
    stats: buildRunStats({
      diff: input.diff,
      diffMs: input.diffMs,
      genMs: input.genMs,
      execMs: executed.execMs,
      assessMs: assessed.assessMs,
      totalMs: Date.now() - input.startTime,
      allTests: input.allTests,
      dualResults: executed.dualResults,
      weakCatches: executed.weakCatches,
      hardeningCandidates: executed.hardeningCandidates,
      reports: assessed.reports,
      llmStats: input.llm.getStats(),
    }),
  };
};

const createSkippedResult = (
  options: CatchCommandOptions,
  config: ReturnType<typeof createCommandConfig>,
  diff: DiffContext,
): CatchCommandResult =>
  createResult(
    options,
    config.workflow,
    config.riskThreshold,
    diff,
    false,
    [],
    [],
    null,
    "Skipped because the risk score is below the threshold.",
  );

const createNoTestsResult = (
  options: CatchCommandOptions,
  config: ReturnType<typeof createCommandConfig>,
  diff: DiffContext,
  stats: RunStats | null,
): CatchCommandResult =>
  createResult(
    options,
    config.workflow,
    config.riskThreshold,
    diff,
    true,
    [],
    [],
    stats,
    "No tests were generated for the current diff.",
  );

const buildNoExecutionStats = (input: {
  diff: DiffContext;
  diffMs: number;
  genMs: number;
  totalMs: number;
  allTests: readonly GeneratedTest[];
  llmStats: ReturnType<LLMClient["getStats"]>;
}): RunStats =>
  buildRunStats({
    diff: input.diff,
    diffMs: input.diffMs,
    genMs: input.genMs,
    execMs: 0,
    assessMs: 0,
    totalMs: input.totalMs,
    allTests: input.allTests,
    dualResults: [],
    weakCatches: [],
    hardeningCandidates: [],
    reports: [],
    llmStats: input.llmStats,
  });

export const createCatchCommandResult = async (
  options: CatchCommandOptions,
): Promise<CatchCommandResult> => {
  const startTime = Date.now();
  const runId = randomUUID();
  const config = createCommandConfig(options);
  const { diff, diffMs } = await loadDiffWithRisk(options);

  if (diff.riskScore < config.riskThreshold) {
    return createSkippedResult(options, config, diff);
  }

  // Construct the LLM client only once we know we'll generate tests. Risk
  // scoring is heuristic (no LLM), so a below-threshold skip must not require
  // an OpenRouter API key.
  const llm = new LLMClient(config.llm);

  const { allTests, genMs } = await generateTests(
    diff,
    options.cwd,
    llm,
    config,
  );

  if (allTests.length === 0) {
    return createNoTestsResult(
      options,
      config,
      diff,
      buildNoExecutionStats({
        diff,
        diffMs,
        genMs,
        totalMs: Date.now() - startTime,
        allTests,
        llmStats: llm.getStats(),
      }),
    );
  }

  const executed = await executeCatchWorkflow({
    options,
    diff,
    llm,
    config,
    allTests,
    diffMs,
    genMs,
    startTime,
    runId,
  });

  return createResult(
    options,
    config.workflow,
    config.riskThreshold,
    diff,
    true,
    executed.reports,
    executed.hardeningCandidates,
    executed.stats,
  );
};

export const runCatchCommand = async (
  options: CatchCommandOptions,
): Promise<void> => {
  const result = await createCatchCommandResult(options);

  if (options.output === "github-comment") {
    const comment = formatPRComment(
      result.reports,
      result.stats,
      result.statusMessage,
    );

    if (comment.length > 0) {
      writeStdout(comment);
    }

    return;
  }

  if (options.output === "json") {
    writeStdout(
      formatJsonReport(
        result.reports,
        result.stats,
        result.statusMessage,
        result.hardeningCandidates,
      ),
    );

    return;
  }

  writeStdout(
    formatCatchResult({
      baseRef: result.baseRef,
      headRef: result.headRef,
      workflow: result.workflow,
      riskThreshold: result.riskThreshold,
      eligibleForGeneration: result.eligibleForGeneration,
      fileCount: result.diff.files.length,
      riskScore: result.diff.riskScore,
      riskReasons: result.diff.riskReasons ?? [],
      totalTestsGenerated: result.stats?.totalTestsGenerated,
      weakCatchCount: result.stats?.weakCatchCount,
      hardeningCandidateCount: result.stats?.hardeningCandidateCount,
      reportsGenerated: result.stats?.reportsGenerated,
      duration: result.stats?.duration,
      estimatedCost: result.stats?.estimatedCost,
      llmUsage: result.stats?.llmUsage,
      statusMessage: result.statusMessage,
      reports: result.stats ? result.reports : undefined,
    }).trimEnd(),
  );
};

export type { CatchCommandResult };
export { selectAssessmentExecutionLog };
