import type {
  BehaviorReport as RuntimeBehaviorReport,
  BehaviorReportDetails as RuntimeBehaviorReportDetails,
  HardeningCandidate as RuntimeHardeningCandidate,
  RunStats as RuntimeRunStats,
} from "../runtime-schemas.js";

type BehaviorReportDetails = RuntimeBehaviorReportDetails;
type BehaviorReport = RuntimeBehaviorReport;
type HardeningCandidate = RuntimeHardeningCandidate;
type RunStats = RuntimeRunStats;

export type {
  BehaviorReport,
  BehaviorReportDetails,
  HardeningCandidate,
  RunStats,
};
