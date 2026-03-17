import { z } from "zod";

import { outputFormatSchema, workflowSchema } from "./config.js";

const testExecutionStatusSchema = z.enum(["passed", "failed", "skipped"]);
const vitestStatusSchema = z.enum([
  "passed",
  "failed",
  "skipped",
  "pending",
  "todo",
  "disabled",
]);

export const generatedTestSchema = z.object({
  code: z.string(),
  targetSymbol: z.string(),
  testFilePath: z.string(),
  behaviorDescription: z.string(),
  workflow: workflowSchema.exclude(["both"]),
  generatorConfidence: z.number().min(0).max(1),
});

export type GeneratedTest = z.infer<typeof generatedTestSchema>;

export const inferredRiskSchema = z.object({
  id: z.string(),
  description: z.string(),
  targetSymbol: z.string(),
  filePath: z.string().nullable().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  mutantHint: z.string().nullable(),
});

export type InferredRisk = z.infer<typeof inferredRiskSchema>;

export const inferRisksResponseSchema = z.object({
  intent: z.string(),
  risks: z.array(inferredRiskSchema),
});

export type InferRisksResponse = z.infer<typeof inferRisksResponseSchema>;

export const failureAnalysisSchema = z.object({
  assertionType: z.enum([
    "toBe",
    "toEqual",
    "toThrow",
    "toBeTruthy",
    "toBeNull",
    "other",
  ]),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  stackTrace: z.string(),
  isRuntimeError: z.boolean(),
  errorClass: z.string().nullable(),
});

export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;

export const testResultSchema = z.object({
  testFile: z.string(),
  testName: z.string(),
  status: testExecutionStatusSchema,
  failureMessage: z.string(),
  duration: z.number().nonnegative(),
  failureAnalysis: failureAnalysisSchema.nullable(),
});

export type TestResult = z.infer<typeof testResultSchema>;

export const vitestAssertionResultSchema = z.object({
  ancestorTitles: z.array(z.string()),
  title: z.string(),
  status: vitestStatusSchema,
  failureMessages: z.array(z.string()),
  duration: z.number().nonnegative(),
});

export type VitestAssertionResult = z.infer<typeof vitestAssertionResultSchema>;

export const vitestFileResultSchema = z.object({
  name: z.string(),
  status: vitestStatusSchema,
  assertionResults: z.array(vitestAssertionResultSchema),
});

export type VitestFileResult = z.infer<typeof vitestFileResultSchema>;

export const vitestJsonOutputSchema = z.object({
  testResults: z.array(vitestFileResultSchema),
});

export type VitestJsonOutput = z.infer<typeof vitestJsonOutputSchema>;

export const behaviorChangeSchema = z.object({
  summary: z.string(),
  parentBehavior: z.string(),
  childBehavior: z.string(),
  changeType: z.enum([
    "return-value-changed",
    "exception-introduced",
    "exception-removed",
    "null-introduced",
    "boolean-flipped",
    "output-shape-changed",
    "ordering-changed",
    "missing-key",
    "type-changed",
    "other",
  ]),
});

export type BehaviorChange = z.infer<typeof behaviorChangeSchema>;

export const weakCatchSchema = z.object({
  test: generatedTestSchema,
  parentResult: testResultSchema,
  childResult: testResultSchema,
  behaviorChange: behaviorChangeSchema,
  executionLog: z.string().optional(),
});

export type WeakCatch = z.infer<typeof weakCatchSchema>;

export const dualExecutionResultSchema = z.object({
  test: generatedTestSchema,
  parentOutcome: testResultSchema,
  childOutcome: testResultSchema,
  parentExecutionLog: z.string().optional(),
  childExecutionLog: z.string().optional(),
});

export type DualExecutionResult = z.infer<typeof dualExecutionResultSchema>;

