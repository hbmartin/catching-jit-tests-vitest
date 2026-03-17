import { describe, expect, it } from "vitest";
import type { DualExecutionResult } from "../../source/execution/types.js";
import {
  describeBehaviorChange,
  harvestWeakCatches,
  isBooleanPair,
} from "../../source/harvest/harvester.js";

describe("isBooleanPair", () => {
  it("returns true for true/false pair", () => {
    expect(isBooleanPair("true", "false")).toBe(true);
  });

  it("returns true for false/true pair", () => {
    expect(isBooleanPair("false", "true")).toBe(true);
  });

  it("returns false for same values", () => {
    expect(isBooleanPair("true", "true")).toBe(false);
  });

  it("returns false for non-boolean values", () => {
    expect(isBooleanPair("hello", "world")).toBe(false);
  });

  it("returns false for null values", () => {
    expect(isBooleanPair(null, "true")).toBe(false);
    expect(isBooleanPair("true", null)).toBe(false);
  });
});

function makeDualResult(
  parentStatus: "passed" | "failed",
  childStatus: "passed" | "failed",
): DualExecutionResult {
  return {
    test: {
      code: "test code",
      targetSymbol: "foo",
      testFilePath: "test/foo.test.ts",
      behaviorDescription: "tests foo",
      workflow: "dodgy-diff",
      generatorConfidence: 0.8,
    },
    parentOutcome: {
      testFile: "test/foo.test.ts",
      testName: "foo test",
      status: parentStatus,
      failureMessage: parentStatus === "failed" ? "Parent failure" : "",
      duration: 100,
      failureAnalysis: null,
    },
    childOutcome: {
      testFile: "test/foo.test.ts",
      testName: "foo test",
      status: childStatus,
      failureMessage: childStatus === "failed" ? "Child failure" : "",
      duration: 100,
      failureAnalysis:
        childStatus === "failed"
          ? {
              assertionType: "toBe",
              expected: "true",
              actual: "false",
              stackTrace: "",
              isRuntimeError: false,
              errorClass: null,
            }
          : null,
    },
  };
}

describe("harvestWeakCatches", () => {
  it("identifies weak catches (pass parent, fail child)", () => {
    const results = [
      makeDualResult("passed", "failed"),
      makeDualResult("passed", "passed"),
      makeDualResult("failed", "failed"),
      makeDualResult("passed", "failed"),
    ];

    const catches = harvestWeakCatches(results);
    expect(catches).toHaveLength(2);
  });

  it("returns empty for no weak catches", () => {
    const results = [
      makeDualResult("passed", "passed"),
      makeDualResult("failed", "failed"),
    ];

    const catches = harvestWeakCatches(results);
    expect(catches).toHaveLength(0);
  });
});

describe("describeBehaviorChange", () => {
  it("identifies boolean flips", () => {
    const result = makeDualResult("passed", "failed");
    const change = describeBehaviorChange(result);
    expect(change.changeType).toBe("boolean-flipped");
    expect(change.summary).toContain("Boolean");
  });

  it("handles missing failure analysis", () => {
    const result: DualExecutionResult = {
      ...makeDualResult("passed", "failed"),
      childOutcome: {
        testFile: "test/foo.test.ts",
        testName: "foo test",
        status: "failed",
        failureMessage: "Unknown error",
        duration: 100,
        failureAnalysis: null,
      },
    };

    const change = describeBehaviorChange(result);
    expect(change.changeType).toBe("other");
    expect(change.summary).toBe(
      "Test behavior changed between parent and child",
    );
  });
});
