import { z } from "zod";
import type { HardeningCandidate } from "../harvest/types.js";
import {
  behaviorReportSchema,
  hardeningCandidateSchema,
  runStatsSchema,
} from "../runtime-schemas.js";
import { cliVersion } from "../version.js";
import type { BehaviorReport, RunStats } from "./types.js";

const jsonReportSchema = z.object({
  version: z.string(),
  stats: runStatsSchema.nullable(),
  reports: z.array(behaviorReportSchema),
  hardeningCandidates: z.array(hardeningCandidateSchema).default([]),
  statusMessage: z.string().optional(),
});

type JsonReport = z.infer<typeof jsonReportSchema>;

function formatJsonReport(
  reports: readonly BehaviorReport[],
  stats: RunStats | null,
  statusMessage?: string,
  hardeningCandidates: readonly HardeningCandidate[] = [],
): string {
  const report: JsonReport = {
    version: cliVersion,
    stats,
    reports: [...reports],
    hardeningCandidates: [...hardeningCandidates],
    statusMessage,
  };

  return JSON.stringify(report, null, 2);
}

export type { JsonReport };
export { formatJsonReport, jsonReportSchema };
