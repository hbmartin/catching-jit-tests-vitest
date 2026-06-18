import { describe, expect, it } from "vitest";

import { chunk, mapConcurrent } from "../../source/utils/concurrency.js";

describe("chunk", () => {
  it("splits array into chunks of given size", () => {
    const result = chunk([1, 2, 3, 4, 5], 2);
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("handles empty array", () => {
    const result = chunk([], 3);
    expect(result).toEqual([]);
  });

  it("handles chunk size larger than array", () => {
    const result = chunk([1, 2], 5);
    expect(result).toEqual([[1, 2]]);
  });

  it("handles chunk size of 1", () => {
    const result = chunk([1, 2, 3], 1);
    expect(result).toEqual([[1], [2], [3]]);
  });

  it("throws for non-positive chunk sizes", () => {
    expect(() => chunk([1, 2, 3], 0)).toThrow("positive integer");
  });
});

describe("mapConcurrent", () => {
  it("processes items with given concurrency", async () => {
    const items = [1, 2, 3, 4];
    const results = await mapConcurrent(items, 2, async (x) => x * 2);
    expect(results).toEqual([2, 4, 6, 8]);
  });

  it("handles empty array", async () => {
    const results = await mapConcurrent([], 5, async (x: number) => x);
    expect(results).toEqual([]);
  });

  it("preserves input order even when later items resolve first", async () => {
    const items = [30, 10, 20];
    const results = await mapConcurrent(items, 3, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay;
    });
    // Resolution order is 10, 20, 30, but output order matches input.
    expect(results).toEqual([30, 10, 20]);
  });
});
