import { describe, expect, it } from "vitest";

import {
  computeInlineDiff,
  shouldUseBoundedInlineDiff,
} from "../../source/generation/test-synthesizer.js";

describe("shouldUseBoundedInlineDiff", () => {
  it("switches to the bounded diff path for large inputs", () => {
    expect(shouldUseBoundedInlineDiff(500, 500)).toBe(true);
    expect(shouldUseBoundedInlineDiff(20, 20)).toBe(false);
  });
});

describe("computeInlineDiff", () => {
  it("preserves shared prefix and suffix when diffing large files", () => {
    const prefix = Array.from({ length: 250 }, (_, index) => `start-${index}`);
    const suffix = Array.from({ length: 250 }, (_, index) => `end-${index}`);
    const parent = [...prefix, "old-value", ...suffix].join("\n");
    const child = [...prefix, "new-value", ...suffix].join("\n");

    const diff = computeInlineDiff(parent, child);

    expect(diff).toContain(" start-0");
    expect(diff).toContain("-old-value");
    expect(diff).toContain("+new-value");
    expect(diff).toContain(" end-249");
  });
});
