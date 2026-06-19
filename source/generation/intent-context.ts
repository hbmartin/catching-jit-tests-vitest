import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { logger } from "../utils/logger.js";
import { isPathInside } from "../utils/path.js";

const maxContextFileBytes = 12_000;

interface IntentContextOptions {
  readonly optionalContextFiles?: readonly string[];
}

function truncateContext(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= maxContextFileBytes) {
    return value;
  }

  let bytes = 0;
  let endIndex = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxContextFileBytes) {
      break;
    }
    bytes += charBytes;
    endIndex += char.length;
  }

  return `${value.slice(0, endIndex)}\n...[truncated]`;
}

async function loadIntentContext(
  repoRoot: string,
  contextFiles: readonly string[],
  options: IntentContextOptions = {},
): Promise<string> {
  const sections: string[] = [];
  const resolvedRoot = path.resolve(repoRoot);
  let realRoot: string;
  try {
    realRoot = await realpath(resolvedRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to resolve intent context root ${repoRoot}: ${message}`,
    );
    return "";
  }

  const entries = [
    ...contextFiles.map((contextFile) => ({
      contextFile,
      optional: false,
    })),
    ...(options.optionalContextFiles ?? []).map((contextFile) => ({
      contextFile,
      optional: true,
    })),
  ];
  const seen = new Set<string>();

  for (const { contextFile, optional } of entries) {
    if (!seen.has(contextFile)) {
      seen.add(contextFile);

      const resolvedPath = path.resolve(resolvedRoot, contextFile);
      if (isPathInside(resolvedRoot, resolvedPath)) {
        try {
          const realResolvedPath = await realpath(resolvedPath);
          if (isPathInside(realRoot, realResolvedPath)) {
            const content = await readFile(realResolvedPath, "utf-8");
            sections.push(
              `### ${contextFile}\n${truncateContext(content.trim())}`,
            );
          } else {
            logger.warn(
              `Skipping out-of-repo intent context file: ${contextFile}`,
            );
          }
        } catch (error) {
          if (!optional) {
            const message =
              error instanceof Error ? error.message : String(error);
            logger.warn(
              `Failed to read intent context file ${contextFile}: ${message}`,
            );
          }
        }
      } else if (!optional) {
        logger.warn(`Skipping out-of-repo intent context file: ${contextFile}`);
      }
    }
  }

  return sections.join("\n\n");
}

export type { IntentContextOptions };
export { loadIntentContext, maxContextFileBytes, truncateContext };