export const weakCatchBundleSchema = z.object({
  diff: z.object({
    rawDiff: z.string(),
    pr: z.object({
      title: z.string(),
      body: z.string(),
    }),
  }),
  weakCatches: z.array(weakCatchSchema),
});

export type WeakCatchBundle = z.infer<typeof weakCatchBundleSchema>;

export const detectedPatternSchema = z.object({
  name: z.string(),
  direction: z.enum(["true-positive", "false-positive"]),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.string(),
});

export type DetectedPattern = z.infer<typeof detectedPatternSchema>;

export const assessmentSchema = z.object({
  score: z.number().min(-1).max(1),
  rationale: z.string(),
  detectedPatterns: z.array(detectedPatternSchema),
  assessor: z.enum(["rubfake", "llm-probability", "llm-ensemble"]),
});

export type Assessment = z.infer<typeof assessmentSchema>;

export const aggregatedAssessmentSchema = z.object({
  assessments: z.array(assessmentSchema),
  combinedScore: z.number().min(-1).max(1),
  verdict: z.enum([
    "strong-catch",
    "likely-strong",
    "uncertain",
    "likely-false-positive",
    "false-positive",
  ]),
  shouldReport: z.boolean(),
  dismissalDifficulty: z.enum(["trivial", "easy", "moderate", "hard"]),
});

export type AggregatedAssessment = z.infer<typeof aggregatedAssessmentSchema>;

export const assessmentBundleSchema = z.object({
  diff: weakCatchBundleSchema.shape.diff,
  assessments: z.array(
    z.object({
      weakCatch: weakCatchSchema,
      assessment: aggregatedAssessmentSchema,
    }),
  ),
});

export type AssessmentBundle = z.infer<typeof assessmentBundleSchema>;

export const behaviorReportDetailsSchema = z.object({
  behaviorChange: behaviorChangeSchema,
  verdict: aggregatedAssessmentSchema.shape.verdict,
  assessorRationales: z.array(z.string()),
  testCode: z.string(),
  dismissalEstimate: z.string(),
});

export type BehaviorReportDetails = z.infer<typeof behaviorReportDetailsSchema>;

export const behaviorReportSchema = z.object({
  headline: z.string(),
  senseCheck: z.string(),
  details: behaviorReportDetailsSchema,
});

export type BehaviorReport = z.infer<typeof behaviorReportSchema>;

export const runStatsSchema = z.object({
  duration: z.string(),
  diffExtractionMs: z.number().nonnegative(),
  testGenerationMs: z.number().nonnegative(),
  executionMs: z.number().nonnegative(),
  assessmentMs: z.number().nonnegative(),
  filesAnalyzed: z.number().nonnegative(),
  functionsAnalyzed: z.number().nonnegative(),
  totalTestsGenerated: z.number().nonnegative(),
  testsPassedOnParent: z.number().nonnegative(),
  testsFailedOnChild: z.number().nonnegative(),
  weakCatchCount: z.number().nonnegative(),
  assessedAsTP: z.number().nonnegative(),
  assessedAsFP: z.number().nonnegative(),
  assessedAsUncertain: z.number().nonnegative(),
  reportsGenerated: z.number().nonnegative(),
  byWorkflow: z.object({
    dodgyDiff: z.object({
      generated: z.number().nonnegative(),
      weakCatches: z.number().nonnegative(),
    }),
    intentAware: z.object({
      generated: z.number().nonnegative(),
      weakCatches: z.number().nonnegative(),
    }),
  }),
  llmCallCount: z.number().nonnegative(),
  estimatedTokens: z.number().nonnegative(),
  estimatedCost: z.number().nonnegative(),
  diffRiskScore: z.number().min(0).max(1),
});

export type RunStats = z.infer<typeof runStatsSchema>;

export const reportCommandResultSchema = z.object({
  format: outputFormatSchema.exclude(["github-comment"]),
  reports: z.array(behaviorReportSchema),
});

export type ReportCommandResult = z.infer<typeof reportCommandResultSchema>;
