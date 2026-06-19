export { assessWeakCatch } from "./assessors/pipeline.js";
export type {
  AggregatedAssessment,
  Assessment,
  JudgeInput,
  JudgeOutput,
} from "./assessors/types.js";
export { renderReport, runFormatCommand } from "./commands/format.js";
export { runTriageCommand } from "./commands/triage.js";
export type {
  FormatCommandOptions,
  JiTTestConfig,
  SensitivityGlob,
  TriageCommandOptions,
} from "./config.js";
export {
  createDefaultConfig,
  defaultAutoContextFiles,
  failOnVerdictSchema,
  formatCommandOptionsSchema,
  loadConfig,
  outputFormatSchema,
  parseCatchCommandOptions,
  parseFormatCommandOptions,
  parseTriageCommandOptions,
  savedReportFormatSchema,
  sensitivityGlobSchema,
  triageCommandOptionsSchema,
  triageLabelSchema,
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
export {
  loadIntentContext,
  truncateContext,
} from "./generation/intent-context.js";
export type {
  GeneratedTest,
  GenerationResult,
  InferredRisk,
  MutantCandidate,
} from "./generation/types.js";
export {
  harvestHardeningCandidates,
  harvestWeakCatches,
} from "./harvest/harvester.js";
export type {
  BehaviorChange,
  HardeningCandidate,
  WeakCatch,
} from "./harvest/types.js";
export { generateBehaviorReport } from "./reporting/behavior-change.js";
export {
  formatAssessmentRecords,
  formatBehaviorReports,
  formatCatchResult,
} from "./reporting/console.js";
export { formatPRComment } from "./reporting/github-comment.js";
export { formatGithubStepSummary } from "./reporting/github-step-summary.js";
export { formatJsonReport, jsonReportSchema } from "./reporting/json-report.js";
export type {
  BehaviorReport,
  RunStats,
} from "./reporting/types.js";
export type {
  AssessmentFeedbackRecord,
  EngineerFeedback,
  LLMUsage,
  LLMUsageAuditEvent,
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
  hardeningCandidateSchema,
  inferRisksResponseSchema,
  inferredRiskSchema,
  judgeOutputSchema,
  llmUsageAuditEventSchema,
  llmUsageSchema,
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
