import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { AggregatedAssessment } from "../../source/assessors/types.js";
import type { DiffContext } from "../../source/diff/types.js";
import {
  appendAssessmentFeedbackRecord,
  buildAssessmentFeedbackRecord,
} from "../../source/feedback/store.js";
import type { WeakCatch } from "../../source/harvest/types.js";

const weakCatch: WeakCatch = {
  test: {
    code: "it('keeps access enabled', () => expect(isAllowed()).toBe(true));",
    targetSymbol: "isAllowed",
    testFilePath: "source/auth.12345678.jittest.test.ts",
    behaviorDescription: "Access remains enabled",
    workflow: "dodgy-diff",
    generatorConfidence: 0.8,
  },
  parentResult: {
    testFile: "source/auth.12345678.jittest.test.ts",
    testName: "keeps access enabled",
    status: "passed",
    failureMessage: "",
    duration: 5,
    failureAnalysis: null,
  },
  childResult: {
    testFile: "source/auth.12345678.jittest.test.ts",
    testName: "keeps access enabled",
    status: "failed",
    failureMessage: "expected false to be true",
    duration: 6,
    failureAnalysis: null,
  },
  behaviorChange: {
    summary: "Boolean result flipped from true to false",
    parentBehavior: "Returns true",
    childBehavior: "Returns false",
    changeType: "boolean-flipped",
  },
};

const assessment: AggregatedAssessment = {
  assessments: [
    {
      score: 0.7,
      rationale: "Boolean changed unexpectedly.",
      detectedPatterns: [
        {
          name: "changed_bool",
          direction: "true-positive",
          confidence: "medium",
          evidence: "Boolean flipped",
        },
      ],
      assessor: "rubfake",
    },
  ],
  combinedScore: 0.7,
  verdict: "strong-catch",
  shouldReport: true,
  dismissalDifficulty: "trivial",
};

const diff: DiffContext = {
  rawDiff: "diff --git a/source/auth.ts b/source/auth.ts",
  pr: {
    title: "Refactor auth checks",
    body: "No behavior change intended.",
    branch: "feature/auth",
    baseSha: "base",
    headSha: "head",
  },
  files: [],
  riskScore: 0.7,
  riskFactors: {
    sensitivityScore: 0.9,
    complexityScore: 0.2,
    coverageGap: 0,
    defectHistory: 0,
  },
  riskReasons: ["Touches authentication or session logic."],
  changedSymbols: [],
};

describe("assessment feedback store", () => {
  it("builds stable feedback records with unknown engineer feedback", () => {
    const record = buildAssessmentFeedbackRecord({
      runId: "run-1",
      recordedAt: "2026-05-17T00:00:00.000Z",
      baseRef: "origin/main",
      headRef: "HEAD",
      workflow: "both",
      diff,
      weakCatch,
      assessment,
    });

    expect(record).toMatchObject({
      id: "63182598e6d2e96e",
      engineerFeedback: {
        label: "unknown",
        dismissedAt: null,
        dismissalSeconds: null,
        notes: null,
      },
    });
  });

  it("appends JSONL feedback records", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "jittest-feedback-"));
    const feedbackPath = path.join(dir, "nested", "feedback.jsonl");
    const record = buildAssessmentFeedbackRecord({
      runId: "run-1",
      recordedAt: "2026-05-17T00:00:00.000Z",
      baseRef: "origin/main",
      headRef: "HEAD",
      workflow: "both",
      diff,
      weakCatch,
      assessment,
    });

    await appendAssessmentFeedbackRecord(feedbackPath, record);

    const lines = (await readFile(feedbackPath, "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: record.id,
      runId: "run-1",
      engineerFeedback: { label: "unknown" },
    });
  });
});
