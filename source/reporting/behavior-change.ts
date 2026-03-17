import type { AggregatedAssessment } from "../assessors/types.js";
import type { WeakCatch } from "../harvest/types.js";
import { behaviorReportSchema } from "../runtime-schemas.js";

import type { BehaviorReport } from "./types.js";

function buildHeadline(
  assessment: AggregatedAssessment,
  weakCatch: WeakCatch,
): string {
  const {
    behaviorChange: { summary },
  } = weakCatch;

  if (assessment.verdict === "uncertain") {
    return `Behavior change requires review: ${summary}`;
  }

  if (
    assessment.verdict === "likely-false-positive" ||
    assessment.verdict === "false-positive"
  ) {
    return `Behavior change flagged for review: ${summary}`;
  }

  return `Potential unexpected behavior change: ${summary}`;
}

function buildSenseCheck(weakCatch: WeakCatch): string {
  const bc = weakCatch.behaviorChange;

  switch (bc.changeType) {
    case "boolean-flipped": {
      return `This expression used to evaluate to **${bc.parentBehavior}**, but now evaluates to **${bc.childBehavior}**. Is this expected?`;
    }
    case "null-introduced": {
      return "A value that was previously defined is now **null/undefined**, causing a failure. Is this expected?";
    }
    case "return-value-changed": {
      return `A function return value changed from \`${bc.parentBehavior}\` to \`${bc.childBehavior}\`. Is this expected?`;
    }
    case "exception-introduced": {
      return "Code that previously ran without errors now throws an exception. Is this expected?";
    }
    case "exception-removed": {
      return "Code that previously threw an exception now succeeds silently. Is this expected?";
    }
    case "missing-key": {
      return "An expected key/property is no longer present in the output. Is this expected?";
    }
    case "ordering-changed": {
      return "The ordering of elements in a collection has changed. Is this expected?";
    }
    default: {
      return `A behavioral difference was detected between the parent and this PR: ${bc.summary}. Is this expected?`;
    }
  }
}

function getDismissalEstimate(
  difficulty: AggregatedAssessment["dismissalDifficulty"],
): string {
  switch (difficulty) {
    case "trivial": {
      return "~30 seconds";
    }
    case "easy": {
      return "~1-2 minutes";
    }
    case "moderate": {
      return "~5 minutes";
    }
    case "hard": {
      return "~10+ minutes";
    }
    default: {
      return "~5 minutes";
    }
  }
}

function generateBehaviorReport(
  assessment: AggregatedAssessment,
  weakCatch: WeakCatch,
): BehaviorReport {
  const bc = weakCatch.behaviorChange;
  const senseCheck = buildSenseCheck(weakCatch);

  return behaviorReportSchema.parse({
    headline: buildHeadline(assessment, weakCatch),
    senseCheck,
    details: {
      behaviorChange: bc,
      verdict: assessment.verdict,
      assessorRationales: assessment.assessments.map((a) => a.rationale),
      testCode: weakCatch.test.code,
      dismissalEstimate: getDismissalEstimate(assessment.dismissalDifficulty),
    },
  });
}

export { buildSenseCheck, generateBehaviorReport };
