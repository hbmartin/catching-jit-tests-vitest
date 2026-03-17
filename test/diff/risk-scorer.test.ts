import { describe, expect, it } from "vitest";

import {
  computeRiskFactors,
  computeRiskScore,
} from "../../source/diff/risk-scorer.js";
import type { DiffContext } from "../../source/diff/types.js";

function makeDiffContext(overrides: Partial<DiffContext> = {}): DiffContext {
  return {
    rawDiff: "",
    pr: {
      title: "Test PR",
      body: "",
      branch: "feature",
      baseSha: "abc123",
      headSha: "def456",
    },
    files: [],
    riskScore: 0,
    changedSymbols: [],
    ...overrides,
  };
}

describe("computeRiskFactors", () => {
  it("returns zero scores for empty diff", () => {
    const diff = makeDiffContext();
    const factors = computeRiskFactors(diff);
    expect(factors.sensitivityScore).toBe(0);
    expect(factors.complexityScore).toBe(0);
    expect(factors.coverageGap).toBe(0);
    expect(factors.defectHistory).toBe(0);
  });

  it("detects high sensitivity for auth-related files", () => {
    const diff = makeDiffContext({
      rawDiff: "auth token validation",
      files: [
        {
          path: "source/auth/login.ts",
          hunks: [],
          existingTestFile: null,
          changedExports: [],
          changedFunctions: [],
          touchesAuth: true,
          touchesPayments: false,
          touchesDataModel: false,
          touchesAccessControl: false,
        },
      ],
    });
    const factors = computeRiskFactors(diff);
    expect(factors.sensitivityScore).toBeGreaterThanOrEqual(0.9);
  });

  it("detects high sensitivity for payment-related files", () => {
    const diff = makeDiffContext({
      rawDiff: "payment billing",
      files: [
        {
          path: "source/billing/charge.ts",
          hunks: [],
          existingTestFile: null,
          changedExports: [],
          changedFunctions: [],
          touchesAuth: false,
          touchesPayments: true,
          touchesDataModel: false,
          touchesAccessControl: false,
        },
      ],
    });
    const factors = computeRiskFactors(diff);
    expect(factors.sensitivityScore).toBeGreaterThanOrEqual(0.95);
  });

  it("computes coverage gap from files without tests", () => {
    const diff = makeDiffContext({
      files: [
        {
          path: "source/a.ts",
          hunks: [],
          existingTestFile: null,
          changedExports: [],
          changedFunctions: [],
          touchesAuth: false,
          touchesPayments: false,
          touchesDataModel: false,
          touchesAccessControl: false,
        },
        {
          path: "source/b.ts",
          hunks: [],
          existingTestFile: "test/b.test.ts",
          changedExports: [],
          changedFunctions: [],
          touchesAuth: false,
          touchesPayments: false,
          touchesDataModel: false,
          touchesAccessControl: false,
        },
      ],
    });
    const factors = computeRiskFactors(diff);
    expect(factors.coverageGap).toBe(0.5);
  });
});

describe("computeRiskScore", () => {
  it("returns zero for empty diff", () => {
    const diff = makeDiffContext();
    const score = computeRiskScore(diff);
    expect(score).toBe(0);
  });

  it("returns a value between 0 and 1", () => {
    const diff = makeDiffContext({
      rawDiff: "auth login payment\n+function foo() {}\n+function bar() {}",
      files: [
        {
          path: "source/auth.ts",
          hunks: [
            {
              header: "@@ -1,3 +1,5 @@",
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 5,
              content: "",
            },
          ],
          existingTestFile: null,
          changedExports: [],
          changedFunctions: [],
          touchesAuth: true,
          touchesPayments: false,
          touchesDataModel: false,
          touchesAccessControl: false,
        },
      ],
    });
    const score = computeRiskScore(diff);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
