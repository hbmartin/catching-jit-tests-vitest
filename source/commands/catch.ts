import { randomUUID } from "node:crypto";
import path from "node:path";

import { assessWeakCatch } from "../assessors/pipeline.js";
import type { CatchCommandOptions } from "../config.js";
import { loadConfig } from "../config.js";
import { extractDiffContext } from "../diff/extractor.js";
import { applyRiskAnalysis } from "../diff/risk-scorer.js";
import type { DiffContext } from "../diff/types.js";
import {
  installWorktreeDependencies,
  setupWorktrees,
} from "../execution/git-worktree.js";
import {
  dualExecution,
  flakeGuardTests,
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
import { formatGithubStepSummary } from "../reporting/github-step-summary.js";
import { formatJsonReport } from "../reporting/json-report.js";
import type { BehaviorReport, RunStats } from "../reporting/types.js";
import { runStatsSchema } from "../runtime-schemas.js";
import { mapConcurrent } from "../utils/concurrency.js";
import { DiskLLMCache } from "../utils/llm-cache.js";
import { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";
import { runCommand } from "../utils/process.js";

import { writeOutputFile } from "./report-utils.js";

const findingsExitCode = 2;
const sameRevisionExitCode = 3;

const verdictRank = {
  "false-positive": 0,
  "likely-false-positive": 1,
  uncertain: 2,
  "likely-strong": 3,
  "strong-catch": 4,
} as const;

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
  exitCode?: number;
}

const writeStdout = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

// Only include nested overrides (cache, llm.budget) when the user actually set
// a flag. Always emitting them would shallow-overwrite the corresponding
// jittest.config.json blocks with empty/default objects.
const buildCacheOverride = (
  options: CatchCommandOptions,
): Record<string, unknown> | undefined => {
  if (options.noCache === undefined && options.cacheDir === undefined) {
    return;
  }
  return {
    ...(options.noCache === undefined ? {} : { enabled: !options.noCache }),
    ...(options.cacheDir === undefined ? {} : { dir: options.cacheDir }),
  };
};

const buildBudgetOverride = (
  options: CatchCommandOptions,
): Record<string, unknown> | undefined => {
  if (options.maxCostUsd === undefined && options.maxTokens === undefined) {
    return;
  }
  return {
    ...(options.maxCostUsd === undefined
      ? {}
      : { maxCostUsd: options.maxCostUsd }),
    ...(options.maxTokens === undefined
      ? {}
      : { maxTokens: options.maxTokens }),
  };
};

const createCommandConfig = (options: CatchCommandOptions) => {
  const budget = buildBudgetOverride(options);
  return loadConfig(
    {
      workflow: options.workflow,
      riskThreshold: options.riskThreshold,
      testsPerFunction: options.testsPerFunction,
      maxTotalTests: options.maxTotalTests,
      batchSize: options.batchSize,
      parallelWorktrees: options.parallelWorktrees,
      assessConcurrency: options.assessConcurrency,
      flakeGuardRuns: options.flakeGuardRuns,
      testTimeout: options.timeout,
      outputFormat: options.output,
      reportThreshold: options.reportThreshold,
      feedbackPath: options.feedbackPath,
      contextFiles: options.contextFiles,
      autoContext:
        options.noAutoContext === undefined
          ? undefined
          : !options.noAutoContext,
      autoContextFiles: options.autoContextFiles,
      include: options.include,
      exclude: options.exclude,
      cache: buildCacheOverride(options),
      llm: {
        ...(options.llmModel === undefined ? {} : { model: options.llmModel }),
        ...(options.llmProvider === undefined
          ? {}
          : { provider: options.llmProvider }),
        ...(options.llmBaseUrl === undefined
          ? {}
          : { baseUrl: options.llmBaseUrl }),
        ...(budget === undefined ? {} : { budget }),
      },
    },
    { cwd: options.cwd, configPath: options.configPath },
  );
};

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
  exitCode?: number,
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
  exitCode,
});

const emptyDiff = (
  options: CatchCommandOptions,
  baseSha: string,
  headSha: string,
): DiffContext => ({
  rawDiff: "",
  pr: {
    title: options.prTitle,
    body: options.prBody,
    branch: options.head,
    baseSha,
    headSha,
  },
  files: [],
  riskScore: 0,
  riskFactors: {
    sensitivityScore: 0,
    complexityScore: 0,
    coverageGap: 0,
    defectHistory: 0,
  },
  riskReasons: [],
  changedSymbols: [],
});

