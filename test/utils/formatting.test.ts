import { describe, expect, it } from "vitest";

import { formatValue } from "../../source/utils/formatting.js";

describe("formatValue", () => {
  it("returns empty string for undefined", () => {
    expect(formatValue(undefined)).toBe("");
  });

  it("returns string values directly", () => {
    expect(formatValue("hello")).toBe("hello");
  });

  it("JSON-serializes non-string values", () => {
    expect(formatValue(42)).toBe("42");
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});
