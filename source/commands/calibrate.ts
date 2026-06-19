import { readFile } from "node:fs/promises";

import { combineAssessmentScores } from "../assessors/pipeline.js";
import type { Assessment } from "../assessors/types.js";
import {
  type AssessorsConfig,
  assessorsConfigSchema,
  type CalibrateCommandOptions,
} from "../config.js";
import {
  type AggregatedAssessment,
  assessmentFeedbackRecordSchema,
} from "../runtime-schemas.js";
import { logger } from "../utils/logger.js";

import { resolveFeedbackPath } from "./feedback-path.js";

interface LabeledRecord {
  readonly groundTruth: boolean;
  readonly rubfake: Assessment | null;
  readonly llm: Assessment | null;
  readonly dismissalDifficulty: AggregatedAssessment["dismissalDifficulty"];
  readonly storedShouldReport: boolean;
}

interface Metrics {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly trueNegatives: number;
}

interface TunedResult {
  readonly rubfakeWeight: number;
  readonly llmWeight: number;
  readonly reportThreshold: number;
  readonly metrics: Metrics;
}

interface CalibrationReport {
  readonly labeledCount: number;
  readonly positives: number;
  readonly negatives: number;
  readonly skipped: number;
  readonly current: Metrics;
  readonly best: TunedResult;
}

// confirmed-true-positive → should be reported; confirmed-false-positive and
// intended-change → should not. "unknown" records are excluded from calibration.
function labelToGroundTruth(label: string): boolean | null {
  if (label === "confirmed-true-positive") {
    return true;
  }
  if (label === "confirmed-false-positive" || label === "intended-change") {
    return false;
  }
  return null;
}

function findAssessor(
  assessments: readonly Assessment[],
  predicate: (assessor: Assessment["assessor"]) => boolean,
): Assessment | null {
  return assessments.find((a) => predicate(a.assessor)) ?? null;
}

function toLabeledRecord(record: unknown): LabeledRecord | null {
  const parsed = assessmentFeedbackRecordSchema.safeParse(record);
  if (!parsed.success) {
    return null;
  }

  const groundTruth = labelToGroundTruth(parsed.data.engineerFeedback.label);
  if (groundTruth === null) {
    return null;
  }

  const { assessments, dismissalDifficulty, shouldReport } =
    parsed.data.assessment;

  return {
    groundTruth,
    rubfake: findAssessor(assessments, (a) => a === "rubfake"),
    llm: findAssessor(
      assessments,
      (a) => a === "llm-ensemble" || a === "llm-probability",
    ),
    dismissalDifficulty,
    storedShouldReport: shouldReport,
  };
}

function computeMetrics(
  records: readonly LabeledRecord[],
  predict: (record: LabeledRecord) => boolean,
): Metrics {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;

  for (const record of records) {
    const predicted = predict(record);
    if (record.groundTruth && predicted) {
      truePositives += 1;
    } else if (!record.groundTruth && predicted) {
      falsePositives += 1;
    } else if (record.groundTruth && !predicted) {
      falseNegatives += 1;
    } else {
      trueNegatives += 1;
    }
  }

  const precision =
    truePositives + falsePositives === 0
      ? 0
      : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0
      ? 0
      : truePositives / (truePositives + falseNegatives);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return {
    precision,
    recall,
    f1,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
  };
}

function predictWith(
  record: LabeledRecord,
  assessors: AssessorsConfig,
  reportThreshold: number,
): boolean {
  const combined = combineAssessmentScores(
    record.rubfake,
    record.llm,
    assessors,
  );
  const effectiveThreshold = Math.max(
    reportThreshold,
    assessors.dismissalThresholds[record.dismissalDifficulty],
  );
  return combined >= effectiveThreshold;
}

function range(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  // Round to avoid floating-point drift accumulating across steps.
  for (let value = start; value <= end + 1e-9; value += step) {
    values.push(Math.round(value * 100) / 100);
  }
  return values;
}

