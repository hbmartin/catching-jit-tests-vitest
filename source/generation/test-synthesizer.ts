import { createHash } from "node:crypto";
import path from "node:path";
import { killMutantPrompt } from "../prompts/templates.js";
import { generatedTestSchema } from "../runtime-schemas.js";
import {
  isLLMBudgetExhaustedError,
  type LLMClient,
} from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";

import type { GeneratedTest, TestSynthesisRequest } from "./types.js";

const MAX_LCS_MATRIX_CELLS = 200_000;

function shouldUseBoundedInlineDiff(
  parentLineCount: number,
  childLineCount: number,
): boolean {
  return (parentLineCount + 1) * (childLineCount + 1) > MAX_LCS_MATRIX_CELLS;
}

function computeBoundedInlineDiff(
  parentLines: readonly string[],
  childLines: readonly string[],
): string {
  let prefixLength = 0;
  while (
    prefixLength < parentLines.length &&
    prefixLength < childLines.length &&
    parentLines[prefixLength] === childLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let parentSuffixStart = parentLines.length;
  let childSuffixStart = childLines.length;
  while (
    parentSuffixStart > prefixLength &&
    childSuffixStart > prefixLength &&
    parentLines[parentSuffixStart - 1] === childLines[childSuffixStart - 1]
  ) {
    parentSuffixStart -= 1;
    childSuffixStart -= 1;
  }

  return [
    ...parentLines.slice(0, prefixLength).map((line) => ` ${line}`),
    ...parentLines
      .slice(prefixLength, parentSuffixStart)
      .map((line) => `-${line}`),
    ...childLines
      .slice(prefixLength, childSuffixStart)
      .map((line) => `+${line}`),
    ...parentLines.slice(parentSuffixStart).map((line) => ` ${line}`),
  ].join("\n");
}

function computeInlineDiff(parent: string, child: string): string {
  const parentLines = parent.split("\n");
  const childLines = child.split("\n");

  // Avoid O(n*m) allocations when full-file sources get large.
  if (shouldUseBoundedInlineDiff(parentLines.length, childLines.length)) {
    return computeBoundedInlineDiff(parentLines, childLines);
  }

  const lcs: number[][] = Array.from({ length: parentLines.length + 1 }, () =>
    Array.from({ length: childLines.length + 1 }, () => 0),
  );

  for (let i = parentLines.length - 1; i >= 0; i -= 1) {
    for (let j = childLines.length - 1; j >= 0; j -= 1) {
      const row = lcs[i] ?? [];

      if (parentLines[i] === childLines[j]) {
        row[j] = (lcs[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
      }

      lcs[i] = row;
    }
  }

  const diffLines: string[] = [];
  let i = 0;
  let j = 0;

  while (i < parentLines.length && j < childLines.length) {
    const parentLine = parentLines[i];
    const childLine = childLines[j];

    if (parentLine === childLine) {
      diffLines.push(` ${parentLine}`);
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      diffLines.push(`-${parentLine}`);
      i += 1;
    } else {
      diffLines.push(`+${childLine}`);
      j += 1;
    }
  }

  while (i < parentLines.length) {
    diffLines.push(`-${parentLines[i]}`);
    i += 1;
  }

  while (j < childLines.length) {
    diffLines.push(`+${childLines[j]}`);
    j += 1;
  }

  return diffLines.join("\n");
}

const tsCodeBlockPattern = /```typescript\n([\s\S]*?)```/;
const genericCodeBlockPattern = /```\n([\s\S]*?)```/;

function extractCodeBlock(response: string): string {
  const tsMatch = tsCodeBlockPattern.exec(response);
  if (tsMatch?.[1]) {
    return tsMatch[1].trim();
  }

  const genericMatch = genericCodeBlockPattern.exec(response);
  if (genericMatch?.[1]) {
    return genericMatch[1].trim();
  }

  return response.trim();
}

function deriveTestFilePath(targetPath: string, candidateKey: string): string {
  const { dir, name } = path.parse(targetPath);
  return path.join(dir, `${name}.${candidateKey}.jittest.test.ts`);
}

function deriveImportPath(targetPath: string): string {
  const extension = path.extname(targetPath);
  return `./${path.basename(targetPath, extension)}.js`;
}

function createCandidateKey(rawKey: string): string {
  return createHash("sha1").update(rawKey).digest("hex").slice(0, 8);
}

async function synthesizeTest(
  request: TestSynthesisRequest,
  llm: LLMClient,
): Promise<GeneratedTest | null> {
  const { targetBehavior } = request;

  let prompt: string;
  let behaviorDescription: string;

  if (targetBehavior.kind === "mutant") {
    prompt = killMutantPrompt({
      parentSource: request.targetSource,
      mutantSource: request.fullFileSource,
      mutantDiff: targetBehavior.mutantDiff,
      importPath: deriveImportPath(request.targetPath),
      existingTests: request.existingTests,
      availableImports: request.projectContext.availableImports,
      tsConfigPath: request.projectContext.tsConfigPath,
      packageJsonPath: request.projectContext.packageJsonPath,
    });
    behaviorDescription = targetBehavior.mutantDescription;
  } else {
    prompt = killMutantPrompt({
      parentSource: request.targetSource,
      mutantSource: request.fullFileSource,
      mutantDiff: targetBehavior.prDiff,
      importPath: deriveImportPath(request.targetPath),
      existingTests: request.existingTests,
      availableImports: request.projectContext.availableImports,
      tsConfigPath: request.projectContext.tsConfigPath,
      packageJsonPath: request.projectContext.packageJsonPath,
    });
    behaviorDescription = targetBehavior.riskDescription;
  }

  try {
    const response = await llm.complete({
      prompt,
      systemPrompt:
        "You are an expert test engineer. Generate focused, minimal Vitest test cases that target specific behavioral differences.",
      temperature: 0.3,
    });

    const code = extractCodeBlock(response.content);

    if (code.length === 0) {
      logger.warn("Empty test code generated");
      return null;
    }

    return generatedTestSchema.parse({
      code,
      targetSymbol: request.targetSymbol,
      testFilePath: deriveTestFilePath(
        request.targetPath,
        createCandidateKey(request.candidateKey),
      ),
      behaviorDescription,
      workflow: request.workflow,
      generatorConfidence: 0.7,
    });
  } catch (err) {
    if (isLLMBudgetExhaustedError(err)) {
      logger.warn("Test synthesis skipped: LLM budget exhausted");
      return null;
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Test synthesis failed: ${message}`);
    return null;
  }
}

async function synthesizeMultipleTests(
  request: TestSynthesisRequest,
  llm: LLMClient,
  count: number,
): Promise<GeneratedTest[]> {
  const results: GeneratedTest[] = [];

  for (let i = 0; i < count; i += 1) {
    if (llm.isBudgetExhausted()) {
      logger.warn("Skipping remaining test synthesis: LLM budget exhausted");
      break;
    }

    const test = await synthesizeTest(
      {
        ...request,
        candidateKey: `${request.candidateKey}:${String(i)}`,
      },
      llm,
    );
    if (test) {
      results.push(test);
    }
  }

  return results;
}

export {
  computeInlineDiff,
  deriveTestFilePath,
  extractCodeBlock,
  shouldUseBoundedInlineDiff,
  synthesizeMultipleTests,
  synthesizeTest,
};
