import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AggregatedAssessment,
  Assessment,
} from "../../source/assessors/types.js";
import {
  buildReport,
  computeMetrics,
  gridSearch,
  type LabeledRecord,
  labelToGroundTruth,
  loadLabeledRecords,
  runCalibrateCommand,
  toLabeledRecord,
} from "../../source/commands/calibrate.js";
import type { DiffContext } from "../../source/diff/types.js";
import { buildAssessmentFeedbackRecord } from "../../source/feedback/store.js";
import type { WeakCatch } from "../../source/harvest/types.js";

type Label =
  | "confirmed-true-positive"
  | "confirmed-false-positive"
  | "intended-change"
  | "unknown";

const diff: DiffContext = {
  rawDiff: "diff --git a/source/auth.ts b/source/auth.ts",
  pr: {
    title: "Refactor auth",
    body: "No behavior change intended",
    branch: "feature",
    baseSha: "base",
    headSha: "head",
  },
  files: [],
  riskScore: 0.7,
  changedSymbols: [],
};

const makeAssessment = (
  rubfakeScore: number,
  llmScore: number,
  shouldReport: boolean,
): AggregatedAssessment => {
  const assessments: Assessment[] = [
    {
      score: rubfakeScore,
      rationale: "rubfake",
      detectedPatterns: [],
      assessor: "rubfake",
    },
    {
      score: llmScore,
      rationale: "llm",
      detectedPatterns: [],
      assessor: "llm-ensemble",
    },
  ];
  return {
    assessments,
    combinedScore: rubfakeScore * 0.4 + llmScore * 0.6,
    verdict: "uncertain",
    shouldReport,
    dismissalDifficulty: "trivial",
  };
};

const makeWeakCatch = (symbol: string): WeakCatch => ({
  test: {
    code: "it('x', () => {})",
    targetSymbol: symbol,
    testFilePath: `source/${symbol}.jittest.test.ts`,
    behaviorDescription: "behavior",
    workflow: "dodgy-diff",
    generatorConfidence: 0.8,
  },
  parentResult: {
    testFile: `source/${symbol}.jittest.test.ts`,
    testName: "behavior",
    status: "passed",
    failureMessage: "",
    duration: 1,
    failureAnalysis: null,
  },
  childResult: {
    testFile: `source/${symbol}.jittest.test.ts`,
    testName: "behavior",
    status: "failed",
    failureMessage: "boom",
    duration: 1,
    failureAnalysis: null,
  },
  behaviorChange: {
    summary: "flipped",
    parentBehavior: "true",
    childBehavior: "false",
    changeType: "boolean-flipped",
  },
});

const makeRecord = (input: {
  symbol: string;
  label: Label;
  rubfakeScore: number;
  llmScore: number;
  shouldReport: boolean;
}): Record<string, unknown> => {
  const record = buildAssessmentFeedbackRecord({
    runId: `run-${input.symbol}`,
    recordedAt: "2026-05-17T00:00:00.000Z",
    baseRef: "origin/main",
    headRef: "HEAD",
    workflow: "dodgy-diff",
    diff,
    weakCatch: makeWeakCatch(input.symbol),
    assessment: makeAssessment(
      input.rubfakeScore,
      input.llmScore,
      input.shouldReport,
    ),
  });
  return {
    ...record,
    engineerFeedback: { ...record.engineerFeedback, label: input.label },
  };
};

const labeled = (
  groundTruth: boolean,
  storedShouldReport: boolean,
): LabeledRecord => ({
  groundTruth,
  rubfake: null,
  llm: null,
  dismissalDifficulty: "trivial",
  storedShouldReport,
});

describe("labelToGroundTruth", () => {
  it("maps engineer labels to ground truth", () => {
    expect(labelToGroundTruth("confirmed-true-positive")).toBe(true);
    expect(labelToGroundTruth("confirmed-false-positive")).toBe(false);
    expect(labelToGroundTruth("intended-change")).toBe(false);
    expect(labelToGroundTruth("unknown")).toBeNull();
  });
});

describe("computeMetrics", () => {
  it("computes precision, recall and f1", () => {
    const records = [
      labeled(true, true), // TP
      labeled(true, false), // FN
      labeled(false, true), // FP
      labeled(false, false), // TN
    ];
    const metrics = computeMetrics(records, (r) => r.storedShouldReport);
    expect(metrics.truePositives).toBe(1);
    expect(metrics.falsePositives).toBe(1);
    expect(metrics.falseNegatives).toBe(1);
    expect(metrics.trueNegatives).toBe(1);
    expect(metrics.precision).toBeCloseTo(0.5);
    expect(metrics.recall).toBeCloseTo(0.5);
    expect(metrics.f1).toBeCloseTo(0.5);
  });
});

describe("toLabeledRecord", () => {
  it("extracts assessors and ground truth from a labeled record", () => {
    const record = makeRecord({
      symbol: "a",
      label: "confirmed-true-positive",
      rubfakeScore: 0.2,
      llmScore: 0.9,
      shouldReport: true,
    });
    const result = toLabeledRecord(record);
    expect(result).not.toBeNull();
    expect(result?.groundTruth).toBe(true);
    expect(result?.rubfake?.score).toBe(0.2);
    expect(result?.llm?.score).toBe(0.9);
  });

  it("returns null for unknown labels and malformed records", () => {
    const unknownRecord = makeRecord({
      symbol: "b",
      label: "unknown",
      rubfakeScore: 0,
      llmScore: 0,
      shouldReport: false,
    });
    expect(toLabeledRecord(unknownRecord)).toBeNull();
    expect(toLabeledRecord({ not: "a record" })).toBeNull();
  });
});

