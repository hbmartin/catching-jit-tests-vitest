import path from "node:path";
import { killMutantPrompt } from "../prompts/templates.js";
import type { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";

import type { GeneratedTest, TestSynthesisRequest } from "./types.js";

function computeInlineDiff(parent: string, child: string): string {
  const parentLines = parent.split("\n");
  const childLines = child.split("\n");
  const diffLines: string[] = [];

  const maxLen = Math.max(parentLines.length, childLines.length);
  for (let i = 0; i < maxLen; i += 1) {
    const pLine = parentLines[i];
    const cLine = childLines[i];

    if (pLine === undefined) {
      diffLines.push(`+${cLine}`);
    } else if (cLine === undefined) {
      diffLines.push(`-${pLine}`);
    } else if (pLine === cLine) {
      diffLines.push(` ${pLine}`);
    } else {
      diffLines.push(`-${pLine}`);
      diffLines.push(`+${cLine}`);
    }
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

function deriveTestFilePath(targetPath: string): string {
  const { dir, name } = path.parse(targetPath);
  return path.join(dir, `${name}.jittest.test.ts`);
}

function deriveImportPath(targetPath: string): string {
  return `./${path.basename(targetPath, ".ts")}.js`;
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
    });
    behaviorDescription = targetBehavior.mutantDescription;
  } else {
    prompt = killMutantPrompt({
      parentSource: request.targetSource,
      mutantSource: request.fullFileSource,
      mutantDiff: targetBehavior.prDiff,
      importPath: deriveImportPath(request.targetPath),
      existingTests: request.existingTests,
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

    return {
      code,
      targetSymbol: "",
      testFilePath: deriveTestFilePath(request.targetPath),
      behaviorDescription,
      workflow: "dodgy-diff",
      generatorConfidence: 0.7,
    };
  } catch (err) {
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
    const test = await synthesizeTest(
      {
        ...request,
        targetBehavior: request.targetBehavior,
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
  synthesizeMultipleTests,
  synthesizeTest,
};
