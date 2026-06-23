#!/usr/bin/env node
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ParseArgsConfig, parseArgs } from "node:util";

import { runCalibrateCommand } from "./commands/calibrate.js";
import { runCatchCommand } from "./commands/catch.js";
import { runFormatCommand } from "./commands/format.js";
import { runTriageCommand } from "./commands/triage.js";
import {
  parseCalibrateCommandOptions,
  parseCatchCommandOptions,
  parseFormatCommandOptions,
  parseTriageCommandOptions,
} from "./config.js";
import { cliVersion } from "./version.js";

const helpText = `Usage
  jittest <command> [options]

Commands
  catch      Generate catching tests for the current diff
  format     Render a saved JSON report as Markdown
  calibrate  Analyze feedback records and recommend assessor weights
  triage     Label assessment feedback records

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
  --output <format>        console | json | github-comment | github-step-summary
  --fail-on <verdict>      Exit 2 when a report at this verdict or stronger is found
  --json-file <path>       Also write the JSON report to this file
  --summary-file <path>    Also write GitHub step-summary Markdown to this file
  --comment-file <path>    Also write GitHub PR-comment Markdown to this file
  --report-threshold <n>   Minimum score to report
  --feedback-path <path>   JSONL file for assessor feedback records
  --context-file <path>    Extra local context file for intent analysis
  --auto-context-file <p>  Optional repo guidance file to auto-load when present
  --no-auto-context        Disable auto-loading AGENTS/CLAUDE/CONTRIBUTING docs
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

format options
  jittest format <report.json> --output github-step-summary
  --input <path>           Saved JSON report (positional path also accepted)
  --output <format>        json | github-comment | github-step-summary
  --out <path>             Write rendered output to this file instead of stdout
  --cwd <path>             Repository root for relative paths (default: .)

triage options
  --feedback-path <path>   JSONL feedback records to update
  --id <record-id>         Limit to one feedback record
  --run-id <run-id>        Limit to one run's feedback records
  --label <label>          unknown | confirmed-true-positive | confirmed-false-positive | intended-change
  --notes <text>           Notes to store with the label
  --list                   List matching feedback records
  --interactive            Prompt for labels in a terminal
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

const stripStandaloneDoubleDash = (argv: readonly string[]): string[] =>
  argv.filter((arg) => arg !== "--");

// parseArgs only infers per-key value types from a literal options object, so a
// generic wrapper loses them. ParsedValues recovers that mapping from the
// caller's options type. The `multiple` check comes first so a repeatable flag
// always yields an array, including the `multiple: true` + boolean case
// (boolean[]); non-repeatable flags then resolve to boolean or string by type.
type ParsedOptionValue<C> = C extends { multiple: true }
  ? C extends { type: "boolean" }
    ? boolean[]
    : string[]
  : C extends { type: "boolean" }
    ? boolean
    : string;

type ParsedValues<O> = { [K in keyof O]?: ParsedOptionValue<O[K]> };

// Shared scaffolding for every `parseXOptions`: strip the standalone `--`, run
// parseArgs, and short-circuit to null when --help/-h is requested. The result
// is re-typed through ParsedValues because parseArgs cannot infer values from a
// generic options argument; that assertion is the single boundary where the
// loss is repaired.
const parseCommandArgs = <
  const O extends NonNullable<ParseArgsConfig["options"]>,
>(
  argv: readonly string[],
  options: O,
  allowPositionals: boolean,
): {
  readonly values: ParsedValues<O>;
  readonly positionals: readonly string[];
} | null => {
  const parsed = parseArgs({
    args: stripStandaloneDoubleDash(argv),
    options,
    allowPositionals,
  });

  // Every command declares a `help` boolean, but that is a soft convention
  // rather than something the generic signature can enforce; the optional cast
  // keeps this safe (absent -> undefined -> falsy) if a caller ever omits it.
  if ((parsed.values as { help?: boolean }).help) {
    printHelp();
    return null;
  }

  return parsed as unknown as {
    values: ParsedValues<O>;
    positionals: readonly string[];
  };
};

const parseCatchOptions = (argv: readonly string[]) => {
  const parsed = parseCommandArgs(
    argv,
    {
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
      "fail-on": { type: "string" },
      "json-file": { type: "string" },
      "summary-file": { type: "string" },
      "comment-file": { type: "string" },
      "report-threshold": { type: "string" },
      "feedback-path": { type: "string" },
      "context-file": { type: "string", multiple: true },
      "auto-context-file": { type: "string", multiple: true },
      "no-auto-context": { type: "boolean" },
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
    false,
  );

  if (parsed === null) {
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
    failOn: parsed.values["fail-on"],
    jsonFile: parsed.values["json-file"],
    summaryFile: parsed.values["summary-file"],
    commentFile: parsed.values["comment-file"],
    reportThreshold: parsed.values["report-threshold"],
    feedbackPath: parsed.values["feedback-path"],
    contextFiles: parsed.values["context-file"],
    autoContextFiles: parsed.values["auto-context-file"],
    noAutoContext: parsed.values["no-auto-context"],
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
  const parsed = parseCommandArgs(
    argv,
    {
      "feedback-path": { type: "string" },
      output: { type: "string" },
      config: { type: "string" },
      cwd: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    false,
  );

  if (parsed === null) {
    return null;
  }

  return parseCalibrateCommandOptions({
    feedbackPath: parsed.values["feedback-path"],
    output: parsed.values.output,
    configPath: parsed.values.config,
    cwd: parsed.values.cwd,
  });
};

const parseFormatOptions = (argv: readonly string[]) => {
  const parsed = parseCommandArgs(
    argv,
    {
      input: { type: "string" },
      output: { type: "string" },
      out: { type: "string" },
      cwd: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    true,
  );

  if (parsed === null) {
    return null;
  }

  return parseFormatCommandOptions({
    input: parsed.values.input ?? parsed.positionals[0],
    output: parsed.values.output,
    outFile: parsed.values.out,
    cwd: parsed.values.cwd,
  });
};

const parseTriageOptions = (argv: readonly string[]) => {
  const parsed = parseCommandArgs(
    argv,
    {
      "feedback-path": { type: "string" },
      id: { type: "string" },
      "run-id": { type: "string" },
      label: { type: "string" },
      notes: { type: "string" },
      list: { type: "boolean" },
      interactive: { type: "boolean" },
      config: { type: "string" },
      cwd: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    false,
  );

  if (parsed === null) {
    return null;
  }

  return parseTriageCommandOptions({
    feedbackPath: parsed.values["feedback-path"],
    id: parsed.values.id,
    runId: parsed.values["run-id"],
    label: parsed.values.label,
    notes: parsed.values.notes,
    list: parsed.values.list,
    interactive: parsed.values.interactive,
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

  if (command === "format") {
    const options = parseFormatOptions(rest);

    if (options !== null) {
      await runFormatCommand(options);
    }

    return;
  }

  if (command === "triage") {
    const options = parseTriageOptions(rest);

    if (options !== null) {
      await runTriageCommand(options);
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
