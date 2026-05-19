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
      executionLog:
        "Cannot spy the doSomething property because it is not a function",
    });

    const result = evaluateRubFake(ctx);
    expect(result.score).toBeLessThan(0);
    expect(result.detectedPatterns.some((p) => p.name === "broken_mock")).toBe(
      true,
    );
  });

  it("detects infrastructure failures as false positives", () => {
    const ctx = makeContext({
      executionLog: "ECONNREFUSED 127.0.0.1:3000",
    });

    const result = evaluateRubFake(ctx);
    expect(result.score).toBeLessThan(0);
    expect(
      result.detectedPatterns.some((p) => p.name === "infrastructure_failure"),
    ).toBe(true);
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
    expect(result.detectedPatterns.some((p) => p.name === "broken_mock")).toBe(
      true,
    );
  });

  it("detects boolean flip as true positive", () => {
    const ctx = makeContext();

    const result = evaluateRubFake(ctx);
    expect(result.detectedPatterns.some((p) => p.name === "changed_bool")).toBe(
      true,
    );
    expect(
      result.detectedPatterns.some((p) => p.direction === "true-positive"),
    ).toBe(true);
  });

  it("lowers boolean flip confidence when boolean logic changed directly", () => {
    const ctx = makeContext({
      diff: {
        ...makeContext().diff,
        rawDiff: "-return true;\n+return false;",
      },
    });

    const result = evaluateRubFake(ctx);
    expect(result.score).toBe(0.35);
    expect(result.rationale).toContain("directly changes boolean logic");
  });

  it("lowers boolean flip confidence for unspaced return comparisons", () => {
    const ctx = makeContext({
      diff: {
        ...makeContext().diff,
        rawDiff: "-return a>b;\n+return a<b;",
      },
    });

    const result = evaluateRubFake(ctx);

    expect(result.score).toBe(0.35);
    expect(result.rationale).toContain("directly changes boolean logic");
  });

  it("lowers boolean flip confidence for unspaced condition comparisons", () => {
    const ctx = makeContext({
      diff: {
        ...makeContext().diff,
        rawDiff: "-if(a>b) return value;\n+if(a<b) return value;",
      },
    });

    const result = evaluateRubFake(ctx);

    expect(result.score).toBe(0.35);
    expect(result.rationale).toContain("directly changes boolean logic");
  });

  it("lowers boolean flip confidence for nested unspaced condition comparisons", () => {
    const ctx = makeContext({
      diff: {
        ...makeContext().diff,
        rawDiff: "-if(foo(a)>b) return value;\n+if(foo(a)<b) return value;",
      },
    });

    const result = evaluateRubFake(ctx);

    expect(result.score).toBe(0.35);
    expect(result.rationale).toContain("directly changes boolean logic");
  });

  it("does not lower boolean flip confidence for bit-shift conditions", () => {
    const cases = [
      "-if(a<<b) return value;\n+if(a>>b) return value;",
      "-if(a<<=b) return value;\n+if(a>>=b) return value;",
      "-while(x<<2) run();\n+while(x>>2) run();",
      "-while(x<<=2) run();\n+while(x>>=2) run();",
      "-for(let i=0;i<<limit;i++) run();\n+for(let i=0;i>>limit;i++) run();",
      "-for(let i=0;i<<=limit;i++) run();\n+for(let i=0;i>>=limit;i++) run();",
    ];

    for (const rawDiff of cases) {
      const ctx = makeContext({
        diff: {
          ...makeContext().diff,
          rawDiff,
        },
      });

      const result = evaluateRubFake(ctx);

      expect(result.score).toBe(0.7);
      expect(result.rationale).not.toContain("directly changes boolean logic");
    }
  });

  it("lowers boolean flip confidence for less-or-greater-equal condition comparisons", () => {
    const cases = [
      "-if(a<=b) return value;\n+if(a>=b) return value;",
      "-while(x>=limit) run();\n+while(x<=limit) run();",
      "-for(let i=0;i<=limit;i++) run();\n+for(let i=0;i>=limit;i--) run();",
    ];

    for (const rawDiff of cases) {
      const ctx = makeContext({
        diff: {
          ...makeContext().diff,
          rawDiff,
        },
      });

      const result = evaluateRubFake(ctx);

      expect(result.score).toBe(0.35);
      expect(result.rationale).toContain("directly changes boolean logic");
    }
  });

  it("detects not implemented placeholders as false positives", () => {
    const ctx = makeContext({
      executionLog: "Error: not implemented",
    });

    const result = evaluateRubFake(ctx);
    expect(
      result.detectedPatterns.some(
        (pattern) => pattern.name === "not_implemented_exception",
      ),
    ).toBe(true);
    expect(result.score).toBeLessThan(0);
  });

  it("detects malformed data providers as false positives", () => {
    const ctx = makeContext({
      testCode: "test.each(undefined)('case', () => {})",
      executionLog: "Invalid test cases from data provider",
    });

    const result = evaluateRubFake(ctx);
    expect(
      result.detectedPatterns.some(
        (pattern) => pattern.name === "data_provider_broken",
      ),
    ).toBe(true);
    expect(result.score).toBeLessThan(0);
  });

  it("does not treat normal parameterized tests as broken data providers", () => {
    const ctx = makeContext({
      testCode: "test.each([[1], [2]])('case %#', () => {})",
      executionLog: "Expected: true\nReceived: false",
    });

    const result = evaluateRubFake(ctx);

    expect(
      result.detectedPatterns.some(
        (pattern) => pattern.name === "data_provider_broken",
      ),
    ).toBe(false);
  });

  it("detects undefined variables as false positives", () => {
    const ctx = makeContext({
      executionLog:
        "ReferenceError: missingValue is not defined\n    at test/foo.test.ts:1:1",
    });

    const result = evaluateRubFake(ctx);
    expect(
      result.detectedPatterns.some(
        (pattern) => pattern.name === "undefined_variable",
      ),
    ).toBe(true);
    expect(result.score).toBeLessThan(0);
  });

  it("does not blame production ReferenceErrors on generated tests", () => {
    const ctx = makeContext({
      executionLog:
        "ReferenceError: missingValue is not defined\n    at source/foo.ts:1:1",
    });

    const result = evaluateRubFake(ctx);

    expect(
      result.detectedPatterns.some(
        (pattern) => pattern.name === "undefined_variable",
      ),
    ).toBe(false);
  });

  it("does not treat generic constructor mentions as creation failures", () => {
    const ctx = makeContext({
      weakCatch: {
        ...makeContext().weakCatch,
        behaviorChange: {
          summary: "Other behavior changed",
          parentBehavior: "A",
          childBehavior: "B",
          changeType: "other",
        },
      },
      executionLog: "expected constructor metadata to be preserved",
    });

    const result = evaluateRubFake(ctx);

    expect(
      result.detectedPatterns.some(
        (pattern) => pattern.name === "create_failure",
      ),
    ).toBe(false);
  });

  it("does not lower boolean confidence for generic type syntax", () => {
    const ctx = makeContext({
      diff: {
        ...makeContext().diff,
        rawDiff: "+type Box<T> = { value: T };",
      },
    });

    const result = evaluateRubFake(ctx);

    expect(result.score).toBe(0.7);
    expect(result.rationale).not.toContain("directly changes boolean logic");
  });

  it("detects refactor intent with behavior change as true positive", () => {
    const ctx = makeContext({
      diff: {
        rawDiff: "",
        pr: {
          title: "Refactor user service",
          body: "Clean up code",
          branch: "",
          baseSha: "",
          headSha: "",
        },
        files: [],
        riskScore: 0,
        changedSymbols: [],
      },
    });

    const result = evaluateRubFake(ctx);
    expect(
      result.detectedPatterns.some((p) => p.name === "refactor_intent"),
    ).toBe(true);
  });

  it("detects dead-code removal with behavior change as true positive", () => {
    const ctx = makeContext({
      diff: {
        ...makeContext().diff,
        pr: {
          ...makeContext().diff.pr,
          title: "Remove unused auth branch",
        },
      },
    });

    const result = evaluateRubFake(ctx);
    expect(
      result.detectedPatterns.some((p) => p.name === "dead_code_removal"),
    ).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("detects RBAC-sensitive behavior changes", () => {
    const ctx = makeContext({
      diff: {
        ...makeContext().diff,
        rawDiff: "+checkPermission(role)",
        files: [
          {
            path: "source/rbac.ts",
            hunks: [],
            existingTestFile: null,
            changedExports: [],
            changedFunctions: [],
            touchesAuth: false,
            touchesPayments: false,
            touchesDataModel: false,
            touchesAccessControl: true,
          },
        ],
      },
      executionLog: "expected role admin to be allowed",
    });

    const result = evaluateRubFake(ctx);
    expect(result.detectedPatterns.some((p) => p.name === "rbac")).toBe(true);
    expect(result.score).toBeGreaterThan(0);
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
