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
import { dodgyDiffWorkflow } from "../generation/dodgy-diff.js";
import { intentAwareWorkflow } from "../generation/intent-aware.js";
import type { GeneratedTest } from "../generation/types.js";
import { harvestWeakCatches } from "../harvest/harvester.js";
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
  stats: RunStats | null;
  statusMessage?: string;
}

const writeStdout = (value: string): void => {
  // biome-ignore lint/correctness/noProcessGlobal: CLI output is written in a Node runtime.
  process.stdout.write(`${value}\n`);
};

const createCommandConfig = (options: CatchCommandOptions) =>
  loadConfig({
    workflow: options.workflow,
    riskThreshold: options.riskThreshold,
    testsPerFunction: options.testsPerFunction,
    testTimeout: options.timeout,
    outputFormat: options.output,
    reportThreshold: options.reportThreshold,
  });

const createResult = (
  options: CatchCommandOptions,
  workflow: CatchCommandOptions["workflow"],
  riskThreshold: number,
  diff: DiffContext,
  eligibleForGeneration: boolean,
  reports: readonly BehaviorReport[],
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
  });

  return {
    diff: await applyRiskAnalysis(options.cwd, diffContext),
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

  if (config.workflow === "intent-aware" || config.workflow === "both") {
    allTests.push(...(await intentAwareWorkflow(diff, repoRoot, llm, config)));
  }

  return {
    allTests,
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
      },
      intentAware: {
        generated: input.allTests.filter(
          (test) => test.workflow === "intent-aware",
        ).length,
        weakCatches: input.weakCatches.filter(
          (weakCatch) => weakCatch.test.workflow === "intent-aware",
        ).length,
      },
    },
    llmCallCount: input.llmStats.callCount,
    estimatedTokens:
      input.llmStats.totalInputTokens + input.llmStats.totalOutputTokens,
    estimatedCost: input.llmStats.estimatedCost,
    diffRiskScore: input.diff.riskScore,
  });

const executeInWorktrees = async (input: {
  options: CatchCommandOptions;
  config: ReturnType<typeof createCommandConfig>;
  allTests: readonly GeneratedTest[];
}): Promise<{
  dualResults: Awaited<ReturnType<typeof dualExecution>>;
  weakCatches: ReturnType<typeof harvestWeakCatches>;
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
    await Promise.all([
      installDependencies(worktrees.parentDir),
      installDependencies(worktrees.childDir),
    ]);

    const executableTests = await validateIntentAwareTests(
      input.allTests,
      worktrees.parentDir,
      input.config.testTimeout,
    );

    logger.info("Running dual execution...");
    const dualResults = await dualExecution(
      executableTests,
      worktrees.parentDir,
      worktrees.childDir,
      input.config.batchSize,
      input.config.testTimeout,
    );

    logger.info("Harvesting weak catches...");
    const weakCatches = harvestWeakCatches(dualResults);
    logger.info(`Found ${String(weakCatches.length)} weak catches`);

    return {
      dualResults,
      weakCatches,
      execMs: Date.now() - execStart,
    };
  } finally {
    await worktrees.cleanup();
  }
};

const assessWeakCatches = async (input: {
  weakCatches: ReturnType<typeof harvestWeakCatches>;
  diff: DiffContext;
  llm: LLMClient;
  config: ReturnType<typeof createCommandConfig>;
}): Promise<{
  reports: readonly BehaviorReport[];
  assessMs: number;
}> => {
  const assessStart = Date.now();
  const reports: BehaviorReport[] = [];

  for (const weakCatch of input.weakCatches) {
    const assessment = await assessWeakCatch(
      weakCatch,
      input.diff,
      weakCatch.childResult.failureMessage,
      input.llm,
      input.config,
    );

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
}): Promise<{
  reports: readonly BehaviorReport[];
  stats: RunStats;
}> => {
  const executed = await executeInWorktrees({
    options: input.options,
    config: input.config,
    allTests: input.allTests,
  });
  const assessed = await assessWeakCatches({
    weakCatches: executed.weakCatches,
    diff: input.diff,
    llm: input.llm,
    config: input.config,
  });

  return {
    reports: assessed.reports,
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
    null,
    "Skipped because the risk score is below the threshold.",
  );

const createNoTestsResult = (
  options: CatchCommandOptions,
  config: ReturnType<typeof createCommandConfig>,
  diff: DiffContext,
): CatchCommandResult =>
  createResult(
    options,
    config.workflow,
    config.riskThreshold,
    diff,
    true,
    [],
    null,
    "No tests were generated for the current diff.",
  );

export const createCatchCommandResult = async (
  options: CatchCommandOptions,
): Promise<CatchCommandResult> => {
  const startTime = Date.now();
  const config = createCommandConfig(options);
  const llm = new LLMClient(config.llm);
  const { diff, diffMs } = await loadDiffWithRisk(options);

  if (diff.riskScore < config.riskThreshold) {
    return createSkippedResult(options, config, diff);
  }

  const { allTests, genMs } = await generateTests(
    diff,
    options.cwd,
    llm,
    config,
  );

  if (allTests.length === 0) {
    return createNoTestsResult(options, config, diff);
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
  });

  return createResult(
    options,
    config.workflow,
    config.riskThreshold,
    diff,
    true,
    executed.reports,
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
      formatJsonReport(result.reports, result.stats, result.statusMessage),
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
      reportsGenerated: result.stats?.reportsGenerated,
      duration: result.stats?.duration,
      estimatedCost: result.stats?.estimatedCost,
      statusMessage: result.statusMessage,
      reports: result.stats ? result.reports : undefined,
    }).trimEnd(),
  );
};

export type { CatchCommandResult };
