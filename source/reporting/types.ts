import type { AggregatedAssessment } from "../assessors/types.js";
import type { BehaviorChange } from "../harvest/types.js";

interface BehaviorReportDetails {
  readonly behaviorChange: BehaviorChange;
  readonly verdict: AggregatedAssessment["verdict"];
  readonly assessorRationales: readonly string[];
  readonly testCode: string;
  readonly dismissalEstimate: string;
}

interface BehaviorReport {
  readonly headline: string;
  readonly senseCheck: string;
  readonly details: BehaviorReportDetails;
}

interface RunStats {
  readonly duration: string;
  readonly diffExtractionMs: number;
  readonly testGenerationMs: number;
  readonly executionMs: number;
  readonly assessmentMs: number;
  readonly filesAnalyzed: number;
  readonly functionsAnalyzed: number;
  readonly totalTestsGenerated: number;
  readonly testsPassedOnParent: number;
  readonly testsFailedOnChild: number;
  readonly weakCatchCount: number;
  readonly assessedAsTP: number;
  readonly assessedAsFP: number;
  readonly assessedAsUncertain: number;
  readonly reportsGenerated: number;
  readonly byWorkflow: {
    readonly dodgyDiff: {
      readonly generated: number;
      readonly weakCatches: number;
    };
    readonly intentAware: {
      readonly generated: number;
      readonly weakCatches: number;
    };
  };
  readonly llmCallCount: number;
  readonly estimatedTokens: number;
  readonly estimatedCost: number;
  readonly diffRiskScore: number;
}

export type { BehaviorReport, BehaviorReportDetails, RunStats };
