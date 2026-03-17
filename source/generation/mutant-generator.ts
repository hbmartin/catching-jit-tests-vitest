import { generateMutantPrompt } from "../prompts/templates.js";
import type { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";
import { extractCodeBlock } from "./test-synthesizer.js";

import type { InferredRisk, MutantCandidate } from "./types.js";

async function generateRiskMutant(
  risk: InferredRisk,
  parentSource: string,
  filePath: string,
  llm: LLMClient,
): Promise<MutantCandidate | null> {
  try {
    const prompt = generateMutantPrompt({
      parentSource,
      filePath,
      riskDescription: risk.description,
      mutantHint: risk.mutantHint ?? risk.description,
      targetSymbol: risk.targetSymbol,
    });

    const response = await llm.complete({
      prompt,
      systemPrompt:
        "You are generating code mutations that represent realistic bugs.",
      temperature: 0.2,
    });

    const mutantCode = extractCodeBlock(response.content);

    if (mutantCode.length === 0 || mutantCode === parentSource) {
      logger.warn(`No meaningful mutant generated for risk ${risk.id}`);
      return null;
    }

    return {
      risk,
      mutantCode,
      filePath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Mutant generation failed for risk ${risk.id}: ${message}`);
    return null;
  }
}

export { generateRiskMutant };
