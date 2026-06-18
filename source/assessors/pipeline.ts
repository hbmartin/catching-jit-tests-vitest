import type { AssessorsConfig, JiTTestConfig } from "../config.js";
import type { DiffContext } from "../diff/types.js";
import type { WeakCatch } from "../harvest/types.js";
import { aggregatedAssessmentSchema } from "../runtime-schemas.js";
import type { LLMClient } from "../utils/llm-client.js";

import { ensembleJudge } from "./llm-judge.js";
import { evaluateRubFake } from "./rubfake.js";
import type { AggregatedAssessment, Assessment, RuleContext } from "./types.js";

function deriveInferredIntent(weakCatch: WeakCatch, diff: DiffContext): string {
  const inferredIntent = weakCatch.test.inferredIntent?.trim();
  if (inferredIntent && inferredIntent.length > 0) {
    return inferredIntent;
  }

  const prIntent = [diff.pr.title.trim(), diff.pr.body.trim()]
    .filter((value) => value.length > 0)
    .join("\n");

  return prIntent.length > 0
    ? prIntent
    : "No inferred diff intent was available for this change.";
}

function scoreToVerdict(
  score: number,
  thresholds: AssessorsConfig["verdictThresholds"],
): AggregatedAssessment["verdict"] {
  if (score >= thresholds.strongCatch) {
    return "strong-catch";
  }
  if (score >= thresholds.likelyStrong) {
    return "likely-strong";
  }
  if (score >= thresholds.uncertain) {
    return "uncertain";
  }
  if (score >= thresholds.likelyFalsePositive) {
    return "likely-false-positive";
  }
  return "false-positive";
}

// Combine the rule-based and LLM scores. A strong, high-confidence
// false-positive signal from RubFake short-circuits the weighted average so a
// confident "this test is broken" verdict is not diluted by the judge.
function combineAssessmentScores(
  rubfakeResult: Assessment | null,
  llmEnsembleResult: Assessment | null,
  assessors: AssessorsConfig,
): number {
  if (rubfakeResult && llmEnsembleResult) {
    const hasHighConfidenceFP = rubfakeResult.detectedPatterns.some(
      (p) => p.confidence === "high" && p.direction === "false-positive",
    );
    if (
      rubfakeResult.score <= assessors.rubfakeOverrideScore &&
      hasHighConfidenceFP
    ) {
      return rubfakeResult.score;
    }
    // Clamp: configurable weights need not sum to 1, but combinedScore must
    // stay within [-1, 1] to satisfy aggregatedAssessmentSchema.
    return Math.max(
      -1,
      Math.min(
        1,
        rubfakeResult.score * assessors.rubfakeWeight +
          llmEnsembleResult.score * assessors.llmWeight,
      ),
    );
  }
  if (rubfakeResult) {
    return rubfakeResult.score;
  }
  if (llmEnsembleResult) {
    return llmEnsembleResult.score;
  }
  return 0;
}

function estimateDismissalDifficulty(
  weakCatch: WeakCatch,
): AggregatedAssessment["dismissalDifficulty"] {
  const { changeType } = weakCatch.behaviorChange;

  if (changeType === "boolean-flipped") {
    return "trivial";
  }
  if (changeType === "null-introduced") {
    return "easy";
  }
  if (changeType === "return-value-changed") {
    return "easy";
  }
  if (
    changeType === "exception-introduced" ||
    changeType === "exception-removed"
  ) {
    return "moderate";
  }
  if (
    changeType === "output-shape-changed" ||
    changeType === "ordering-changed"
  ) {
    return "hard";
  }

  return "moderate";
}

async function assessWeakCatch(
  weakCatch: WeakCatch,
  diff: DiffContext,
  executionLog: string,
  llm: LLMClient,
  config: JiTTestConfig,
): Promise<AggregatedAssessment> {
  const ctx: RuleContext = {
    weakCatch,
    diff,
    executionLog,
    testCode: weakCatch.test.code,
  };

  const assessments: Assessment[] = [];

  const rubfakeResult = config.rubfakeEnabled ? evaluateRubFake(ctx) : null;
  if (rubfakeResult) {
    assessments.push(rubfakeResult);
  }

  let llmEnsembleResult: Assessment | null = null;
  if (config.llmJudgeEnabled && !llm.isBudgetExhausted()) {
    llmEnsembleResult = await ensembleJudge(
      {
        testCode: weakCatch.test.code,
        failureMessage: weakCatch.childResult.failureMessage,
        executionLog,
        stackTrace: weakCatch.childResult.failureAnalysis?.stackTrace ?? "",
        diff: diff.rawDiff,
        inferredIntent: deriveInferredIntent(weakCatch, diff),
        behaviorChange: weakCatch.behaviorChange,
      },
      llm,
      config,
    );
    assessments.push(llmEnsembleResult);
  }

  const { assessors } = config;
  const combinedScore = combineAssessmentScores(
    rubfakeResult,
    llmEnsembleResult,
    assessors,
  );

  const dismissalDifficulty = estimateDismissalDifficulty(weakCatch);
  const verdict = scoreToVerdict(combinedScore, assessors.verdictThresholds);

  const reportThreshold = Math.max(
    config.reportThreshold,
    assessors.dismissalThresholds[dismissalDifficulty],
  );

  return aggregatedAssessmentSchema.parse({
    assessments,
    combinedScore,
    verdict,
    shouldReport: combinedScore >= reportThreshold,
    dismissalDifficulty,
  });
}

export {
  assessWeakCatch,
  combineAssessmentScores,
  estimateDismissalDifficulty,
  scoreToVerdict,
};
