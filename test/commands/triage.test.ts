import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatRecordList,
  loadFeedbackLines,
  promptForLabel,
  runTriageCommand,
  selectedRecords,
} from "../../source/commands/triage.js";
import { buildAssessmentFeedbackRecord } from "../../source/feedback/store.js";
import type { AssessmentFeedbackRecord } from "../../source/runtime-schemas.js";

const { questionMock, closeMock } = vi.hoisted(() => ({
  questionMock: vi.fn(),
  closeMock: vi.fn(),
}));

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question: questionMock, close: closeMock }),
}));

function makeRecord(runId: string): AssessmentFeedbackRecord {
  return buildAssessmentFeedbackRecord({
    runId,
    recordedAt: "2026-05-17T00:00:00.000Z",
    baseRef: "origin/main",
    headRef: "HEAD",
    workflow: "both",
    diff: {
      rawDiff: "+return false;",
      pr: {
        title: "Refactor auth",
        body: "",
        branch: "HEAD",
        baseSha: "base",
        headSha: "head",
      },
      files: [],
      riskScore: 0.7,
      changedSymbols: [],
    },
    weakCatch: {
      test: {
        code: "it('keeps behavior', () => {});",
        targetSymbol: "isAllowed",
        testFilePath: "source/auth.jittest.test.ts",
        behaviorDescription: "Access remains enabled",
        workflow: "dodgy-diff",
        generatorConfidence: 0.8,
      },
      parentResult: {
        testFile: "source/auth.jittest.test.ts",
        testName: "keeps behavior",
        status: "passed",
        failureMessage: "",
        duration: 1,
        failureAnalysis: null,
      },
      childResult: {
        testFile: "source/auth.jittest.test.ts",
        testName: "keeps behavior",
        status: "failed",
        failureMessage: "expected false to be true",
        duration: 1,
        failureAnalysis: null,
      },
      behaviorChange: {
        summary: "Boolean result flipped",
        parentBehavior: "true",
        childBehavior: "false",
        changeType: "boolean-flipped",
      },
    },
    assessment: {
      assessments: [],
      combinedScore: 0.8,
      verdict: "strong-catch",
      shouldReport: true,
      dismissalDifficulty: "trivial",
    },
  });
}

