import type { JiTTestConfig } from "../config.js";
import { getFileAtCommit } from "../diff/extractor.js";
import type { DiffContext } from "../diff/types.js";
import { inferRisksPrompt } from "../prompts/templates.js";
import { inferRisksResponseSchema } from "../runtime-schemas.js";
import type { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";

import { generateRiskMutant } from "./mutant-generator.js";
import {
  computeInlineDiff,
  synthesizeMultipleTests,
} from "./test-synthesizer.js";
import type { GeneratedTest, InferredRisk } from "./types.js";

async function inferDiffRisks(
  diff: DiffContext,
  llm: LLMClient,
): Promise<readonly InferredRisk[]> {
  const prompt = inferRisksPrompt({
    prTitle: diff.pr.title,
    prBody: diff.pr.body,
    rawDiff: diff.rawDiff,
  });

  try {
    const response = await llm.completeJson(
      {
        prompt,
        systemPrompt:
          "You are a security-minded code reviewer identifying risks in code changes.",
      },
      inferRisksResponseSchema,
    );

    logger.info(
      `Inferred ${String(response.risks.length)} risks: ${response.intent}`,
    );
    return response.risks;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Risk inference failed: ${message}`);
    return [];
  }
}

function normalizeTargetSymbol(targetSymbol: string): string {
  const parts = targetSymbol.split(".");
  return parts.at(-1) ?? targetSymbol;
}

function matchesRiskTarget(
  filePath: string | null | undefined,
  risk: InferredRisk,
): boolean {
  if (risk.filePath) {
    return filePath === risk.filePath;
  }

  return true;
}

async function generateTestsForRisk(
  risk: InferredRisk,
  diff: DiffContext,
  repoRoot: string,
  llm: LLMClient,
  config: JiTTestConfig,
): Promise<GeneratedTest[]> {
  const normalizedTarget = normalizeTargetSymbol(risk.targetSymbol);
  const targetFile = diff.files.find((f) => {
    if (!matchesRiskTarget(f.path, risk)) {
      return false;
    }

    return (
      f.changedFunctions.some(
        (fn) =>
          fn.name === risk.targetSymbol ||
          fn.name === normalizedTarget ||
          fn.name.endsWith(`.${normalizedTarget}`),
      ) ||
      diff.changedSymbols.some(
        (symbol) =>
          symbol.filePath === f.path &&
          (symbol.name === risk.targetSymbol ||
            symbol.name === normalizedTarget),
      )
    );
  });

  if (!targetFile) {
    logger.warn(`No matching file found for risk target ${risk.targetSymbol}`);
    return [];
  }

  const changedFunction = targetFile.changedFunctions.find(
    (fn) =>
      fn.name === risk.targetSymbol ||
      fn.name === normalizedTarget ||
      fn.name.endsWith(`.${normalizedTarget}`),
  );

  const parentSource =
    (await getFileAtCommit(diff.pr.baseSha, targetFile.path, repoRoot)) ??
    (await getFileAtCommit(diff.pr.headSha, targetFile.path, repoRoot));
  if (!parentSource) {
    return [];
  }

  const mutant = await generateRiskMutant(
    risk,
    parentSource,
    targetFile.path,
    llm,
  );
  if (!mutant) {
    return [];
  }

  logger.info(`Generating tests for risk: ${risk.description}`);

  const candidates = await synthesizeMultipleTests(
    {
      targetSource:
        changedFunction?.parentSource ||
        changedFunction?.childSource ||
        parentSource,
      targetPath: targetFile.path,
      fullFileSource: mutant.mutantCode,
      existingTests: null,
      targetBehavior: {
        kind: "mutant",
        mutantDiff: computeInlineDiff(parentSource, mutant.mutantCode),
        mutantDescription: `[Risk: ${risk.description}]`,
      },
      projectContext: {
        availableImports: [],
        tsConfigPath: null,
        packageJsonPath: null,
      },
      targetSymbol: risk.targetSymbol,
      workflow: "intent-aware",
      candidateKey: `${targetFile.path}:${risk.targetSymbol}:${risk.id}`,
    },
    llm,
    config.testsPerFunction,
  );

  return candidates.map((candidate) => ({
    ...candidate,
    workflow: "intent-aware" as const,
    behaviorDescription: `[Risk: ${risk.description}] ${candidate.behaviorDescription}`,
  }));
}

async function intentAwareWorkflow(
  diff: DiffContext,
  repoRoot: string,
  llm: LLMClient,
  config: JiTTestConfig,
): Promise<GeneratedTest[]> {
  const risks = await inferDiffRisks(diff, llm);

  if (risks.length === 0) {
    logger.info("No risks inferred, skipping intent-aware workflow");
    return [];
  }

  const riskTestPromises = risks.map((risk) =>
    generateTestsForRisk(risk, diff, repoRoot, llm, config),
  );
  const riskTestResults = await Promise.all(riskTestPromises);
  const tests = riskTestResults.flat();

  logger.info(`Intent-aware workflow generated ${String(tests.length)} tests`);
  return tests;
}

export { inferDiffRisks, intentAwareWorkflow };
