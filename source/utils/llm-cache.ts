import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "./logger.js";

interface CachedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd?: number;
  readonly costKnown: boolean;
}

interface CachedLLMResult {
  readonly text: string;
  readonly output: unknown;
  readonly usage: CachedUsage;
}

interface LLMCache {
  get: (key: string) => Promise<CachedLLMResult | undefined>;
  set: (key: string, value: CachedLLMResult) => Promise<void>;
}

interface CacheKeyInput {
  readonly model: string;
  readonly prompt: string;
  readonly system?: string;
  readonly maxTokens: number;
  readonly temperature: number;
  // "text" | "json" | "object" — distinguishes plain completions, freeform
  // JSON, and schema-bound JSON so they never collide on an identical prompt.
  readonly outputKind: string;
  readonly schemaFingerprint?: string;
}

// Content-addressed key over everything that can change the response. A change
// to the prompt, model, decoding params, output mode, or JSON schema produces a
// different key, so stale entries are never served.
function computeCacheKey(input: CacheKeyInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        system: input.system ?? "",
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        outputKind: input.outputKind,
        schemaFingerprint: input.schemaFingerprint ?? "",
      }),
    )
    .digest("hex");
}

function isCachedLLMResult(value: unknown): value is CachedLLMResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    // biome-ignore lint/complexity/useLiteralKeys: index signature access
    typeof record["text"] === "string" && typeof record["usage"] === "object"
  );
}

// Disk-backed cache: one JSON file per key under `cacheDir`. Reads and writes
// fail soft — a corrupt or unwritable entry degrades to a normal LLM call
// rather than aborting the run.
class DiskLLMCache implements LLMCache {
  private readonly cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  private entryPath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }

  async get(key: string): Promise<CachedLLMResult | undefined> {
    try {
      const raw = await readFile(this.entryPath(key), "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (isCachedLLMResult(parsed)) {
        return parsed;
      }
    } catch {
      // A missing or unreadable entry is a normal cache miss.
    }
    // biome-ignore lint/complexity/noUselessUndefined: explicit return satisfies TS noImplicitReturns
    return undefined;
  }

  async set(key: string, value: CachedLLMResult): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(this.entryPath(key), JSON.stringify(value), "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      logger.debug(`Failed to write LLM cache entry: ${message}`);
    }
  }
}

export type { CachedLLMResult, CachedUsage, CacheKeyInput, LLMCache };
export { computeCacheKey, DiskLLMCache };
