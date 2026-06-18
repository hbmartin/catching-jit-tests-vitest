import { describe, expect, it } from "vitest";

import {
  estimateDismissalDifficulty,
  scoreToVerdict,
} from "../../source/assessors/pipeline.js";
import { assessorsConfigSchema } from "../../source/config.js";
import type { WeakCatch } from "../../source/harvest/types.js";

const defaultThresholds = assessorsConfigSchema.parse({}).verdictThresholds;

describe("scoreToVerdict", () => {
  it("returns strong-catch for high scores", () => {
    expect(scoreToVerdict(0.8, defaultThresholds)).toBe("strong-catch");
    expect(scoreToVerdict(0.6, defaultThresholds)).toBe("strong-catch");
  });

  it("returns likely-strong for moderate-high scores", () => {
    expect(scoreToVerdict(0.4, defaultThresholds)).toBe("likely-strong");
    expect(scoreToVerdict(0.3, defaultThresholds)).toBe("likely-strong");
  });

  it("returns uncertain for near-zero scores", () => {
    expect(scoreToVerdict(0.0, defaultThresholds)).toBe("uncertain");
    expect(scoreToVerdict(-0.2, defaultThresholds)).toBe("uncertain");
  });

  it("returns likely-false-positive for moderate-low scores", () => {
    expect(scoreToVerdict(-0.4, defaultThresholds)).toBe(
      "likely-false-positive",
    );
  });

  it("returns false-positive for very low scores", () => {
    expect(scoreToVerdict(-0.7, defaultThresholds)).toBe("false-positive");
    expect(scoreToVerdict(-1.0, defaultThresholds)).toBe("false-positive");
  });

  it("honors custom verdict thresholds", () => {
    const strict = assessorsConfigSchema.parse({
      verdictThresholds: { strongCatch: 0.9 },
    }).verdictThresholds;
    expect(scoreToVerdict(0.8, strict)).toBe("likely-strong");
    expect(scoreToVerdict(0.9, strict)).toBe("strong-catch");
  });
});

function makeWeakCatch(
  changeType: WeakCatch["behaviorChange"]["changeType"],
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
      summary: "",
      parentBehavior: "",
      childBehavior: "",
      changeType,
    },
  };
}

describe("estimateDismissalDifficulty", () => {
  it("returns trivial for boolean flips", () => {
    expect(estimateDismissalDifficulty(makeWeakCatch("boolean-flipped"))).toBe(
      "trivial",
    );
  });

  it("returns easy for null-introduced", () => {
    expect(estimateDismissalDifficulty(makeWeakCatch("null-introduced"))).toBe(
      "easy",
    );
  });

  it("returns easy for return-value-changed", () => {
    expect(
      estimateDismissalDifficulty(makeWeakCatch("return-value-changed")),
    ).toBe("easy");
  });

  it("returns moderate for exceptions", () => {
    expect(
      estimateDismissalDifficulty(makeWeakCatch("exception-introduced")),
    ).toBe("moderate");
  });

  it("returns hard for complex changes", () => {
    expect(
      estimateDismissalDifficulty(makeWeakCatch("output-shape-changed")),
    ).toBe("hard");
    expect(estimateDismissalDifficulty(makeWeakCatch("ordering-changed"))).toBe(
      "hard",
    );
  });
});
