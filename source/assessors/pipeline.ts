import type { JiTTestConfig } from "../config.js";
import type { DiffContext } from "../diff/types.js";
import type { WeakCatch } from "../harvest/types.js";
import { aggregatedAssessmentSchema } from "../runtime-schemas.js";
import type { LLMClient } from "../utils/llm-client.js";

import { ensembleJudge } from "./llm-judge.js";
import { evaluateRubFake } from "./rubfake.js";
import type { AggregatedAssessment, Assessment, RuleContext } from "./types.js";

function scoreToVerdict(score: number): AggregatedAssessment["verdict"] {
  if (score >= 0.6) {
    return "strong-catch";
  }
  if (score >= 0.3) {
    return "likely-strong";
  }
  if (score >= -0.3) {
    return "uncertain";
  }
  if (score >= -0.6) {
    return "likely-false-positive";
  }
  return "false-positive";
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

  const rubfakeResult = evaluateRubFake(ctx);

  let llmEnsembleResult: Assessment = {
    score: 0,
    rationale: "LLM judge disabled",
    detectedPatterns: [],
    assessor: "llm-ensemble",
  };

  if (config.llmJudgeEnabled) {
    llmEnsembleResult = await ensembleJudge(
      {
        testCode: weakCatch.test.code,
        failureMessage: weakCatch.childResult.failureMessage,
        stackTrace: weakCatch.childResult.failureAnalysis?.stackTrace ?? "",
        diff: diff.rawDiff,
        inferredIntent: weakCatch.test.behaviorDescription,
        behaviorChange: weakCatch.behaviorChange,
      },
      llm,
      config,
    );
  }

  const assessments = [rubfakeResult, llmEnsembleResult];

  const rubfakeScore = rubfakeResult.score;
  const llmScore = llmEnsembleResult.score;

  let combinedScore: number;

  const hasHighConfidenceFP = rubfakeResult.detectedPatterns.some(
    (p) => p.confidence === "high" && p.direction === "false-positive",
  );

  if (rubfakeScore <= -0.8 && hasHighConfidenceFP) {
    combinedScore = rubfakeScore;
  } else {
    combinedScore = rubfakeScore * 0.4 + llmScore * 0.6;
  }

  const dismissalDifficulty = estimateDismissalDifficulty(weakCatch);
  const verdict = scoreToVerdict(combinedScore);

  const thresholdMap: Record<
    AggregatedAssessment["dismissalDifficulty"],
    number
  > = {
    trivial: -0.2,
    easy: 0.0,
    moderate: 0.3,
    hard: 0.5,
  };
  const reportThreshold = thresholdMap[dismissalDifficulty];

  return aggregatedAssessmentSchema.parse({
    assessments,
    combinedScore,
    verdict,
    shouldReport: combinedScore >= reportThreshold,
    dismissalDifficulty,
  });
}

export { assessWeakCatch, estimateDismissalDifficulty, scoreToVerdict };
