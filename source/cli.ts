#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { runCatchCommand } from "./commands/catch.js";
import { parseCatchCommandOptions } from "./config.js";
import { cliVersion } from "./version.js";

const helpText = `Usage
  jittest <command> [options]

Commands
  catch    Generate catching tests for the current diff

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
  --include <glob>         Changed file glob to include
  --exclude <glob>         Changed file glob to exclude
  --timeout <ms>           Per-test timeout
  --output <format>        console | json | github-comment
  --report-threshold <n>   Minimum score to report
  --feedback-path <path>   JSONL file for assessor feedback records
  --context-file <path>    Extra local context file for intent analysis
  --pr-title <text>        Pull request title for intent-aware analysis
  --pr-body <text>         Pull request body for intent-aware analysis
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
      include: { type: "string", multiple: true },
      exclude: { type: "string", multiple: true },
      timeout: { type: "string" },
      output: { type: "string" },
      "report-threshold": { type: "string" },
      "feedback-path": { type: "string" },
      "context-file": { type: "string", multiple: true },
      "pr-title": { type: "string" },
      "pr-body": { type: "string" },
      cwd: { type: "string" },
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
    include: parsed.values.include,
    exclude: parsed.values.exclude,
    timeout: parsed.values.timeout,
    output: parsed.values.output,
    reportThreshold: parsed.values["report-threshold"],
    feedbackPath: parsed.values["feedback-path"],
    contextFiles: parsed.values["context-file"],
    prTitle: parsed.values["pr-title"],
    prBody: parsed.values["pr-body"],
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

  return pathToFileURL(entryPath).href === moduleUrl;
};

if (isDirectExecution(import.meta.url)) {
  await main();
}

export { runCli };