async function resolveCommitSha(
  repoRoot: string,
  ref: string,
): Promise<string> {
  const result = await runCommand(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { cwd: repoRoot },
  );
  return result.stdout.trim();
}

async function verifyDistinctRevisions(options: CatchCommandOptions): Promise<{
  baseSha: string;
  headSha: string;
  sameRevision: boolean;
}> {
  const [baseSha, headSha] = await Promise.all([
    resolveCommitSha(options.cwd, options.base),
    resolveCommitSha(options.cwd, options.head),
  ]);

  return {
    baseSha,
    headSha,
    sameRevision: baseSha === headSha,
  };
}

const loadDiffWithRisk = async (
  options: CatchCommandOptions,
  config: ReturnType<typeof createCommandConfig>,
  revisions: {
    baseSha: string;
    headSha: string;
  },
): Promise<{
  diff: DiffContext;
  diffMs: number;
}> => {
  logger.info("Extracting diff context...");
  const diffStart = Date.now();
  const diffContext = await extractDiffContext({
    baseRef: revisions.baseSha,
    headRef: revisions.headSha,
    cwd: options.cwd,
    prTitle: options.prTitle,
    prBody: options.prBody,
    include: config.include,
    exclude: config.exclude,
  });
  const additionalContext = await loadIntentContext(
    options.cwd,
    config.contextFiles,
    {
      optionalContextFiles: config.autoContext ? config.autoContextFiles : [],
    },
  );

  return {
    diff: await applyRiskAnalysis(
      options.cwd,
      {
        ...diffContext,
        additionalContext,
      },
      {
        sensitivityGlobs: config.sensitivityGlobs,
      },
    ),
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
  revisions: {
    baseSha: string;
    headSha: string;
  };
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
    input.revisions.baseSha,
    input.revisions.headSha,
  );

  try {
    await installWorktreeDependencies(
      worktrees.parentDir,
      worktrees.childDir,
      input.config.parallelWorktrees,
    );

    let candidateTests = input.allTests;
    if (input.config.flakeGuardRuns > 1) {
      logger.info(
        `Flake-guarding ${String(input.allTests.length)} tests over ${String(
          input.config.flakeGuardRuns,
        )} parent runs...`,
      );
      const { stableTests, droppedCount } = await flakeGuardTests(
        input.allTests,
        worktrees.parentDir,
        input.config.testTimeout,
        input.config.flakeGuardRuns,
        input.config.batchSize,
      );
      if (droppedCount > 0) {
        logger.warn(
          `Flake guard dropped ${String(droppedCount)} unstable test(s) before dual execution`,
        );
      }
      candidateTests = stableTests;
    }

    let executableTests = candidateTests;
    try {
      executableTests = await validateIntentAwareTests(
        candidateTests,
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

  // Feedback records are appended through a serialized promise chain so the
  // concurrent assessments below never interleave partial writes into the
  // JSONL file. (Assessment itself is independent per weak catch.)
  // recordAssessmentFeedback swallows its own errors, so the chain is never
  // poisoned by a failed write.
  let appendChain: Promise<void> = Promise.resolve();
  const enqueueAppend = (task: () => Promise<void>): Promise<void> => {
    appendChain = appendChain.then(task);
    return appendChain;
  };

  const assessed = await mapConcurrent(
    input.weakCatches,
    input.config.assessConcurrency,
    async (weakCatch) => {
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
      await enqueueAppend(() =>
        recordAssessmentFeedback({
          options: input.options,
          config: input.config,
          runId: input.runId,
          recordedAt,
          diff: input.diff,
          weakCatch,
          assessment,
        }),
      );

      return { weakCatch, assessment };
    },
  );

  // mapConcurrent preserves input order, so report order is deterministic.
  const reports: BehaviorReport[] = assessed
    .filter((entry) => entry.assessment.shouldReport)
    .map((entry) => generateBehaviorReport(entry.assessment, entry.weakCatch));

  return {
    reports,
    assessMs: Date.now() - assessStart,
  };
};

const executeCatchWorkflow = async (input: {
  options: CatchCommandOptions;
  revisions: {
    baseSha: string;
    headSha: string;
  };
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
    revisions: input.revisions,
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

const createNoMatchingFilesResult = (
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
    "No matching changed files were found for the current diff.",
  );

const createSameRevisionResult = (
  options: CatchCommandOptions,
  baseSha: string,
  headSha: string,
): CatchCommandResult =>
  createResult(
    options,
    options.workflow,
    options.riskThreshold,
    emptyDiff(options, baseSha, headSha),
    false,
    [],
    [],
    null,
    `Base and head both resolve to ${baseSha}; nothing to analyze.`,
    sameRevisionExitCode,
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

const createCatchCommandResult = async (
  options: CatchCommandOptions,
): Promise<CatchCommandResult> => {
  const startTime = Date.now();
  const runId = randomUUID();
  const revisions = await verifyDistinctRevisions(options);

  if (revisions.sameRevision) {
    return createSameRevisionResult(
      options,
      revisions.baseSha,
      revisions.headSha,
    );
  }

  const config = createCommandConfig(options);
  const { diff, diffMs } = await loadDiffWithRisk(options, config, revisions);

  if (diff.files.length === 0) {
    return createNoMatchingFilesResult(options, config, diff);
  }

  if (diff.riskScore < config.riskThreshold) {
    return createSkippedResult(options, config, diff);
  }

  // Construct the LLM client only once we know we'll generate tests. Risk
  // scoring is heuristic (no LLM), so a below-threshold skip must not require
  // an OpenRouter API key.
  const cache = config.cache.enabled
    ? new DiskLLMCache(path.resolve(options.cwd, config.cache.dir))
    : undefined;
  const llm = new LLMClient({
    ...config.llm,
    ...(cache === undefined ? {} : { cache }),
  });

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
    revisions,
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

function shouldFailOnReports(
  reports: readonly BehaviorReport[],
  failOn: CatchCommandOptions["failOn"],
): boolean {
  if (failOn === undefined || reports.length === 0) {
    return false;
  }

  if (failOn === "any-report") {
    return true;
  }

  const threshold = verdictRank[failOn];
  return reports.some(
    (report) => verdictRank[report.details.verdict] >= threshold,
  );
}

function renderConsoleResult(result: CatchCommandResult): string {
  return formatCatchResult({
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
  }).trimEnd();
}

function renderOutput(
  result: CatchCommandResult,
  output: CatchCommandOptions["output"],
): string {
  if (output === "github-comment") {
    return formatPRComment(result.reports, result.stats, result.statusMessage);
  }

  if (output === "github-step-summary") {
    return formatGithubStepSummary(
      result.reports,
      result.stats,
      result.statusMessage,
    );
  }

  if (output === "json") {
    return formatJsonReport(
      result.reports,
      result.stats,
      result.statusMessage,
      result.hardeningCandidates,
    );
  }

  return renderConsoleResult(result);
}

async function writeSideOutputs(
  options: CatchCommandOptions,
  result: CatchCommandResult,
): Promise<void> {
  if (options.jsonFile !== undefined) {
    await writeOutputFile(
      options.cwd,
      options.jsonFile,
      renderOutput(result, "json"),
    );
  }

  if (options.summaryFile !== undefined) {
    await writeOutputFile(
      options.cwd,
      options.summaryFile,
      renderOutput(result, "github-step-summary"),
    );
  }

  if (options.commentFile !== undefined) {
    await writeOutputFile(
      options.cwd,
      options.commentFile,
      renderOutput(result, "github-comment"),
    );
  }
}

const runCatchCommand = async (options: CatchCommandOptions): Promise<void> => {
  const result = await createCatchCommandResult(options);
  await writeSideOutputs(options, result);

  const output = renderOutput(result, options.output);
  if (output.length > 0) {
    writeStdout(output);
  }

  if (result.exitCode !== undefined) {
    process.exitCode = result.exitCode;
  } else if (shouldFailOnReports(result.reports, options.failOn)) {
    process.exitCode = findingsExitCode;
  }
};

export type { CatchCommandResult };
export {
  createCatchCommandResult,
  findingsExitCode,
  renderOutput,
  runCatchCommand,
  sameRevisionExitCode,
  selectAssessmentExecutionLog,
  shouldFailOnReports,
  verifyDistinctRevisions,
};
