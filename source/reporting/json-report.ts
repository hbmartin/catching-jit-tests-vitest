import type { BehaviorReport, RunStats } from "./types.js";

interface JsonReport {
  readonly version: string;
  readonly stats: RunStats;
  readonly reports: readonly BehaviorReport[];
}

function formatJsonReport(
  reports: readonly BehaviorReport[],
  stats: RunStats,
): string {
  const report: JsonReport = {
    version: "0.1.0",
    stats,
    reports,
  };

  return JSON.stringify(report, null, 2);
}

export type { JsonReport };
export { formatJsonReport };
