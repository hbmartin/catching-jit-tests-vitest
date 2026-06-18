#!/usr/bin/env node
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { runCalibrateCommand } from "./commands/calibrate.js";
import { runCatchCommand } from "./commands/catch.js";
import {
  parseCalibrateCommandOptions,
  parseCatchCommandOptions,
} from "./config.js";
import { cliVersion } from "./version.js";

const helpText = `Usage
  jittest <command> [options]

Commands
  catch      Generate catching tests for the current diff
  calibrate  Analyze feedback records and recommend assessor weights

Global options
  --help     Show help
  --version  Show version

catch options
  --base <ref>             Base git ref (default: origin/main)
  --head <ref>             Head git ref (default: HEAD)
  --workflow <name>        dodgy-diff | intent-aware | both
  --risk-threshold <num>   Minimum risk score required for generation
  --tests-per-function <n> Candidates per changed function
  --max-total-tests <n>    Maximum generated tests to execute
  --batch-size <n>         Generated tests per execution batch
  --parallel-worktrees <b> Run parent/child installs and tests in parallel
  --assess-concurrency <n> Weak catches assessed concurrently (default: 4)
  --flake-guard-runs <n>   Re-run candidates on parent N times; drop flaky ones
  --include <glob>         Changed file glob to include
  --exclude <glob>         Changed file glob to exclude
  --timeout <ms>           Per-test timeout
  --output <format>        console | json | github-comment
  --report-threshold <n>   Minimum score to report
  --feedback-path <path>   JSONL file for assessor feedback records
  --context-file <path>    Extra local context file for intent analysis
  --pr-title <text>        Pull request title for intent-aware analysis
  --pr-body <text>         Pull request body for intent-aware analysis
  --llm-model <model>      Model id (provider-specific)
  --llm-provider <name>    openrouter | openai-compatible (default: openrouter)
  --llm-base-url <url>     Base URL for the openai-compatible provider
  --max-cost-usd <number>  Run-level OpenRouter dollar budget
  --max-tokens <number>    Run-level LLM token budget
  --cwd <path>             Repository root (default: .)
  --config <path>          Path to jittest.config.json (default: auto-discover)
  --no-cache               Disable the on-disk LLM response cache
  --cache-dir <path>       LLM cache directory (default: .jittest/cache)

calibrate options
  --feedback-path <path>   JSONL feedback records to analyze
  --output <format>        console | json
  --config <path>          Path to jittest.config.json (default: auto-discover)
  --cwd <path>             Repository root (default: .)
`;

const writeStdout = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

const writeStderr = (value: string): void => {
  process.stderr.write(`${value}\n`);
};

const printHelp = (): void => {
  writeStdout(helpText);
};

const printVersion = (): void => {
  writeStdout(cliVersion);
};

const parseCatchOptions = (argv: readonly string[]) => {
  const parsed = parseArgs({
    args: [...argv],
    options: {
      base: { type: "string" },
      head: { type: "string" },
      workflow: { type: "string" },
      "risk-threshold": { type: "string" },
      "tests-per-function": { type: "string" },
      "max-total-tests": { type: "string" },
      "batch-size": { type: "string" },
      "parallel-worktrees": { type: "string" },
      "assess-concurrency": { type: "string" },
      "flake-guard-runs": { type: "string" },
      include: { type: "string", multiple: true },
      exclude: { type: "string", multiple: true },
      timeout: { type: "string" },
      output: { type: "string" },
      "report-threshold": { type: "string" },
      "feedback-path": { type: "string" },
      "context-file": { type: "string", multiple: true },
      "pr-title": { type: "string" },
      "pr-body": { type: "string" },
      "llm-model": { type: "string" },
      "llm-provider": { type: "string" },
      "llm-base-url": { type: "string" },
      "max-cost-usd": { type: "string" },
      "max-tokens": { type: "string" },
      cwd: { type: "string" },
      config: { type: "string" },
      "no-cache": { type: "boolean" },
      "cache-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printHelp();
    return null;
  }

  return parseCatchCommandOptions({
    base: parsed.values.base,
    head: parsed.values.head,
    workflow: parsed.values.workflow,
    riskThreshold: parsed.values["risk-threshold"],
    testsPerFunction: parsed.values["tests-per-function"],
    maxTotalTests: parsed.values["max-total-tests"],
    batchSize: parsed.values["batch-size"],
    parallelWorktrees: parsed.values["parallel-worktrees"],
    assessConcurrency: parsed.values["assess-concurrency"],
    flakeGuardRuns: parsed.values["flake-guard-runs"],
    include: parsed.values.include,
    exclude: parsed.values.exclude,
    timeout: parsed.values.timeout,
    output: parsed.values.output,
    reportThreshold: parsed.values["report-threshold"],
    feedbackPath: parsed.values["feedback-path"],
    contextFiles: parsed.values["context-file"],
    prTitle: parsed.values["pr-title"],
    prBody: parsed.values["pr-body"],
    llmModel: parsed.values["llm-model"],
    llmProvider: parsed.values["llm-provider"],
    llmBaseUrl: parsed.values["llm-base-url"],
    maxCostUsd: parsed.values["max-cost-usd"],
    maxTokens: parsed.values["max-tokens"],
    cwd: parsed.values.cwd,
    configPath: parsed.values.config,
    noCache: parsed.values["no-cache"],
    cacheDir: parsed.values["cache-dir"],
  });
};

const parseCalibrateOptions = (argv: readonly string[]) => {
  const parsed = parseArgs({
    args: [...argv],
    options: {
      "feedback-path": { type: "string" },
      output: { type: "string" },
      config: { type: "string" },
      cwd: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printHelp();
    return null;
  }

  return parseCalibrateCommandOptions({
    feedbackPath: parsed.values["feedback-path"],
    output: parsed.values.output,
    configPath: parsed.values.config,
    cwd: parsed.values.cwd,
  });
};

const shouldPrintHelp = (command: string | undefined): boolean =>
  command === undefined || command === "--help" || command === "-h";

const shouldPrintVersion = (argv: readonly string[]): boolean =>
  argv.includes("--version") || argv.includes("-v");

const executeCommand = async (
  command: string,
  rest: readonly string[],
): Promise<void> => {
  if (command === "catch") {
    const options = parseCatchOptions(rest);

    if (options !== null) {
      await runCatchCommand(options);
    }

    return;
  }

  if (command === "calibrate") {
    const options = parseCalibrateOptions(rest);

    if (options !== null) {
      await runCalibrateCommand(options);
    }

    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

const runCli = async (argv: readonly string[]): Promise<void> => {
  const [command, ...rest] = argv;

  if (shouldPrintHelp(command)) {
    printHelp();
    return;
  }

  if (command === undefined) {
    return;
  }

  if (shouldPrintVersion(argv)) {
    printVersion();
    return;
  }

  await executeCommand(command, rest);
};

const main = async (): Promise<void> => {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected CLI failure";
    writeStderr(message);
    process.exitCode = 1;
  }
};

const isDirectExecution = (moduleUrl: string): boolean => {
  const [, entryPath] = process.argv;

  if (entryPath === undefined) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return pathToFileURL(entryPath).href === moduleUrl;
  }
};

if (isDirectExecution(import.meta.url)) {
  await main();
}

export { isDirectExecution, runCli };
