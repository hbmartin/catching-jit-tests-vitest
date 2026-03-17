#!/usr/bin/env node
import process from "node:process";
import { Command } from "commander";
import { assessWeakCatch } from "./assessors/pipeline.js";
import { loadConfig } from "./config.js";
import { extractDiff } from "./diff/extractor.js";
import { computeRiskScore } from "./diff/risk-scorer.js";
import {
  installDependencies,
  setupWorktrees,
} from "./execution/git-worktree.js";
import { dualExecution } from "./execution/runner.js";
import { dodgyDiffWorkflow } from "./generation/dodgy-diff.js";
import { intentAwareWorkflow } from "./generation/intent-aware.js";
import type { GeneratedTest } from "./generation/types.js";
import { harvestWeakCatches } from "./harvest/harvester.js";
import { generateBehaviorReport } from "./reporting/behavior-change.js";
import { formatPRComment } from "./reporting/github-comment.js";
import { formatJsonReport } from "./reporting/json-report.js";
import type { BehaviorReport, RunStats } from "./reporting/types.js";
import { LLMClient } from "./utils/llm-client.js";
import { logger } from "./utils/logger.js";

async function runCatchWorkflow(options: {
  base: string;
  head: string;
  workflow: string;
  riskThreshold: string;
  testsPerFunction: string;
  timeout: string;
  output: string;
  reportThreshold: string;
}): Promise<void> {
  const startTime = Date.now();

  const config = loadConfig({
    workflow: options.workflow,
    riskThreshold: Number.parseFloat(options.riskThreshold),
    testsPerFunction: Number.parseInt(options.testsPerFunction, 10),
    testTimeout: Number.parseInt(options.timeout, 10),
    outputFormat: options.output,
    reportThreshold: Number.parseFloat(options.reportThreshold),
  });

  const llm = new LLMClient(config.llm);

  logger.info("Extracting diff context...");
  const diff = extractDiff(options.base, options.head, {
    title: "",
    body: "",
    branch: "",
    baseSha: options.base,
    headSha: options.head,
  });

  const riskScore = computeRiskScore(diff);
  logger.info(`Risk score: ${String(riskScore)}`);

  if (riskScore < config.riskThreshold) {
    logger.info("Risk score below threshold, skipping");
    return;
  }

  const diffMs = Date.now() - startTime;

  logger.info("Generating tests...");
  const genStart = Date.now();
  const allTests: GeneratedTest[] = [];

  if (config.workflow === "dodgy-diff" || config.workflow === "both") {
    const ddTests = await dodgyDiffWorkflow(diff, llm, config);
    allTests.push(...ddTests);
  }

  if (config.workflow === "intent-aware" || config.workflow === "both") {
    const iaTests = await intentAwareWorkflow(diff, llm, config);
    allTests.push(...iaTests);
  }

  const genMs = Date.now() - genStart;

  if (allTests.length === 0) {
    logger.info("No tests generated");
    return;
  }

  logger.info(
    `Generated ${String(allTests.length)} tests, setting up worktrees...`,
  );
  const execStart = Date.now();

  const worktrees = setupWorktrees(".", options.base, options.head);
  try {
    await Promise.all([
      installDependencies(worktrees.parentDir),
      installDependencies(worktrees.childDir),
    ]);

    logger.info("Running dual execution...");
    const dualResults = await dualExecution(
      allTests,
      worktrees.parentDir,
      worktrees.childDir,
      config.batchSize,
      config.testTimeout,
    );

    const execMs = Date.now() - execStart;

    logger.info("Harvesting weak catches...");
    const weakCatches = harvestWeakCatches(dualResults);
    logger.info(`Found ${String(weakCatches.length)} weak catches`);

    const assessStart = Date.now();
    const reports: BehaviorReport[] = [];

    for (const weakCatch of weakCatches) {
      const assessment = await assessWeakCatch(
        weakCatch,
        diff,
        weakCatch.childResult.failureMessage,
        llm,
        config,
      );

      if (assessment.shouldReport) {
        reports.push(generateBehaviorReport(assessment, weakCatch));
      }
    }

    const assessMs = Date.now() - assessStart;
    const totalMs = Date.now() - startTime;

    const llmStats = llm.getStats();
    const stats: RunStats = {
      duration: `${String(Math.round(totalMs / 1000))}s`,
      diffExtractionMs: diffMs,
      testGenerationMs: genMs,
      executionMs: execMs,
      assessmentMs: assessMs,
      filesAnalyzed: diff.files.length,
      functionsAnalyzed: diff.files.reduce(
        (sum, f) => sum + f.changedFunctions.length,
        0,
      ),
      totalTestsGenerated: allTests.length,
      testsPassedOnParent: dualResults.filter(
        (r) => r.parentOutcome.status === "passed",
      ).length,
      testsFailedOnChild: dualResults.filter(
        (r) => r.childOutcome.status === "failed",
      ).length,
      weakCatchCount: weakCatches.length,
      assessedAsTP: reports.length,
      assessedAsFP: weakCatches.length - reports.length,
      assessedAsUncertain: 0,
      reportsGenerated: reports.length,
      byWorkflow: {
        dodgyDiff: {
          generated: allTests.filter((t) => t.workflow === "dodgy-diff").length,
          weakCatches: weakCatches.filter(
            (w) => w.test.workflow === "dodgy-diff",
          ).length,
        },
        intentAware: {
          generated: allTests.filter((t) => t.workflow === "intent-aware")
            .length,
          weakCatches: weakCatches.filter(
            (w) => w.test.workflow === "intent-aware",
          ).length,
        },
      },
      llmCallCount: llmStats.callCount,
      estimatedTokens: llmStats.totalInputTokens + llmStats.totalOutputTokens,
      estimatedCost: llmStats.estimatedCost,
      diffRiskScore: riskScore,
    };

    if (config.outputFormat === "github-comment") {
      const comment = formatPRComment(reports, stats);
      if (comment.length > 0) {
        console.log(comment);
      }
    } else if (config.outputFormat === "json") {
      console.log(formatJsonReport(reports, stats));
    } else {
      console.log("\nJiTTest Results:");
      console.log(`  Files analyzed: ${String(stats.filesAnalyzed)}`);
      console.log(`  Tests generated: ${String(stats.totalTestsGenerated)}`);
      console.log(`  Weak catches: ${String(stats.weakCatchCount)}`);
      console.log(`  Reports: ${String(stats.reportsGenerated)}`);
      console.log(`  Duration: ${stats.duration}`);
      console.log(`  Cost: $${stats.estimatedCost.toFixed(4)}`);

      for (const report of reports) {
        console.log(`\n${report.headline}`);
        console.log(`  ${report.senseCheck}`);
      }
    }
  } finally {
    await worktrees.cleanup();
  }
}

const program = new Command()
  .name("jittest")
  .description("Just-in-Time catching test generation for Vitest")
  .version("0.1.0");

program
  .command("catch")
  .description("Generate catching tests for the current diff")
  .option("--base <sha>", "Base commit (default: origin/main)", "origin/main")
  .option("--head <sha>", "Head commit (default: HEAD)", "HEAD")
  .option(
    "--workflow <type>",
    "Workflow: dodgy-diff, intent-aware, both",
    "both",
  )
  .option("--risk-threshold <n>", "Minimum risk score to run (0-1)", "0")
  .option("--tests-per-function <n>", "Candidates per changed function", "3")
  .option("--timeout <ms>", "Per-test timeout", "30000")
  .option(
    "--output <format>",
    "Output: github-comment, json, console",
    "console",
  )
  .option(
    "--report-threshold <n>",
    "Min assessment score to report (-1 to 1)",
    "0",
  )
  .action(
    async (options: {
      base: string;
      head: string;
      workflow: string;
      riskThreshold: string;
      testsPerFunction: string;
      timeout: string;
      output: string;
      reportThreshold: string;
    }) => {
      await runCatchWorkflow(options);
    },
  );

program.parse(process.argv);
