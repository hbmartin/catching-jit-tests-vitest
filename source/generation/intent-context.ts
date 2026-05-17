import { readFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "../utils/logger.js";

const maxContextFileBytes = 12_000;

function truncateContext(value: string): string {
  if (value.length <= maxContextFileBytes) {
    return value;
  }

  return `${value.slice(0, maxContextFileBytes)}\n...[truncated]`;
}

async function loadIntentContext(
  repoRoot: string,
  contextFiles: readonly string[],
): Promise<string> {
  const sections: string[] = [];

  for (const contextFile of contextFiles) {
    const resolvedPath = path.resolve(repoRoot, contextFile);
    try {
      const content = await readFile(resolvedPath, "utf-8");
      sections.push(`### ${contextFile}\n${truncateContext(content.trim())}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Failed to read intent context file ${contextFile}: ${message}`,
      );
    }
  }

  return sections.join("\n\n");
}

export { loadIntentContext, maxContextFileBytes, truncateContext };
