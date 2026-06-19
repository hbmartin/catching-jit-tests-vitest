import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FormatCommandOptions, OutputFormat } from "../config.js";
import { formatPRComment } from "../reporting/github-comment.js";
import { formatGithubStepSummary } from "../reporting/github-step-summary.js";
import {
  formatJsonReport,
  type JsonReport,
  jsonReportSchema,
} from "../reporting/json-report.js";

import { writeOutputFile } from "./report-utils.js";

const writeStdout = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

async function loadJsonReport(
  cwd: string,
  inputPath: string,
): Promise<JsonReport> {
  const raw = await readFile(path.resolve(cwd, inputPath), "utf-8");
  return jsonReportSchema.parse(JSON.parse(raw));
}

function renderReport(report: JsonReport, format: OutputFormat): string {
  if (format === "json") {
    return formatJsonReport(
      report.reports,
      report.stats,
      report.statusMessage,
      report.hardeningCandidates,
    );
  }

  if (format === "github-comment") {
    return formatPRComment(report.reports, report.stats, report.statusMessage);
  }

  if (format === "github-step-summary") {
    return formatGithubStepSummary(
      report.reports,
      report.stats,
      report.statusMessage,
    );
  }

  throw new Error(`Cannot render saved report as ${format}`);
}

async function runFormatCommand(options: FormatCommandOptions): Promise<void> {
  const report = await loadJsonReport(options.cwd, options.input);
  const rendered = renderReport(report, options.output);

  if (options.outFile !== undefined) {
    await writeOutputFile(options.cwd, options.outFile, rendered);
    return;
  }

  if (rendered.length > 0) {
    writeStdout(rendered);
  }
}

export { loadJsonReport, renderReport, runFormatCommand };
