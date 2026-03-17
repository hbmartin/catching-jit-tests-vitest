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
  --timeout <ms>           Per-test timeout
  --output <format>        console | json | github-comment
  --report-threshold <n>   Minimum score to report
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
      timeout: { type: "string" },
      output: { type: "string" },
      "report-threshold": { type: "string" },
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
    timeout: parsed.values.timeout,
    output: parsed.values.output,
    reportThreshold: parsed.values["report-threshold"],
    prTitle: parsed.values["pr-title"],
    prBody: parsed.values["pr-body"],
    cwd: parsed.values.cwd,
  });
};

const shouldPrintHelp = (command: string | undefined): boolean =>
  command === undefined || command === "--help" || command === "-h";

const shouldPrintVersion = (command: string | undefined): boolean =>
  command === "--version" || command === "-v";

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

  if (shouldPrintVersion(command)) {
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
