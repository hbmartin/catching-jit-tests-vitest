import type { JiTTestConfig } from "../config.js";
import { judgeCatchPrompt } from "../prompts/templates.js";
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
    parentBehavior: input.behaviorChange.parentBehavior,
    childBehavior: input.behaviorChange.childBehavior,
    changeType: input.behaviorChange.changeType,
  });

  try {
    return await llm.completeJson<JudgeOutput>({
      prompt,
      systemPrompt:
        "You are an expert code reviewer. Classify test failures as expected or unexpected bugs.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`LLM judge failed: ${message}`);
    return {
      isUnexpectedBug: false,
      confidence: "low",
      explanation: "LLM judge failed to produce a result",
    };
  }
}

const confidenceValues: Record<JudgeOutput["confidence"], number> = {
  high: 1.0,
  medium: 0.5,
  low: 0.2,
};

function computeJudgmentScore(judgment: JudgeOutput): number {
  const directionMultiplier = judgment.isUnexpectedBug ? 1 : -1;
  const confidenceValue = confidenceValues[judgment.confidence];
  return directionMultiplier * confidenceValue;
}

async function ensembleJudge(
  input: JudgeInput,
  llm: LLMClient,
  config: JiTTestConfig,
): Promise<Assessment> {
  const modelCount = config.judgeModels.length;
  const judgments: JudgeOutput[] = [];

  for (let i = 0; i < modelCount; i += 1) {
    const judgment = await singleModelJudge(input, llm);
    judgments.push(judgment);
  }

  const scores = judgments.map((j) => computeJudgmentScore(j));
  const sorted = [...scores].sort((a, b) => a - b);
  const medianScore = sorted[Math.floor(sorted.length / 2)] ?? 0;

  return {
    score: medianScore,
    rationale: judgments
      .map(
        (j, i) =>
          `[model-${String(i)}] ${j.isUnexpectedBug ? "BUG" : "INTENDED"} (${j.confidence}): ${j.explanation}`,
      )
      .join("\n"),
    detectedPatterns: [],
    assessor: "llm-ensemble",
  };
}

export { ensembleJudge, singleModelJudge };
