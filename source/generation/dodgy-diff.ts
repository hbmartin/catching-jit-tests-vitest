import type { JiTTestConfig } from "../config.js";
import type { DiffContext } from "../diff/types.js";
import type { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";

import {
  computeInlineDiff,
  synthesizeMultipleTests,
} from "./test-synthesizer.js";
import type { GeneratedTest } from "./types.js";

async function dodgyDiffWorkflow(
  diff: DiffContext,
  llm: LLMClient,
  config: JiTTestConfig,
): Promise<GeneratedTest[]> {
  const tests: GeneratedTest[] = [];

  for (const file of diff.files) {
    for (const fn of file.changedFunctions) {
      logger.info(`Generating dodgy-diff tests for ${fn.name} in ${file.path}`);

      const candidates = await synthesizeMultipleTests(
        {
          targetSource: fn.parentSource,
          targetPath: file.path,
          fullFileSource: fn.childSource,
          existingTests: null,
          targetBehavior: {
            kind: "mutant",
            mutantDiff: computeInlineDiff(fn.parentSource, fn.childSource),
            mutantDescription: `Change in ${fn.name}: ${fn.signature}`,
          },
          projectContext: {
            availableImports: [],
            tsConfigPath: null,
            packageJsonPath: null,
          },
        },
        llm,
        config.testsPerFunction,
      );

      const taggedCandidates = candidates.map((c) => ({
        ...c,
        workflow: "dodgy-diff" as const,
        targetSymbol: fn.name,
      }));

      tests.push(...taggedCandidates);
    }
  }

  logger.info(`Dodgy-diff workflow generated ${String(tests.length)} tests`);
  return tests;
}

export { dodgyDiffWorkflow };
