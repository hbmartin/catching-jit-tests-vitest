import { describe, expect, it } from "vitest";

import { looksLikeSourceCode } from "../../source/generation/mutant-generator.js";

describe("looksLikeSourceCode", () => {
  it("accepts valid source text", () => {
    expect(
      looksLikeSourceCode("const answer = ({ value }: Box) => ({ value });"),
    ).toBe(true);
  });

  it("rejects malformed source text with parse diagnostics", () => {
    expect(looksLikeSourceCode("const answer = ;")).toBe(false);
  });
});
