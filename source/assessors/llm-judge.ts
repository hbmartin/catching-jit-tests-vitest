import type { JiTTestConfig } from "../config.js";
import { judgeCatchPrompt } from "../prompts/templates.js";
import { judgeOutputSchema } from "../runtime-schemas.js";
import type { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";

import type { Assessment, JudgeInput, JudgeOutput } from "./types.js";

async function singleModelJudge(
  input: JudgeInput,
  llm: LLMClient,
): Promise<JudgeOutput> {
  const prompt = judgeCatchPrompt({
    diff: input.diff,
    inferredIntent: input.inferredIntent,
    testCode: input.testCode,
    failureMessage: input.failureMessage,
    executionLog: input.executionLog,
    stackTrace: input.stackTrace,
    parentBehavior: input.behaviorChange.parentBehavior,
    childBehavior: input.behaviorChange.childBehavior,
    changeType: input.behaviorChange.changeType,
  });

  try {
    return await llm.completeJson<JudgeOutput>(
      {
        prompt,
        systemPrompt:
          "You are an expert code reviewer. Classify test failures as expected or unexpected bugs.",
      },
      judgeOutputSchema,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`LLM judge failed: ${message}`);
    return {
      unexpectedLikelihood: "medium",
      explanation:
        "LLM judge failed to produce a result; treating this judge as neutral",
    };
  }
}

// Scores center ambiguous judge output at zero so median aggregation is neutral.
const likelihoodValues: Record<JudgeOutput["unexpectedLikelihood"], number> = {
  high: 1.0,
  medium: 0.0,
  low: -1.0,
};

function computeJudgmentScore(judgment: JudgeOutput): number {
  return likelihoodValues[judgment.unexpectedLikelihood];
}

function computeMedianScore(scores: readonly number[]): number {
  if (scores.length === 0) {
    return 0;
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  const lower = sorted[middle - 1] ?? 0;
  const upper = sorted[middle] ?? 0;
  return (lower + upper) / 2;
}

async function ensembleJudge(
  input: JudgeInput,
  llm: LLMClient,
  config: JiTTestConfig,
): Promise<Assessment> {
  const models =
    config.judgeModels.length > 0 ? config.judgeModels : [config.llm.model];
  const judgments = await Promise.all(
    models.map(async (model) => ({
      model,
      judgment: await singleModelJudge(input, llm.withModel(model)),
    })),
  );

  const scores = judgments.map(({ judgment }) =>
    computeJudgmentScore(judgment),
  );
  const medianScore = computeMedianScore(scores);

  return {
    score: medianScore,
    rationale: judgments
      .map(
        ({ model, judgment }) =>
          `[${model}] ${judgment.unexpectedLikelihood.toUpperCase()} unexpected likelihood: ${judgment.explanation}`,
      )
      .join("\n"),
    detectedPatterns: [],
    assessor: "llm-ensemble",
  };
}

export { ensembleJudge, singleModelJudge };
