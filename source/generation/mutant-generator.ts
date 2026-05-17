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
  const fileName = "mutant.ts";
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const compilerOptions: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  host.getSourceFile = (requestedFileName) =>
    requestedFileName === fileName ? parsed : undefined;
  host.fileExists = (requestedFileName) => requestedFileName === fileName;
  host.readFile = (requestedFileName) =>
    requestedFileName === fileName ? source : undefined;

  const program = ts.createProgram([fileName], compilerOptions, host);
  const diagnostics = program.getSyntacticDiagnostics(parsed);
  return diagnostics.length === 0 && parsed.statements.length > 0;
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
