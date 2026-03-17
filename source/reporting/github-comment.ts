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

function formatPRComment(
  reports: readonly BehaviorReport[],
  stats: RunStats | null,
  statusMessage?: string,
): string {
  if (reports.length === 0) {
    if (statusMessage === undefined) {
      return "";
    }

    return `## JiTTest: Status\n\n${escapeHtml(statusMessage)}\n`;
  }

  const footer =
    stats === null
      ? ""
      : `\n---\n<sub>Generated ${String(stats.totalTestsGenerated)} tests across ${String(stats.filesAnalyzed)} files in ${stats.duration}. ${String(stats.weakCatchCount)} weak catches found, ${String(reports.length)} passed assessment threshold.</sub>\n`;

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
