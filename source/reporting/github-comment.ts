import type { BehaviorReport, RunStats } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatBlockquote(value: string): string {
  return escapeHtml(value)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatLlmStatus(
  stats: RunStats | null,
  statusMessage?: string,
): string {
  const lines: string[] = [];

  if (statusMessage !== undefined) {
    lines.push(escapeHtml(statusMessage));
  }

  if (stats?.llmUsage.budget.status === "exhausted") {
    const reason = stats.llmUsage.budget.exhaustedReason ?? "tokens";
    lines.push(
      `LLM budget exhausted (${reason}); skipped ${String(
        stats.llmUsage.budget.skippedCalls,
      )} future LLM calls.`,
    );
  }

  if (stats !== null && !stats.llmUsage.budget.dollarBudgetEnforced) {
    lines.push(
      "OpenRouter cost metadata was missing for at least one LLM call; dollar enforcement is unverified.",
    );
  }

  return lines.length === 0 ? "" : ` ${lines.join(" ")}`;
}

function formatPRComment(
  reports: readonly BehaviorReport[],
  stats: RunStats | null,
  statusMessage?: string,
): string {
  if (reports.length === 0) {
    const status = formatLlmStatus(stats, statusMessage).trim();
    if (status.length === 0) {
      return "";
    }

    return `## JiTTest: Status\n\n${status}\n`;
  }

  const footer =
    stats === null
      ? ""
      : `\n---\n<sub>Generated ${String(stats.totalTestsGenerated)} tests across ${String(stats.filesAnalyzed)} files in ${stats.duration}. ${String(stats.weakCatchCount)} weak catches found, ${String(stats.hardeningCandidateCount)} hardening candidates retained, ${String(reports.length)} passed assessment threshold.${formatLlmStatus(
          stats,
          statusMessage,
        )}</sub>\n`;

  return `## JiTTest: Behavior Change Detection

${String(reports.length)} potential regression${reports.length > 1 ? "s" : ""} detected. If these changes are intentional, no action is needed.

${reports
  .map(
    (report, i) => `### ${String(i + 1)}. ${escapeHtml(report.headline)}

${formatBlockquote(report.senseCheck)}

<details>
<summary>Details (estimated ${report.details.dismissalEstimate} to review)</summary>

**Before:** ${escapeHtml(report.details.behaviorChange.parentBehavior)}
**After:** ${escapeHtml(report.details.behaviorChange.childBehavior)}
**Confidence:** ${escapeHtml(report.details.verdict)}

**Assessment rationale:**
${report.details.assessorRationales.map((r) => `- ${escapeHtml(r)}`).join("\n")}

<details>
<summary>Generated test code</summary>

\`\`\`typescript
${report.details.testCode}
\`\`\`

</details>
</details>
`,
  )
  .join("\n---\n")}${footer}`;
}

export { formatPRComment };
