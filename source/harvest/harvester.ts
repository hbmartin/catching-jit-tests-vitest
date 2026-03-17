import type { DualExecutionResult } from "../execution/types.js";
import { weakCatchSchema } from "../runtime-schemas.js";

import type { BehaviorChange, WeakCatch } from "./types.js";

function isBooleanPair(
  expected: string | null,
  actual: string | null,
): boolean {
  if (!(expected && actual)) {
    return false;
  }
  const booleans = new Set(["true", "false"]);
  return booleans.has(expected) && booleans.has(actual) && expected !== actual;
}

function describeBehaviorChange(result: DualExecutionResult): BehaviorChange {
  const { childOutcome } = result;
  const failure = childOutcome.failureAnalysis;

  if (!failure) {
    return {
      summary: "Test behavior changed between parent and child",
      parentBehavior: "Test passed",
      childBehavior: "Test failed",
      changeType: "other",
    };
  }

  if (failure.isRuntimeError && failure.errorClass === "TypeError") {
    const hasNullish =
      childOutcome.failureMessage.includes("null") ||
      childOutcome.failureMessage.includes("undefined");
    if (hasNullish) {
      return {
        summary: `A value that was previously defined is now ${failure.actual ?? "null/undefined"}`,
        parentBehavior: "Expression evaluated to a non-null value",
        childBehavior: `Expression evaluates to ${failure.actual ?? "null/undefined"}, causing ${failure.errorClass}`,
        changeType: "null-introduced",
      };
    }
  }

  if (
    failure.assertionType === "toBe" &&
    isBooleanPair(failure.expected, failure.actual)
  ) {
    return {
      summary: `Boolean result flipped from ${failure.expected ?? "unknown"} to ${failure.actual ?? "unknown"}`,
      parentBehavior: `Returns ${failure.expected ?? "unknown"}`,
      childBehavior: `Returns ${failure.actual ?? "unknown"}`,
      changeType: "boolean-flipped",
    };
  }

  if (failure.isRuntimeError) {
    return {
      summary: "Code that previously succeeded now throws an error",
      parentBehavior: "No exception thrown",
      childBehavior: `Throws: ${childOutcome.failureMessage.slice(0, 200)}`,
      changeType: "exception-introduced",
    };
  }

  if (failure.assertionType === "toThrow") {
    return {
      summary: "Exception behavior changed",
      parentBehavior: "Expected exception behavior",
      childBehavior: `Exception behavior differs: ${childOutcome.failureMessage.slice(0, 200)}`,
      changeType: "exception-removed",
    };
  }

  if (
    failure.assertionType === "toEqual" &&
    failure.expected &&
    failure.actual
  ) {
    return {
      summary: `Return value changed from ${failure.expected} to ${failure.actual}`,
      parentBehavior: `Produces: ${failure.expected}`,
      childBehavior: `Produces: ${failure.actual}`,
      changeType: "return-value-changed",
    };
  }

  return {
    summary: `Behavioral difference detected: ${childOutcome.failureMessage.slice(0, 150)}`,
    parentBehavior: "Test passed",
    childBehavior: `Test failed: ${childOutcome.failureMessage.slice(0, 200)}`,
    changeType: "other",
  };
}

function harvestWeakCatches(
  results: readonly DualExecutionResult[],
): WeakCatch[] {
  return results
    .filter(
      (r) =>
        r.parentOutcome.status === "passed" &&
        r.childOutcome.status === "failed",
    )
    .map((r) =>
      weakCatchSchema.parse({
        test: r.test,
        parentResult: r.parentOutcome,
        childResult: r.childOutcome,
        behaviorChange: describeBehaviorChange(r),
        executionLog: r.childExecutionLog ?? r.childOutcome.failureMessage,
      }),
    );
}

export { describeBehaviorChange, harvestWeakCatches, isBooleanPair };
