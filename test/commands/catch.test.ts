import { describe, expect, it } from "vitest";

import { selectAssessmentExecutionLog } from "../../source/commands/catch.js";

describe("selectAssessmentExecutionLog", () => {
  it("falls back to the failure message when the execution log is blank", () => {
    expect(selectAssessmentExecutionLog("", "child failure")).toBe(
      "child failure",
    );
    expect(selectAssessmentExecutionLog("   \n\t", "child failure")).toBe(
      "child failure",
    );
  });

  it("keeps non-empty execution logs", () => {
    expect(selectAssessmentExecutionLog("stderr output", "child failure")).toBe(
      "stderr output",
    );
  });
});
