import type { AssessmentRecord } from "../assessors/types.js";

import type { BehaviorReport, RunStats } from "./types.js";

interface CatchResultSummary {
  baseRef: string;
  headRef: string;
  workflow: string;
  riskThreshold: number;
  eligibleForGeneration: boolean;
  fileCount: number;
  riskScore: number;
  riskReasons: readonly string[];
  totalTestsGenerated?: number;
  weakCatchCount?: number;
  hardeningCandidateCount?: number;
  reportsGenerated?: number;
  duration?: string;
  estimatedCost?: number;
  llmUsage?: RunStats["llmUsage"];
  statusMessage?: string;
  reports?: readonly BehaviorReport[];
}

const renderReasons = (reasons: readonly string[]): string =>
  reasons.length === 0
    ? "- none"
    : reasons.map((reason) => `- ${reason}`).join("\n");

export const formatCatchResult = (summary: CatchResultSummary): string => {
  const lines = [
    "JiTTest catch analysis",
    "",
    `Base: ${summary.baseRef}`,
    `Head: ${summary.headRef}`,
    `Workflow: ${summary.workflow}`,
    `Files analyzed: ${summary.fileCount}`,
    `Risk score: ${summary.riskScore.toFixed(2)}`,
    `Risk threshold: ${summary.riskThreshold.toFixed(2)}`,
    `Eligible for generation: ${summary.eligibleForGeneration ? "yes" : "no"}`,
  ];

  if (summary.totalTestsGenerated !== undefined) {
    lines.push(`Tests generated: ${String(summary.totalTestsGenerated)}`);
  }

  if (summary.weakCatchCount !== undefined) {
    lines.push(`Weak catches: ${String(summary.weakCatchCount)}`);
  }

  if (summary.hardeningCandidateCount !== undefined) {
    lines.push(
      `Hardening candidates: ${String(summary.hardeningCandidateCount)}`,
    );
  }

  if (summary.reportsGenerated !== undefined) {
    lines.push(`Reports generated: ${String(summary.reportsGenerated)}`);
  }

  if (summary.duration !== undefined) {
    lines.push(`Duration: ${summary.duration}`);
  }

  if (summary.estimatedCost !== undefined) {
    lines.push(`Cost: $${summary.estimatedCost.toFixed(4)}`);
  }

  if (summary.llmUsage?.budget.status === "exhausted") {
    const reason = summary.llmUsage.budget.exhaustedReason ?? "tokens";
    lines.push(
      `LLM budget: exhausted (${reason}); skipped ${String(
        summary.llmUsage.budget.skippedCalls,
      )} future calls`,
    );
  }

  if (summary.llmUsage && !summary.llmUsage.budget.dollarBudgetEnforced) {
    lines.push("OpenRouter cost: unverified for at least one LLM call");
  }

  if (summary.statusMessage !== undefined) {
    lines.push("", `Status: ${summary.statusMessage}`);
  }

  lines.push("", "Reasons:", renderReasons(summary.riskReasons));

  if (summary.reports !== undefined) {
    lines.push("", "Reports:");
    lines.push(
      summary.reports.length === 0
        ? "- none"
        : summary.reports
            .map(
              (report, index) => `${index + 1}. ${report.headline}
   ${report.senseCheck}`,
            )
            .join("\n\n"),
    );
  }

  return `${lines.join("\n")}\n`;
};

export const formatAssessmentRecords = (
  records: readonly AssessmentRecord[],
): string => {
  if (records.length === 0) {
    return "No assessments found.";
  }

  return records
    .map(
      (
        { weakCatch, assessment },
        index,
      ) => `${index + 1}. ${weakCatch.behaviorChange.summary}
   verdict: ${assessment.verdict}
   score: ${assessment.combinedScore.toFixed(2)}
   report: ${assessment.shouldReport ? "yes" : "no"}`,
    )
    .join("\n");
};

export const formatBehaviorReports = (
  reports: readonly BehaviorReport[],
): string => {
  if (reports.length === 0) {
    return "No engineer-facing reports met the threshold.";
  }

  return reports
    .map(
      (report, index) => `### ${index + 1}. ${report.headline}

${report.senseCheck}

Before: ${report.details.behaviorChange.parentBehavior}
After: ${report.details.behaviorChange.childBehavior}
Verdict: ${report.details.verdict}
Dismissal estimate: ${report.details.dismissalEstimate}`,
    )
    .join("\n\n");
};