// Grid-search the rubfake/llm combiner weight and the report threshold for the
// highest F1 against the labeled records. Other assessor parameters are held at
// their defaults — these two dominate the precision/recall trade-off.
function gridSearch(records: readonly LabeledRecord[]): TunedResult {
  const defaults = assessorsConfigSchema.parse({});
  let best: TunedResult | null = null;

  for (const rubfakeWeight of range(0, 1, 0.05)) {
    const llmWeight = Math.round((1 - rubfakeWeight) * 100) / 100;
    const assessors: AssessorsConfig = {
      ...defaults,
      rubfakeWeight,
      llmWeight,
    };
    for (const reportThreshold of range(-0.6, 0.6, 0.05)) {
      const metrics = computeMetrics(records, (record) =>
        predictWith(record, assessors, reportThreshold),
      );
      if (best === null || metrics.f1 > best.metrics.f1) {
        best = { rubfakeWeight, llmWeight, reportThreshold, metrics };
      }
    }
  }

  // `records` is non-empty when this is called, so a best is always found.
  if (best === null) {
    throw new Error("Grid search produced no result");
  }
  return best;
}

function parseLine(line: string): LabeledRecord | null {
  try {
    return toLabeledRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

async function loadLabeledRecords(feedbackPath: string): Promise<{
  labeled: LabeledRecord[];
  skipped: number;
}> {
  let raw: string;
  try {
    raw = await readFile(feedbackPath, "utf-8");
  } catch (error) {
    throw new Error(
      `No feedback file found at ${feedbackPath}. Run \`jittest catch\` first to collect assessment records.`,
      { cause: error },
    );
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const labeled: LabeledRecord[] = [];
  let skipped = 0;

  for (const line of lines) {
    const record = parseLine(line);
    if (record === null) {
      skipped += 1;
    } else {
      labeled.push(record);
    }
  }

  return { labeled, skipped };
}

function buildReport(
  labeled: readonly LabeledRecord[],
  skipped: number,
): CalibrationReport {
  const positives = labeled.filter((r) => r.groundTruth).length;
  const current = computeMetrics(labeled, (r) => r.storedShouldReport);
  const best = gridSearch(labeled);

  return {
    labeledCount: labeled.length,
    positives,
    negatives: labeled.length - positives,
    skipped,
    current,
    best,
  };
}

function formatMetrics(metrics: Metrics): string {
  return `precision=${metrics.precision.toFixed(2)} recall=${metrics.recall.toFixed(
    2,
  )} f1=${metrics.f1.toFixed(2)} (TP=${String(metrics.truePositives)} FP=${String(
    metrics.falsePositives,
  )} FN=${String(metrics.falseNegatives)} TN=${String(metrics.trueNegatives)})`;
}

function recommendedConfigBlock(best: TunedResult): string {
  return JSON.stringify(
    {
      reportThreshold: best.reportThreshold,
      assessors: {
        rubfakeWeight: best.rubfakeWeight,
        llmWeight: best.llmWeight,
      },
    },
    null,
    2,
  );
}

function formatConsole(report: CalibrationReport): string {
  const lines = [
    "jittest calibrate",
    `Labeled records: ${String(report.labeledCount)} (positive: ${String(
      report.positives,
    )}, negative: ${String(report.negatives)}, skipped: ${String(report.skipped)})`,
    `Current  ${formatMetrics(report.current)}`,
    `Best     ${formatMetrics(report.best.metrics)}`,
    "",
    "Recommended jittest.config.json block:",
    recommendedConfigBlock(report.best),
  ];
  return lines.join("\n");
}

function formatNoData(skipped: number): string {
  return `No labeled feedback records found (skipped ${String(
    skipped,
  )}). Set engineerFeedback.label on records (confirmed-true-positive / confirmed-false-positive / intended-change) before calibrating.`;
}

const writeStdout = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

async function runCalibrateCommand(
  options: CalibrateCommandOptions,
): Promise<void> {
  const feedbackPath = resolveFeedbackPath(options);
  const { labeled, skipped } = await loadLabeledRecords(feedbackPath);

  if (labeled.length === 0) {
    if (options.output === "json") {
      writeStdout(
        JSON.stringify({
          labeledCount: 0,
          skipped,
          message: "no-labeled-data",
        }),
      );
    } else {
      logger.warn(formatNoData(skipped));
      writeStdout(formatNoData(skipped));
    }
    return;
  }

  const report = buildReport(labeled, skipped);

  if (options.output === "json") {
    writeStdout(JSON.stringify(report));
    return;
  }

  writeStdout(formatConsole(report));
}

export type { CalibrationReport, LabeledRecord, Metrics, TunedResult };
export {
  buildReport,
  computeMetrics,
  gridSearch,
  labelToGroundTruth,
  loadLabeledRecords,
  predictWith,
  runCalibrateCommand,
  toLabeledRecord,
};
