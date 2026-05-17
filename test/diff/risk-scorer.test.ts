import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeRiskAnalysis,
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("does not inherit sensitivity from unrelated raw diff content", () => {
    const diff = makeDiffContext({
      rawDiff: "source/auth.ts\n+token validation changed",
      files: [
        {
          path: "source/utils/math.ts",
          hunks: [
            {
              header: "@@ -1,1 +1,1 @@",
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              content: "+return value * 2;",
            },
          ],
          existingTestFile: null,
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
    expect(factors.sensitivityScore).toBeLessThan(0.9);
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

  it("renormalizes risk scoring when defect history is unavailable", () => {
    const diff = makeDiffContext({
      riskFactors: {
        sensitivityScore: 0.8,
        complexityScore: 0.6,
        coverageGap: 0.5,
        defectHistory: 0,
      },
    });

    const scoreWithHistory = computeRiskScore(diff);
    const scoreWithoutHistory = computeRiskScore(diff, {
      defectHistoryAvailable: false,
    });

    expect(scoreWithoutHistory).toBeGreaterThan(scoreWithHistory);
    expect(scoreWithoutHistory).toBeLessThanOrEqual(1);
  });
});

describe("computeRiskAnalysis", () => {
  it("logs a warning and omits defect history when git history cannot be read", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "risk-scorer-"));
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      const diff = makeDiffContext({
        rawDiff: "+const token = getToken();",
        files: [
          {
            path: "source/auth/login.ts",
            hunks: [
              {
                header: "@@ -1,1 +1,1 @@",
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                content: "+const token = getToken();",
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

      const analysis = await computeRiskAnalysis(repoRoot, diff);

      expect(analysis.factors.defectHistory).toBe(0);
      expect(analysis.reasons).toContain(
        "Git history could not be read, so defect-history risk was omitted from scoring.",
      );
      expect(analysis.score).toBe(
        computeRiskScore(
          {
            ...diff,
            riskFactors: analysis.factors,
          },
          {
            defectHistoryAvailable: false,
          },
        ),
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(
        "Failed to calculate defect history, omitting history from risk score:",
      );
      expect(warnSpy.mock.calls[0]?.[0]).toContain("source/auth/login.ts");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
