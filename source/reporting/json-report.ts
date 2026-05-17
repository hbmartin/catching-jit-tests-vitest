import type { HardeningCandidate } from "../harvest/types.js";
import { cliVersion } from "../version.js";
import type { BehaviorReport, RunStats } from "./types.js";

interface JsonReport {
  readonly version: string;
  readonly stats: RunStats | null;
  readonly reports: readonly BehaviorReport[];
  readonly hardeningCandidates: readonly HardeningCandidate[];
  readonly statusMessage?: string;
}

function formatJsonReport(
  reports: readonly BehaviorReport[],
  stats: RunStats | null,
  statusMessage?: string,
  hardeningCandidates: readonly HardeningCandidate[] = [],
): string {
  const report: JsonReport = {
    version: cliVersion,
    stats,
    reports,
    hardeningCandidates,
    statusMessage,
  };

  return JSON.stringify(report, null, 2);
}

export type { JsonReport };
export { formatJsonReport };
