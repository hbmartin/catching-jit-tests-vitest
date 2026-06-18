import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type CachedLLMResult,
  computeCacheKey,
  DiskLLMCache,
} from "../../source/utils/llm-cache.js";

const baseKeyInput = {
  model: "openai/gpt-4.1",
  prompt: "Say hello",
  system: "Be terse",
  maxTokens: 100,
  temperature: 0,
  outputKind: "text",
};

describe("computeCacheKey", () => {
  it("is stable for identical inputs", () => {
    expect(computeCacheKey(baseKeyInput)).toBe(computeCacheKey(baseKeyInput));
  });

  it("changes when any cache-relevant field changes", () => {
    const base = computeCacheKey(baseKeyInput);
    expect(computeCacheKey({ ...baseKeyInput, prompt: "Say bye" })).not.toBe(
      base,
    );
    expect(computeCacheKey({ ...baseKeyInput, model: "other" })).not.toBe(base);
    expect(computeCacheKey({ ...baseKeyInput, temperature: 0.5 })).not.toBe(
      base,
    );
    expect(computeCacheKey({ ...baseKeyInput, outputKind: "object" })).not.toBe(
      base,
    );
    expect(
      computeCacheKey({ ...baseKeyInput, schemaFingerprint: "{...}" }),
    ).not.toBe(base);
    expect(
      computeCacheKey({
        ...baseKeyInput,
        providerOptions: '{"openrouter":{"reasoning":{"effort":"high"}}}',
      }),
    ).not.toBe(base);
  });
});

describe("DiskLLMCache", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jittest-cache-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const entry: CachedLLMResult = {
    text: "hello world",
    output: { ok: true },
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd: 0.002,
      costKnown: true,
    },
  };

  it("round-trips a stored entry", async () => {
    const cache = new DiskLLMCache(path.join(dir, "nested"));
    await cache.set("key-1", entry);
    expect(await cache.get("key-1")).toEqual(entry);
  });

  it("returns undefined for an unknown key", async () => {
    const cache = new DiskLLMCache(dir);
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("ignores entries whose shape is not a cached result", async () => {
    const cache = new DiskLLMCache(dir);
    writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ nope: true }));
    expect(await cache.get("bad")).toBeUndefined();
  });

  it("fails soft when the cache directory cannot be created", async () => {
    // Point the cache at a path that is a file, so mkdir fails.
    const filePath = path.join(dir, "not-a-dir");
    writeFileSync(filePath, "x");
    const cache = new DiskLLMCache(filePath);

    await expect(cache.set("k", entry)).resolves.toBeUndefined();
    expect(await cache.get("k")).toBeUndefined();
  });
});
