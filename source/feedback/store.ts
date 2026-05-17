import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { AggregatedAssessment } from "../assessors/types.js";
import type { Workflow } from "../config.js";
import type { DiffContext } from "../diff/types.js";
import type { WeakCatch } from "../harvest/types.js";
import {
  type AssessmentFeedbackRecord,
  assessmentFeedbackRecordSchema,
} from "../runtime-schemas.js";

interface BuildAssessmentFeedbackRecordInput {
  readonly runId: string;
  readonly recordedAt: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly workflow: Workflow;
  readonly diff: DiffContext;
  readonly weakCatch: WeakCatch;
  readonly assessment: AggregatedAssessment;
}

function createRecordId(input: {
  readonly runId: string;
  readonly workflow: Workflow;
  readonly weakCatch: WeakCatch;
}): string {
  return createHash("sha256")
    .update(input.runId)
    .update("\0")
    .update(input.workflow)
    .update("\0")
    .update(input.weakCatch.test.testFilePath)
    .update("\0")
    .update(input.weakCatch.test.targetSymbol)
    .update("\0")
    .update(input.weakCatch.behaviorChange.summary)
    .digest("hex")
    .slice(0, 16);
}

function buildAssessmentFeedbackRecord(
  input: BuildAssessmentFeedbackRecordInput,
): AssessmentFeedbackRecord {
  return assessmentFeedbackRecordSchema.parse({
    id: createRecordId({
      runId: input.runId,
      workflow: input.workflow,
      weakCatch: input.weakCatch,
    }),
    runId: input.runId,
    recordedAt: input.recordedAt,
    baseRef: input.baseRef,
    headRef: input.headRef,
    workflow: input.workflow,
    riskScore: input.diff.riskScore,
    pr: input.diff.pr,
    weakCatch: input.weakCatch,
    assessment: input.assessment,
    engineerFeedback: {},
  });
}

async function appendAssessmentFeedbackRecord(
  feedbackPath: string,
  record: AssessmentFeedbackRecord,
): Promise<void> {
  await mkdir(path.dirname(feedbackPath), { recursive: true });
  await appendFile(feedbackPath, `${JSON.stringify(record)}\n`, "utf-8");
}

export type { BuildAssessmentFeedbackRecordInput };
export { appendAssessmentFeedbackRecord, buildAssessmentFeedbackRecord };
