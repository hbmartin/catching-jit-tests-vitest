export { assessWeakCatch } from "./assessors/pipeline.js";
export type {
  AggregatedAssessment,
  Assessment,
  JudgeInput,
  JudgeOutput,
} from "./assessors/types.js";
export type { JiTTestConfig } from "./config.js";
export {
  createDefaultConfig,
  loadConfig,
  outputFormatSchema,
  parseCatchCommandOptions,
  workflowSchema,
} from "./config.js";
export { analyzeFileChanges } from "./diff/ast-analyzer.js";
export { extractDiff, extractDiffContext } from "./diff/extractor.js";
export {
  applyRiskAnalysis,
  computeRiskAnalysis,
  computeRiskFactors,
  computeRiskScore,
} from "./diff/risk-scorer.js";
export type {
  ASTAnalysis,
  ChangedFile,
  ChangedFunction,
  ChangedSymbol,
  DiffContext,
  DiffHunk,
  RiskFactors,
} from "./diff/types.js";
export type {
  DualExecutionResult,
  FailureAnalysis,
  TestResult,
} from "./execution/types.js";
export {
  appendAssessmentFeedbackRecord,
  buildAssessmentFeedbackRecord,
} from "./feedback/store.js";
export { dodgyDiffWorkflow } from "./generation/dodgy-diff.js";
export { intentAwareWorkflow } from "./generation/intent-aware.js";
export type {
  GeneratedTest,
  GenerationResult,
  InferredRisk,
  MutantCandidate,
} from "./generation/types.js";
export { harvestWeakCatches } from "./harvest/harvester.js";
export type {
  BehaviorChange,
  WeakCatch,
} from "./harvest/types.js";
export { generateBehaviorReport } from "./reporting/behavior-change.js";
export {
  formatAssessmentRecords,
  formatBehaviorReports,
  formatCatchResult,
} from "./reporting/console.js";
export { formatPRComment } from "./reporting/github-comment.js";
export { formatJsonReport } from "./reporting/json-report.js";
export type {
  BehaviorReport,
  RunStats,
} from "./reporting/types.js";
export type {
  AssessmentFeedbackRecord,
  EngineerFeedback,
} from "./runtime-schemas.js";
export {
  aggregatedAssessmentSchema,
  assessmentFeedbackRecordSchema,
  behaviorChangeSchema,
  behaviorReportSchema,
  dualExecutionResultSchema,
  engineerFeedbackSchema,
  failureAnalysisSchema,
  generatedTestSchema,
  inferRisksResponseSchema,
  inferredRiskSchema,
  reportCommandResultSchema,
  runStatsSchema,
  testResultSchema,
  vitestJsonOutputSchema,
  weakCatchBundleSchema,
  weakCatchSchema,
} from "./runtime-schemas.js";
export type { BrandedId } from "./types/index.js";
export { formatValue } from "./utils/formatting.js";
export { LLMClient } from "./utils/llm-client.js";
export { CommandError, runCommand } from "./utils/process.js";
