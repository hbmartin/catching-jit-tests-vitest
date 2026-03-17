import { describe, expect, it } from "vitest";

import {
  analyzeFailure,
  parseVitestJsonOutput,
} from "../../source/execution/result-parser.js";

describe("analyzeFailure", () => {
  it("detects toBe assertion type", () => {
    const result = analyzeFailure("expected true toBe(false)");
    expect(result.assertionType).toBe("toBe");
  });

  it("detects toEqual assertion type", () => {
    const result = analyzeFailure("expected {a:1} toEqual({a:2})");
    expect(result.assertionType).toBe("toEqual");
  });

  it("extracts expected and actual values", () => {
    const result = analyzeFailure("Expected: true\nReceived: false");
    expect(result.expected).toBe("true");
    expect(result.actual).toBe("false");
  });

  it("detects runtime errors", () => {
    const result = analyzeFailure(
      "TypeError: Cannot read properties of undefined",
    );
    expect(result.isRuntimeError).toBe(true);
    expect(result.errorClass).toBe("TypeError");
  });

  it("extracts stack trace", () => {
    const result = analyzeFailure(
      "Error: fail\n    at Object.test (test.ts:10:5)\n    at run (runner.ts:20:3)",
    );
    expect(result.stackTrace).toContain("at Object.test");
  });

  it("handles messages without stack trace", () => {
    const result = analyzeFailure("simple error message");
    expect(result.stackTrace).toBe("");
  });
});

describe("parseVitestJsonOutput", () => {
  it("parses passed test results", () => {
    const json = JSON.stringify({
      testResults: [
        {
          name: "test/example.test.ts",
          status: "passed",
          assertionResults: [
            {
              ancestorTitles: ["describe"],
              title: "should work",
              status: "passed",
              failureMessages: [],
              duration: 50,
            },
          ],
        },
      ],
    });

    const results = parseVitestJsonOutput(json);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("passed");
    expect(results[0]?.testName).toBe("describe > should work");
    expect(results[0]?.failureAnalysis).toBeNull();
  });

  it("parses failed test results with failure analysis", () => {
    const json = JSON.stringify({
      testResults: [
        {
          name: "test/example.test.ts",
          status: "failed",
          assertionResults: [
            {
              ancestorTitles: ["suite"],
              title: "should fail",
              status: "failed",
              failureMessages: ["Expected: true\nReceived: false"],
              duration: 30,
            },
          ],
        },
      ],
    });

    const results = parseVitestJsonOutput(json);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.failureAnalysis).not.toBeNull();
    expect(results[0]?.failureAnalysis?.expected).toBe("true");
    expect(results[0]?.failureAnalysis?.actual).toBe("false");
  });

  it("normalizes pending todo and disabled assertions to skipped", () => {
    const json = JSON.stringify({
      testResults: [
        {
          name: "test/example.test.ts",
          status: "pending",
          assertionResults: [
            {
              ancestorTitles: ["suite"],
              title: "pending case",
              status: "pending",
              failureMessages: [],
              duration: 0,
            },
            {
              ancestorTitles: ["suite"],
              title: "todo case",
              status: "todo",
              failureMessages: [],
              duration: 0,
            },
            {
              ancestorTitles: ["suite"],
              title: "disabled case",
              status: "disabled",
              failureMessages: [],
              duration: 0,
            },
          ],
        },
      ],
    });

    const results = parseVitestJsonOutput(json);
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.status)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(results.every((result) => result.failureAnalysis === null)).toBe(
      true,
    );
  });
});
