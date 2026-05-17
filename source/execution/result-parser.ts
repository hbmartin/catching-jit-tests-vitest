import {
  testResultSchema,
  type VitestFileResult,
  vitestJsonOutputSchema,
} from "../runtime-schemas.js";
import type {
  FailureAnalysis,
  TestResult,
  VitestAssertionResult,
} from "./types.js";

const assertionTypePatterns: readonly {
  pattern: RegExp;
  type: FailureAnalysis["assertionType"];
}[] = [
  { pattern: /toBe\(/, type: "toBe" },
  { pattern: /toEqual\(/, type: "toEqual" },
  { pattern: /toThrow/, type: "toThrow" },
  { pattern: /toBeTruthy/, type: "toBeTruthy" },
  { pattern: /toBeNull/, type: "toBeNull" },
];

const expectedPattern = /Expected:?\s*(.+)/m;
const receivedPattern = /Received:?\s*(.+)/m;
const toBeExpectedPattern = /expected (.+) to be (.+)/i;
const errorClassPattern = /^(\w+Error):/;

const runtimeErrorPatterns = [
  /TypeError:/,
  /ReferenceError:/,
  /RangeError:/,
  /SyntaxError:/,
  /Error:/,
  /Cannot read properties/,
  /is not a function/,
  /is not defined/,
];

function detectAssertionType(
  failureMessage: string,
): FailureAnalysis["assertionType"] {
  for (const { pattern, type } of assertionTypePatterns) {
    if (pattern.test(failureMessage)) {
      return type;
    }
  }
  return "other";
}

function extractExpectedActual(failureMessage: string): {
  expected: string | null;
  actual: string | null;
} {
  const expectedMatch = expectedPattern.exec(failureMessage);
  const receivedMatch = receivedPattern.exec(failureMessage);

  if (expectedMatch?.[1] && receivedMatch?.[1]) {
    return {
      expected: expectedMatch[1].trim(),
      actual: receivedMatch[1].trim(),
    };
  }

  const toBeMatch = toBeExpectedPattern.exec(failureMessage);
  if (toBeMatch?.[1] && toBeMatch[2]) {
    return {
      expected: toBeMatch[2].trim(),
      actual: toBeMatch[1].trim(),
    };
  }

  return { expected: null, actual: null };
}

function extractStackTrace(failureMessage: string): string {
  const stackStart = failureMessage.indexOf("    at ");
  if (stackStart === -1) {
    return "";
  }
  return failureMessage.slice(stackStart);
}

function isRuntimeError(failureMessage: string): boolean {
  return runtimeErrorPatterns.some((p) => p.test(failureMessage));
}

function extractErrorClass(failureMessage: string): string | null {
  const match = errorClassPattern.exec(failureMessage);
  return match?.[1] ?? null;
}

function analyzeFailure(failureMessage: string): FailureAnalysis {
  const { expected, actual } = extractExpectedActual(failureMessage);

  return {
    assertionType: detectAssertionType(failureMessage),
    expected,
    actual,
    stackTrace: extractStackTrace(failureMessage),
    isRuntimeError: isRuntimeError(failureMessage),
    errorClass: extractErrorClass(failureMessage),
  };
}

function normalizeAssertionStatus(
  status: VitestAssertionResult["status"],
): TestResult["status"] {
  switch (status) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    default:
      return "skipped";
  }
}

function buildAssertionResult(
  file: VitestFileResult,
  assertion: VitestAssertionResult,
): TestResult {
  const status = normalizeAssertionStatus(assertion.status);
  const failureMessage = assertion.failureMessages.join("\n");

  return testResultSchema.parse({
    testFile: file.name,
    testName: [...assertion.ancestorTitles, assertion.title].join(" > "),
    status,
    failureMessage,
    duration: assertion.duration,
    failureAnalysis:
      status === "failed" ? analyzeFailure(failureMessage) : null,
  });
}

function requireFirstAssertionResult(
  assertionResults: readonly TestResult[],
): TestResult {
  const [result] = assertionResults;
  if (!result) {
    throw new Error("Expected at least one assertion result");
  }
  return result;
}

function buildFileLevelResult(file: VitestFileResult): TestResult {
  const fileStatus = normalizeAssertionStatus(file.status);

  if (file.assertionResults.length === 0) {
    const failureMessage =
      file.message ||
      (fileStatus === "failed"
        ? "Vitest failed before any assertions could run"
        : "");

    return testResultSchema.parse({
      testFile: file.name,
      testName: file.name,
      status: fileStatus,
      failureMessage,
      duration: 0,
      failureAnalysis:
        fileStatus === "failed" ? analyzeFailure(failureMessage) : null,
    });
  }

  const assertionResults = file.assertionResults.map((assertion) =>
    buildAssertionResult(file, assertion),
  );
  const firstFailed = assertionResults.find(
    (result) => result.status === "failed",
  );
  const firstPassed = assertionResults.find(
    (result) => result.status === "passed",
  );
  const selectedResult =
    firstFailed ?? firstPassed ?? requireFirstAssertionResult(assertionResults);

  let aggregateStatus: TestResult["status"] = "skipped";
  if (fileStatus === "failed" || firstFailed) {
    aggregateStatus = "failed";
  } else if (firstPassed) {
    aggregateStatus = "passed";
  }
  const fileFailureMessage =
    fileStatus === "failed" && file.message ? file.message : "";
  const failureMessage =
    fileFailureMessage.length > 0
      ? [fileFailureMessage, selectedResult.failureMessage]
          .filter((message) => message.length > 0)
          .join("\n")
      : selectedResult.failureMessage;
  const additionalAssertions = assertionResults.length - 1;

  return testResultSchema.parse({
    ...selectedResult,
    status: aggregateStatus,
    failureMessage,
    testName:
      additionalAssertions > 0
        ? `${selectedResult.testName} (+${String(additionalAssertions)} more assertions)`
        : selectedResult.testName,
    duration: assertionResults.reduce(
      (sum, result) => sum + result.duration,
      0,
    ),
    failureAnalysis:
      aggregateStatus === "failed" ? analyzeFailure(failureMessage) : null,
  });
}

function parseVitestJsonOutput(stdout: string): TestResult[] {
  const json = vitestJsonOutputSchema.parse(JSON.parse(stdout));

  return json.testResults.map((file) => buildFileLevelResult(file));
}

export { analyzeFailure, parseVitestJsonOutput };
