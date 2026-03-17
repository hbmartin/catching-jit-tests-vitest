import type { DiffContext } from "../diff/types.js";
import type { BehaviorChange, WeakCatch } from "../harvest/types.js";
import type {
  AggregatedAssessment as RuntimeAggregatedAssessment,
  Assessment as RuntimeAssessment,
  DetectedPattern as RuntimeDetectedPattern,
} from "../runtime-schemas.js";

type AssessmentScore = number;
type AggregatedAssessment = RuntimeAggregatedAssessment;
type Assessment = RuntimeAssessment;
type DetectedPattern = RuntimeDetectedPattern;

interface PatternMatch {
  readonly score: AssessmentScore;
  readonly evidence: string;
}

interface RuleContext {
  readonly weakCatch: WeakCatch;
  readonly diff: DiffContext;
  readonly executionLog: string;
  readonly testCode: string;
}

interface RubFakeRule {
  readonly name: string;
  readonly direction: "false-positive" | "true-positive";
  readonly confidence: "high" | "medium" | "low";
  readonly sources: ReadonlyArray<"test-code" | "execution-log" | "diff">;
  readonly evaluate: (ctx: RuleContext) => PatternMatch | null;
}

interface JudgeInput {
  readonly testCode: string;
  readonly failureMessage: string;
  readonly stackTrace: string;
  readonly diff: string;
  readonly inferredIntent: string;
  readonly behaviorChange: BehaviorChange;
}

interface JudgeOutput {
  readonly isUnexpectedBug: boolean;
  readonly confidence: "high" | "medium" | "low";
  readonly explanation: string;
}

interface AssessmentRecord {
  readonly weakCatch: WeakCatch;
  readonly assessment: AggregatedAssessment;
}

export type {
  AggregatedAssessment,
  Assessment,
  AssessmentRecord,
  AssessmentScore,
  DetectedPattern,
  JudgeInput,
  JudgeOutput,
  PatternMatch,
  RubFakeRule,
  RuleContext,
};
