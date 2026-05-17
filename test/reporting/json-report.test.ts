import { describe, expect, it } from "vitest";

import { formatJsonReport } from "../../source/reporting/json-report.js";
import { cliVersion } from "../../source/version.js";

describe("formatJsonReport", () => {
  it("emits explicit status payloads when stats are absent", () => {
    const result = JSON.parse(
      formatJsonReport(
        [],
        null,
        "No tests were generated for the current diff.",
      ),
    );

    expect(result).toMatchObject({
      version: cliVersion,
      stats: null,
      reports: [],
      hardeningCandidates: [],
      statusMessage: "No tests were generated for the current diff.",
    });
  });
});
