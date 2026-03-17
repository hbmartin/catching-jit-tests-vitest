import { describe, expect, it } from "vitest";

import {
  assessmentBundleSchema,
  reportCommandResultSchema,
  weakCatchBundleSchema,
} from "../source/runtime-schemas.js";

const weakCatchBundle = {
  diff: {
    rawDiff: "diff --git a/source/auth.ts b/source/auth.ts",
    pr: {
      title: "Refactor access checks",
      body: "Cleanup only",
    },
  },
  weakCatches: [
    {
      test: {
        code: "it('works', () => expect(result).toBe(true));",
        targetSymbol: "isAllowed",
        testFilePath: "generated/is-allowed.test.ts",
        behaviorDescription: "Checks an auth gate",
        workflow: "dodgy-diff",
        generatorConfidence: 0.8,
      },
      parentResult: {
        testFile: "generated/is-allowed.test.ts",
        testName: "works",
        status: "passed",
        failureMessage: "",
        duration: 10,
        failureAnalysis: null,
      },
      childResult: {
        testFile: "generated/is-allowed.test.ts",
        testName: "works",
        status: "failed",
        failureMessage: "Expected true but received false",
        duration: 12,
        failureAnalysis: null,
      },
      behaviorChange: {
        summary: "Boolean result flipped from true to false",
        parentBehavior: "true",
        childBehavior: "false",
        changeType: "boolean-flipped",
      },
    },
  ],
};

describe("runtime schemas", () => {
  it("parses weak catch bundles", () => {
    expect(weakCatchBundleSchema.parse(weakCatchBundle)).toEqual(
      weakCatchBundle,
    );
  });

  it("parses assessment bundles", () => {
    const assessmentBundle = {
      diff: weakCatchBundle.diff,
      assessments: [
        {
          weakCatch: weakCatchBundle.weakCatches[0],
          assessment: {
            assessments: [
              {
                score: 0.6,
                rationale: "A boolean condition changed across revisions.",
                detectedPatterns: [],
                assessor: "rubfake",
              },
            ],
            combinedScore: 0.6,
            verdict: "likely-strong",
            shouldReport: true,
            dismissalDifficulty: "trivial",
          },
        },
      ],
    };

    expect(assessmentBundleSchema.parse(assessmentBundle)).toEqual(
      assessmentBundle,
    );
  });

  it("parses report command results", () => {
    const result = {
      format: "json",
      reports: [
        {
          headline: "Unexpected behavior change detected: auth flipped",
          senseCheck: "This expression used to evaluate to true.",
          details: {
            behaviorChange: {
              summary: "auth flipped",
              parentBehavior: "true",
              childBehavior: "false",
              changeType: "boolean-flipped",
            },
            verdict: "likely-strong",
            assessorRationales: ["Boolean changed"],
            testCode: "it('works')",
            dismissalEstimate: "~30 seconds",
          },
        },
      ],
    };

    expect(reportCommandResultSchema.parse(result)).toEqual(result);
  });
});
