import type { BehaviorReport, RunStats } from "./types.js";

function formatPRComment(
  reports: readonly BehaviorReport[],
  stats: RunStats,
): string {
  if (reports.length === 0) {
    return "";
  }

  const sections = reports
    .map(
      (report, i) => `### ${String(i + 1)}. ${report.headline}

> ${report.senseCheck}

<details>
<summary>Details (estimated ${report.details.dismissalEstimate} to review)</summary>

**Before:** ${report.details.behaviorChange.parentBehavior}
**After:** ${report.details.behaviorChange.childBehavior}
**Confidence:** ${report.details.verdict}

**Assessment rationale:**
${report.details.assessorRationales.map((r) => `- ${r}`).join("\n")}

<details>
<summary>Generated test code</summary>

\`\`\`typescript
${report.details.testCode}
\`\`\`

</details>
</details>
`,
    )
    .join("\n---\n");

  return `## JiTTest: Behavior Change Detection

${String(reports.length)} potential regression${reports.length > 1 ? "s" : ""} detected. If these changes are intentional, no action is needed.

${sections}

---
<sub>Generated ${String(stats.totalTestsGenerated)} tests across ${String(stats.filesAnalyzed)} files in ${stats.duration}. ${String(stats.weakCatchCount)} weak catches found, ${String(reports.length)} passed assessment threshold.</sub>
`;
}

export { formatPRComment };
