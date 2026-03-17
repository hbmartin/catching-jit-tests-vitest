import { describe, expect, it } from "vitest";

import { evaluateRubFake } from "../../source/assessors/rubfake.js";
import type { RuleContext } from "../../source/assessors/types.js";

function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    weakCatch: {
      test: {
        code: "test code",
        targetSymbol: "foo",
        testFilePath: "test/foo.test.ts",
        behaviorDescription: "tests foo",
        workflow: "dodgy-diff",
        generatorConfidence: 0.8,
      },
      parentResult: {
        testFile: "test/foo.test.ts",
        testName: "test",
        status: "passed",
        failureMessage: "",
        duration: 100,
        failureAnalysis: null,
      },
      childResult: {
        testFile: "test/foo.test.ts",
        testName: "test",
        status: "failed",
        failureMessage: "Expected true, Received false",
        duration: 100,
        failureAnalysis: {
          assertionType: "toBe",
          expected: "true",
          actual: "false",
          stackTrace: "",
          isRuntimeError: false,
          errorClass: null,
        },
      },
      behaviorChange: {
        summary: "Boolean flipped",
        parentBehavior: "true",
        childBehavior: "false",
        changeType: "boolean-flipped",
      },
    },
    diff: {
      rawDiff: "",
      pr: { title: "", body: "", branch: "", baseSha: "", headSha: "" },
      files: [],
      riskScore: 0,
      changedSymbols: [],
    },
    executionLog: "",
    testCode: "test code",
    ...overrides,
  };
}

describe("evaluateRubFake", () => {
  it("detects mock failures as false positives", () => {
    const ctx = makeContext({
      executionLog: "Cannot spy the doSomething property because it is not a function",
    });

    const result = evaluateRubFake(ctx);
    expect(result.score).toBeLessThan(0);
    expect(result.detectedPatterns.some((p) => p.name === "broken_mock")).toBe(true);
  });

  it("detects infrastructure failures as false positives", () => {
    const ctx = makeContext({
      executionLog: "ECONNREFUSED 127.0.0.1:3000",
    });

    const result = evaluateRubFake(ctx);
    expect(result.score).toBeLessThan(0);
    expect(result.detectedPatterns.some((p) => p.name === "infrastructure_failure")).toBe(true);
  });

  it("detects heavy mocking as false positive signal", () => {
    const ctx = makeContext({
      testCode: `
        vi.mock('./a');
        vi.mock('./b');
        vi.spyOn(obj, 'method1');
        vi.spyOn(obj, 'method2');
        vi.fn();
        vi.fn();
      `,
    });

    const result = evaluateRubFake(ctx);
    expect(result.detectedPatterns.some((p) => p.name === "broken_mock")).toBe(true);
  });

  it("detects boolean flip as true positive", () => {
    const ctx = makeContext();

    const result = evaluateRubFake(ctx);
    expect(result.detectedPatterns.some((p) => p.name === "changed_bool")).toBe(true);
    expect(result.detectedPatterns.some((p) => p.direction === "true-positive")).toBe(true);
  });

  it("detects refactor intent with behavior change as true positive", () => {
    const ctx = makeContext({
      diff: {
        rawDiff: "",
        pr: { title: "Refactor user service", body: "Clean up code", branch: "", baseSha: "", headSha: "" },
        files: [],
        riskScore: 0,
        changedSymbols: [],
      },
    });

    const result = evaluateRubFake(ctx);
    expect(result.detectedPatterns.some((p) => p.name === "refactor_intent")).toBe(true);
  });

  it("returns neutral score when no patterns match", () => {
    const ctx = makeContext({
      weakCatch: {
        ...makeContext().weakCatch,
        behaviorChange: {
          summary: "Some change",
          parentBehavior: "A",
          childBehavior: "B",
          changeType: "other",
        },
      },
    });

    const result = evaluateRubFake(ctx);
    expect(result.detectedPatterns).toHaveLength(0);
    expect(result.score).toBe(0);
  });
});
