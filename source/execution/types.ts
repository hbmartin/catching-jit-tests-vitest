interface FailureAnalysis {
  readonly assertionType:
    | "toBe"
    | "toEqual"
    | "toThrow"
    | "toBeTruthy"
    | "toBeNull"
    | "other";
  readonly expected: string | null;
  readonly actual: string | null;
  readonly stackTrace: string;
  readonly isRuntimeError: boolean;
  readonly errorClass: string | null;
}

interface TestResult {
  readonly testFile: string;
  readonly testName: string;
  readonly status: "passed" | "failed";
  readonly failureMessage: string;
  readonly duration: number;
  readonly failureAnalysis: FailureAnalysis | null;
}

interface DualExecutionResult {
  readonly test: import("../generation/types.js").GeneratedTest;
  readonly parentOutcome: TestResult;
  readonly childOutcome: TestResult;
}

interface VitestAssertionResult {
  readonly ancestorTitles: readonly string[];
  readonly title: string;
  readonly status: "passed" | "failed";
  readonly failureMessages: readonly string[];
  readonly duration: number;
}

interface VitestFileResult {
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly assertionResults: readonly VitestAssertionResult[];
}

interface VitestJsonOutput {
  readonly testResults: readonly VitestFileResult[];
}

interface WorktreeSetup {
  readonly parentDir: string;
  readonly childDir: string;
  readonly cleanup: () => Promise<void>;
}

export type {
  DualExecutionResult,
  FailureAnalysis,
  TestResult,
  VitestAssertionResult,
  VitestFileResult,
  VitestJsonOutput,
  WorktreeSetup,
};
