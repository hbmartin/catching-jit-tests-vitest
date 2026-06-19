import type { BehaviorReport, RunStats } from "./types.js";

function escapeMarkdownCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", "<br>")
    .replaceAll("\n", "<br>")
    .replaceAll("\r", "<br>");
}

function formatMetricLine(stats: RunStats | null): string {
  if (stats === null) {
    return "";
  }

  const parts = [
    `files: ${String(stats.filesAnalyzed)}`,
    `tests: ${String(stats.totalTestsGenerated)}`,
    `weak catches: ${String(stats.weakCatchCount)}`,
    `reports: ${String(stats.reportsGenerated)}`,
    `duration: ${stats.duration}`,
    `cost: $${stats.estimatedCost.toFixed(4)}`,
  ];

  return `${parts.join(" | ")}\n\n`;
}

function formatBudgetStatus(stats: RunStats | null): string {
  if (stats?.llmUsage.budget.status !== "exhausted") {
    return "";
  }

  const reason = stats.llmUsage.budget.exhaustedReason ?? "tokens";
  return `\n\n> LLM budget exhausted (${reason}); skipped ${String(
    stats.llmUsage.budget.skippedCalls,
  )} future LLM calls.`;
}

function formatGithubStepSummary(
  reports: readonly BehaviorReport[],
  stats: RunStats | null,
  statusMessage?: string,
): string {
  const lines = ["## JiTTest", "", formatMetricLine(stats).trimEnd()].filter(
    (line) => line.length > 0,
  );

  if (statusMessage !== undefined) {
    lines.push("", statusMessage);
  }

  if (reports.length === 0) {
    if (statusMessage === undefined) {
      lines.push("", "No reportable behavior changes.");
    }
    const budgetStatus = formatBudgetStatus(stats);
    return `${lines.join("\n")}${budgetStatus}\n`;
  }

  lines.push(
    "",
    `Detected ${String(reports.length)} potential regression${
      reports.length === 1 ? "" : "s"
    }.`,
    "",
    "| # | Verdict | Summary | Sense check |",
    "| --- | --- | --- | --- |",
  );

  reports.forEach((report, index) => {
    lines.push(
      `| ${String(index + 1)} | ${escapeMarkdownCell(
        report.details.verdict,
      )} | ${escapeMarkdownCell(report.headline)} | ${escapeMarkdownCell(
        report.senseCheck,
      )} |`,
    );
  });

  const budgetStatus = formatBudgetStatus(stats);
  return `${lines.join("\n")}${budgetStatus}\n`;
}

export { formatGithubStepSummary };
