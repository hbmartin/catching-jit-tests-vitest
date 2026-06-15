import type { JiTTestConfig } from "../config.js";
import type { DiffContext } from "../diff/types.js";
import type { LLMClient } from "../utils/llm-client.js";
import { logger } from "../utils/logger.js";

import { resolveProjectContext } from "./context.js";
import {
  computeInlineDiff,
  synthesizeMultipleTests,
} from "./test-synthesizer.js";
import type { GeneratedTest } from "./types.js";

async function dodgyDiffWorkflow(
  diff: DiffContext,
  repoRoot: string,
  llm: LLMClient,
  config: JiTTestConfig,
): Promise<GeneratedTest[]> {
  const tests: GeneratedTest[] = [];

  for (const file of diff.files) {
    if (llm.isBudgetExhausted()) {
      logger.warn(
        "Skipping remaining dodgy-diff generation: LLM budget exhausted",
      );
      break;
    }

    const { existingTests, projectContext } = await resolveProjectContext(
      repoRoot,
      diff,
      file,
    );

    for (const fn of file.changedFunctions) {
      if (llm.isBudgetExhausted()) {
        logger.warn(
          "Skipping remaining dodgy-diff functions: LLM budget exhausted",
        );
        break;
      }

      logger.info(`Generating dodgy-diff tests for ${fn.name} in ${file.path}`);

      const candidates = await synthesizeMultipleTests(
        {
          targetSource: fn.parentSource || fn.childSource,
          targetPath: file.path,
          fullFileSource: fn.childFileSource,
          existingTests,
          targetBehavior: {
            kind: "mutant",
            mutantDiff: computeInlineDiff(fn.parentSource, fn.childSource),
            mutantDescription: `Change in ${fn.name}: ${fn.signature}`,
          },
          projectContext,
          targetSymbol: fn.name,
          workflow: "dodgy-diff",
          candidateKey: `${file.path}:${fn.name}:${fn.signature}`,
        },
        llm,
        config.testsPerFunction,
      );

      const taggedCandidates = candidates.map((c) => ({
        ...c,
        workflow: "dodgy-diff" as const,
      }));

      tests.push(...taggedCandidates);
    }
  }

  logger.info(`Dodgy-diff workflow generated ${String(tests.length)} tests`);
  return tests;
}

export { dodgyDiffWorkflow };
