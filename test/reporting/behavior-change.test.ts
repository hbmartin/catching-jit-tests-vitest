import { describe, expect, it } from "vitest";
import type { WeakCatch } from "../../source/harvest/types.js";
import {
  buildSenseCheck,
  generateBehaviorReport,
} from "../../source/reporting/behavior-change.js";

function makeWeakCatch(
  changeType: WeakCatch["behaviorChange"]["changeType"],
  parentBehavior = "old",
  childBehavior = "new",
): WeakCatch {
  return {
    test: {
      code: "",
      targetSymbol: "",
      testFilePath: "",
      behaviorDescription: "",
      workflow: "dodgy-diff",
      generatorConfidence: 0.5,
    },
    parentResult: {
      testFile: "",
      testName: "",
      status: "passed",
      failureMessage: "",
      duration: 0,
      failureAnalysis: null,
    },
    childResult: {
      testFile: "",
      testName: "",
      status: "failed",
      failureMessage: "",
      duration: 0,
      failureAnalysis: null,
    },
    behaviorChange: {
      summary: "summary",
      parentBehavior,
      childBehavior,
      changeType,
    },
  };
}

describe("buildSenseCheck", () => {
  it("generates boolean flip message", () => {
    const wc = makeWeakCatch("boolean-flipped", "true", "false");
    const msg = buildSenseCheck(wc);
    expect(msg).toContain("true");
    expect(msg).toContain("false");
    expect(msg).toContain("Is this expected?");
  });

  it("generates null-introduced message", () => {
    const msg = buildSenseCheck(makeWeakCatch("null-introduced"));
    expect(msg).toContain("null/undefined");
    expect(msg).toContain("Is this expected?");
  });

  it("generates return-value-changed message", () => {
    const msg = buildSenseCheck(
      makeWeakCatch("return-value-changed", "42", "0"),
    );
    expect(msg).toContain("42");
    expect(msg).toContain("0");
  });

  it("generates exception-introduced message", () => {
    const msg = buildSenseCheck(makeWeakCatch("exception-introduced"));
    expect(msg).toContain("throws an exception");
  });

  it("generates default message for unknown types", () => {
    const msg = buildSenseCheck(makeWeakCatch("other"));
    expect(msg).toContain("behavioral difference");
    expect(msg).toContain("Is this expected?");
  });
});

describe("generateBehaviorReport", () => {
  it("uses a softer headline for uncertain assessments", () => {
    const report = generateBehaviorReport(
      {
        assessments: [],
        combinedScore: 0,
        verdict: "uncertain",
        shouldReport: true,
        dismissalDifficulty: "moderate",
      },
      makeWeakCatch("other"),
    );

    expect(report.headline).toContain("requires review");
  });
});
