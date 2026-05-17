import ts from "typescript";
import { generateMutantPrompt } from "../prompts/templates.js";
import type { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";
import { extractCodeBlock } from "./test-synthesizer.js";

import type { InferredRisk, MutantCandidate } from "./types.js";

function normalizeTargetSymbol(targetSymbol: string): string {
  const parts = targetSymbol.split(".");
  return parts.at(-1) ?? targetSymbol;
}

function looksLikeSourceCode(source: string): boolean {
  const parsed = ts.createSourceFile(
    "mutant.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const { parseDiagnostics } = parsed as ts.SourceFile & {
    readonly parseDiagnostics: readonly ts.DiagnosticWithLocation[];
  };
  return parseDiagnostics.length === 0 && parsed.statements.length > 0;
}

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

    const targetSymbol = normalizeTargetSymbol(risk.targetSymbol);
    if (
      mutantCode.length === 0 ||
      mutantCode === parentSource ||
      !looksLikeSourceCode(mutantCode) ||
      !mutantCode.includes(targetSymbol)
    ) {
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

export { generateRiskMutant, looksLikeSourceCode };
