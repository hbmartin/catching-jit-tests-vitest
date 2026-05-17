import { describe, expect, it } from "vitest";

import { looksLikeSourceCode } from "../../source/generation/mutant-generator.js";

describe("looksLikeSourceCode", () => {
  it("accepts valid source text", () => {
    expect(
      looksLikeSourceCode("const answer = ({ value }: Box) => ({ value });"),
    ).toBe(true);
  });

  it("rejects malformed source text with syntax diagnostics", () => {
    expect(looksLikeSourceCode("const answer = ;")).toBe(false);
  });

  it("rejects empty source text", () => {
    expect(looksLikeSourceCode("")).toBe(false);
  });

  it("rejects whitespace-only source text", () => {
    expect(looksLikeSourceCode("   \n\t  ")).toBe(false);
  });
});
