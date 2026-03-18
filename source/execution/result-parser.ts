import {
  testResultSchema,
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

function parseVitestJsonOutput(stdout: string): TestResult[] {
  const json = vitestJsonOutputSchema.parse(JSON.parse(stdout));

  return json.testResults.flatMap((file) =>
    file.assertionResults.map((assertion) => {
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
    }),
  );
}

export { analyzeFailure, parseVitestJsonOutput };
