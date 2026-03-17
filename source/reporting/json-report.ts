import { cliVersion } from "../version.js";
import type { BehaviorReport, RunStats } from "./types.js";

interface JsonReport {
  readonly version: string;
  readonly stats: RunStats | null;
  readonly reports: readonly BehaviorReport[];
  readonly statusMessage?: string;
}

function formatJsonReport(
  reports: readonly BehaviorReport[],
  stats: RunStats | null,
  statusMessage?: string,
): string {
  const report: JsonReport = {
    version: cliVersion,
    stats,
    reports,
    statusMessage,
  };

  return JSON.stringify(report, null, 2);
}

export type { JsonReport };
export { formatJsonReport };
