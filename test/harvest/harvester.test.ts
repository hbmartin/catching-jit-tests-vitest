import { describe, expect, it } from "vitest";
import type { DualExecutionResult } from "../../source/execution/types.js";
import {
  describeBehaviorChange,
  harvestHardeningCandidates,
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

describe("harvestHardeningCandidates", () => {
  it("identifies generated tests that pass on parent and child", () => {
    const results = [
      makeDualResult("passed", "failed"),
      makeDualResult("passed", "passed"),
      makeDualResult("failed", "failed"),
      makeDualResult("passed", "passed"),
    ];

    const candidates = harvestHardeningCandidates(results);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.test.testFilePath).toBe("test/foo.test.ts");
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

  it("detects nullish runtime regressions from the failure message", () => {
    const result: DualExecutionResult = {
      ...makeDualResult("passed", "failed"),
      childOutcome: {
        testFile: "test/foo.test.ts",
        testName: "foo test",
        status: "failed",
        failureMessage:
          "TypeError: Cannot read properties of undefined (reading 'name')",
        duration: 100,
        failureAnalysis: {
          assertionType: "other",
          expected: null,
          actual: null,
          stackTrace: "",
          isRuntimeError: true,
          errorClass: "TypeError",
        },
      },
    };

    const change = describeBehaviorChange(result);
    expect(change.changeType).toBe("null-introduced");
  });

  it("classifies typed runtime exceptions as introduced exceptions", () => {
    const result: DualExecutionResult = {
      ...makeDualResult("passed", "failed"),
      childOutcome: {
        testFile: "test/foo.test.ts",
        testName: "foo test",
        status: "failed",
        failureMessage: "ReferenceError: missingValue is not defined",
        duration: 100,
        failureAnalysis: {
          assertionType: "other",
          expected: null,
          actual: null,
          stackTrace: "",
          isRuntimeError: true,
          errorClass: "ReferenceError",
        },
      },
    };

    const change = describeBehaviorChange(result);
    expect(change.changeType).toBe("exception-introduced");
  });

  it("keeps assertion failures on assertion-specific branches", () => {
    const result: DualExecutionResult = {
      ...makeDualResult("passed", "failed"),
      childOutcome: {
        testFile: "test/foo.test.ts",
        testName: "foo test",
        status: "failed",
        failureMessage: "AssertionError: expected 1 to deeply equal 2",
        duration: 100,
        failureAnalysis: {
          assertionType: "toEqual",
          expected: "1",
          actual: "2",
          stackTrace: "",
          isRuntimeError: true,
          errorClass: "AssertionError",
        },
      },
    };

    const change = describeBehaviorChange(result);
    expect(change.changeType).toBe("return-value-changed");
  });
});
