import type {
  DualExecutionResult as RuntimeDualExecutionResult,
  FailureAnalysis as RuntimeFailureAnalysis,
  TestResult as RuntimeTestResult,
  VitestAssertionResult as RuntimeVitestAssertionResult,
  VitestFileResult as RuntimeVitestFileResult,
  VitestJsonOutput as RuntimeVitestJsonOutput,
} from "../runtime-schemas.js";

type FailureAnalysis = RuntimeFailureAnalysis;
type TestResult = RuntimeTestResult;
type DualExecutionResult = RuntimeDualExecutionResult;
type VitestAssertionResult = RuntimeVitestAssertionResult;
type VitestFileResult = RuntimeVitestFileResult;
type VitestJsonOutput = RuntimeVitestJsonOutput;

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
