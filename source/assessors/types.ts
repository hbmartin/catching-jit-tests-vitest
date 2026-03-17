import type { DiffContext } from "../diff/types.js";
import type { BehaviorChange, WeakCatch } from "../harvest/types.js";

type AssessmentScore = number;

interface DetectedPattern {
  readonly name: string;
  readonly direction: "true-positive" | "false-positive";
  readonly confidence: "high" | "medium" | "low";
  readonly evidence: string;
}

interface Assessment {
  readonly score: AssessmentScore;
  readonly rationale: string;
  readonly detectedPatterns: readonly DetectedPattern[];
  readonly assessor: "rubfake" | "llm-probability" | "llm-ensemble";
}

interface AggregatedAssessment {
  readonly assessments: readonly Assessment[];
  readonly combinedScore: AssessmentScore;
  readonly verdict:
    | "strong-catch"
    | "likely-strong"
    | "uncertain"
    | "likely-false-positive"
    | "false-positive";
  readonly shouldReport: boolean;
  readonly dismissalDifficulty: "trivial" | "easy" | "moderate" | "hard";
}

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

export type {
  AggregatedAssessment,
  Assessment,
  AssessmentScore,
  DetectedPattern,
  JudgeInput,
  JudgeOutput,
  PatternMatch,
  RubFakeRule,
  RuleContext,
};
