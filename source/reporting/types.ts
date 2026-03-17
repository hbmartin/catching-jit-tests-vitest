import type {
  BehaviorReport as RuntimeBehaviorReport,
  BehaviorReportDetails as RuntimeBehaviorReportDetails,
  RunStats as RuntimeRunStats,
} from "../runtime-schemas.js";

type BehaviorReportDetails = RuntimeBehaviorReportDetails;
type BehaviorReport = RuntimeBehaviorReport;
type RunStats = RuntimeRunStats;

export type { BehaviorReport, BehaviorReportDetails, RunStats };