describe("gridSearch", () => {
  it("finds weights that separate the classes", () => {
    // The LLM score perfectly separates classes; rubfake is anti-correlated.
    const records: LabeledRecord[] = [
      {
        groundTruth: true,
        rubfake: {
          score: -0.5,
          rationale: "",
          detectedPatterns: [],
          assessor: "rubfake",
        },
        llm: {
          score: 1,
          rationale: "",
          detectedPatterns: [],
          assessor: "llm-ensemble",
        },
        dismissalDifficulty: "trivial",
        storedShouldReport: false,
      },
      {
        groundTruth: false,
        rubfake: {
          score: 0.5,
          rationale: "",
          detectedPatterns: [],
          assessor: "rubfake",
        },
        llm: {
          score: -1,
          rationale: "",
          detectedPatterns: [],
          assessor: "llm-ensemble",
        },
        dismissalDifficulty: "trivial",
        storedShouldReport: true,
      },
    ];

    const best = gridSearch(records);
    expect(best.metrics.f1).toBeCloseTo(1);
    expect(best.llmWeight).toBeGreaterThan(best.rubfakeWeight);
  });
});

describe("loadLabeledRecords and runCalibrateCommand", () => {
  let dir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const writeRecords = async (records: Record<string, unknown>[]) => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-calibrate-"));
    const feedbackPath = path.join(dir, "records.jsonl");
    const body = records.map((r) => JSON.stringify(r)).join("\n");
    await writeFile(feedbackPath, `${body}\n`, "utf-8");
    return feedbackPath;
  };

  it("loads labeled records and skips unknown/invalid lines", async () => {
    const feedbackPath = await writeRecords([
      makeRecord({
        symbol: "a",
        label: "confirmed-true-positive",
        rubfakeScore: 0.2,
        llmScore: 0.9,
        shouldReport: true,
      }),
      makeRecord({
        symbol: "b",
        label: "unknown",
        rubfakeScore: 0,
        llmScore: 0,
        shouldReport: false,
      }),
    ]);
    // Append a malformed line.
    await writeFile(feedbackPath, "not json\n", { flag: "a" });

    const { labeled: loaded, skipped } = await loadLabeledRecords(feedbackPath);
    expect(loaded).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("builds a report comparing current to tuned metrics", () => {
    const records: LabeledRecord[] = [
      labeled(true, true),
      labeled(false, true),
      labeled(true, false),
    ];
    const report = buildReport(records, 0);
    expect(report.labeledCount).toBe(3);
    expect(report.positives).toBe(2);
    expect(report.negatives).toBe(1);
    expect(report.best.metrics.f1).toBeGreaterThanOrEqual(report.current.f1);
  });

  it("prints a recommended config block to stdout", async () => {
    const feedbackPath = await writeRecords([
      makeRecord({
        symbol: "a",
        label: "confirmed-true-positive",
        rubfakeScore: 0.2,
        llmScore: 0.9,
        shouldReport: true,
      }),
      makeRecord({
        symbol: "c",
        label: "confirmed-false-positive",
        rubfakeScore: -0.2,
        llmScore: -0.9,
        shouldReport: false,
      }),
    ]);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    await runCalibrateCommand({
      feedbackPath,
      output: "console",
      cwd: ".",
    });

    const out = writes.join("");
    expect(out).toContain("Recommended jittest.config.json block");
    expect(out).toContain("rubfakeWeight");
  });

  it("reports no-data when every record is unlabeled", async () => {
    const feedbackPath = await writeRecords([
      makeRecord({
        symbol: "u",
        label: "unknown",
        rubfakeScore: 0.1,
        llmScore: 0.1,
        shouldReport: false,
      }),
    ]);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    await runCalibrateCommand({ feedbackPath, output: "console", cwd: "." });
    expect(writes.join("")).toContain("No labeled feedback records");
  });

  it("emits no-data JSON when every record is unlabeled", async () => {
    const feedbackPath = await writeRecords([
      makeRecord({
        symbol: "u",
        label: "unknown",
        rubfakeScore: 0.1,
        llmScore: 0.1,
        shouldReport: false,
      }),
    ]);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    await runCalibrateCommand({ feedbackPath, output: "json", cwd: "." });
    const parsed = JSON.parse(writes.join("").trim());
    expect(parsed).toMatchObject({
      labeledCount: 0,
      message: "no-labeled-data",
    });
  });

  it("throws a helpful error when the feedback file is missing", async () => {
    await expect(
      loadLabeledRecords(path.join(tmpdir(), "jittest-does-not-exist.jsonl")),
    ).rejects.toThrow(/No feedback file found/);
  });

  it("emits JSON when requested", async () => {
    const feedbackPath = await writeRecords([
      makeRecord({
        symbol: "a",
        label: "confirmed-true-positive",
        rubfakeScore: 0.2,
        llmScore: 0.9,
        shouldReport: true,
      }),
    ]);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    await runCalibrateCommand({ feedbackPath, output: "json", cwd: "." });

    const parsed = JSON.parse(writes.join("").trim());
    expect(parsed.labeledCount).toBe(1);
    expect(parsed.best).toHaveProperty("rubfakeWeight");
  });
});