describe("runTriageCommand", () => {
  let dir: string | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    questionMock.mockReset();
    closeMock.mockReset();
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("labels matching records by run id", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-triage-"));
    const feedbackPath = path.join(dir, "records.jsonl");
    const first = makeRecord("run-1");
    const second = makeRecord("run-2");
    await writeFile(
      feedbackPath,
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
      "utf-8",
    );

    await runTriageCommand({
      cwd: dir,
      feedbackPath,
      runId: "run-1",
      label: "confirmed-true-positive",
      notes: "real regression",
      list: false,
      interactive: false,
    });

    const [updatedFirst, updatedSecond] = (
      await readFile(feedbackPath, "utf-8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(updatedFirst.engineerFeedback).toMatchObject({
      label: "confirmed-true-positive",
      notes: "real regression",
    });
    expect(updatedFirst.engineerFeedback.dismissedAt).toEqual(
      expect.any(String),
    );
    expect(updatedSecond.engineerFeedback.label).toBe("unknown");
  });

  it("preserves unrelabeled records verbatim but drops blank lines", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-triage-"));
    const feedbackPath = path.join(dir, "records.jsonl");
    // A record with an extra field the schema does not model.
    const untouched = JSON.stringify({
      ...makeRecord("run-2"),
      extraField: "must-survive",
    });
    const target = JSON.stringify(makeRecord("run-1"));
    // Blank line between the records: it is filtered on load, not preserved.
    await writeFile(feedbackPath, `${target}\n\n${untouched}\n`, "utf-8");

    await runTriageCommand({
      cwd: dir,
      feedbackPath,
      runId: "run-1",
      label: "confirmed-true-positive",
      list: false,
      interactive: false,
    });

    const outputLines = (await readFile(feedbackPath, "utf-8"))
      .trim()
      .split("\n");
    // Only the two records remain; the blank line was dropped on load.
    expect(outputLines).toHaveLength(2);
    const [, secondLine] = outputLines;
    // The non-matched line is rewritten verbatim, including the unknown field.
    expect(secondLine).toBe(untouched);
    expect(JSON.parse(secondLine).extraField).toBe("must-survive");
  });

  it("lists matching records", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-triage-"));
    const feedbackPath = path.join(dir, "records.jsonl");
    await writeFile(feedbackPath, `${JSON.stringify(makeRecord("run-1"))}\n`);
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await runTriageCommand({
      cwd: dir,
      feedbackPath,
      runId: "run-1",
      list: true,
      interactive: false,
    });

    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("Boolean result flipped"),
    );
  });

  it("keeps unparseable feedback lines instead of dropping them", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-triage-"));
    const feedbackPath = path.join(dir, "records.jsonl");
    const valid = JSON.stringify(makeRecord("run-1"));
    // First line: valid JSON that fails the schema. Second: not JSON at all.
    await writeFile(
      feedbackPath,
      `${valid}\n{"not":"a record"}\n{ broken json\n`,
      "utf-8",
    );

    const lines = await loadFeedbackLines(feedbackPath);

    expect(lines).toHaveLength(3);
    expect(lines[0]?.record?.runId).toBe("run-1");
    expect(lines[1]?.record).toBeNull();
    expect(lines[2]?.record).toBeNull();
    // The raw text survives so a rewrite preserves lines triage cannot model.
    expect(lines[2]?.raw).toBe("{ broken json");
  });

  it("selects records by id, excluding non-matching ids", () => {
    const first = makeRecord("run-1");
    const second = makeRecord("run-2");
    const lines = [first, second].map((record) => ({
      raw: JSON.stringify(record),
      record,
      dirty: false,
    }));

    const selected = selectedRecords(lines, { id: first.id } as Parameters<
      typeof selectedRecords
    >[1]);

    expect(selected).toEqual([first]);
  });

  it("reports when no records match for listing", () => {
    expect(formatRecordList([])).toBe("No matching feedback records.");
  });

  it("requires a label when not running interactively", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-triage-"));
    const feedbackPath = path.join(dir, "records.jsonl");
    await writeFile(feedbackPath, `${JSON.stringify(makeRecord("run-1"))}\n`);

    await expect(
      runTriageCommand({
        cwd: dir,
        feedbackPath,
        runId: "run-1",
        list: false,
        interactive: false,
      }),
    ).rejects.toThrow("Pass --label or use --interactive");
  });

  it("requires an id or run id when applying a label", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-triage-"));
    const feedbackPath = path.join(dir, "records.jsonl");
    await writeFile(feedbackPath, `${JSON.stringify(makeRecord("run-1"))}\n`);

    await expect(
      runTriageCommand({
        cwd: dir,
        feedbackPath,
        label: "confirmed-true-positive",
        list: false,
        interactive: false,
      }),
    ).rejects.toThrow("Pass --id or --run-id when applying a label");
  });

  it("allows interactive triage to quit early", async () => {
    const question = vi.fn(async () => "q");
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const result = await promptForLabel(
      { question } as unknown as Parameters<typeof promptForLabel>[0],
      makeRecord("run-1"),
    );

    expect(result).toBe("quit");
    expect(question).toHaveBeenCalledWith(expect.stringContaining("[q] quit"));
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("Boolean result flipped"),
    );
  });

  it("stops interactive labeling once the user quits", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jittest-triage-"));
    const feedbackPath = path.join(dir, "records.jsonl");
    const first = makeRecord("run-1");
    const second = makeRecord("run-2");
    await writeFile(
      feedbackPath,
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
      "utf-8",
    );

    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // Label the first record, then quit before reaching the second.
    questionMock.mockResolvedValueOnce("t").mockResolvedValueOnce("q");

    try {
      await runTriageCommand({
        cwd: dir,
        feedbackPath,
        list: false,
        interactive: true,
      });
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }

    expect(closeMock).toHaveBeenCalled();
    const [labeledFirst, labeledSecond] = (
      await readFile(feedbackPath, "utf-8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(labeledFirst.engineerFeedback.label).toBe("confirmed-true-positive");
    // Quitting broke the loop before the second record could be relabeled.
    expect(labeledSecond.engineerFeedback.label).toBe("unknown");
  });
});
