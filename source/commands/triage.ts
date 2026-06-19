import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { createInterface, type Interface } from "node:readline/promises";

import type { TriageCommandOptions } from "../config.js";
import {
  type AssessmentFeedbackRecord,
  assessmentFeedbackRecordSchema,
} from "../runtime-schemas.js";

import { resolveFeedbackPath } from "./feedback-path.js";

type TriageLabel = NonNullable<TriageCommandOptions["label"]>;
type TriagePromptResult = TriageLabel | "quit" | null;

interface FeedbackLine {
  readonly raw: string;
  record: AssessmentFeedbackRecord | null;
  dirty: boolean;
}

const labelChoices: readonly TriageLabel[] = [
  "confirmed-true-positive",
  "confirmed-false-positive",
  "intended-change",
  "unknown",
];

const writeStdout = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

function parseFeedbackLine(raw: string): FeedbackLine {
  try {
    const parsed = assessmentFeedbackRecordSchema.safeParse(JSON.parse(raw));
    return {
      raw,
      record: parsed.success ? parsed.data : null,
      dirty: false,
    };
  } catch {
    return {
      raw,
      record: null,
      dirty: false,
    };
  }
}

async function loadFeedbackLines(
  feedbackPath: string,
): Promise<FeedbackLine[]> {
  const raw = await readFile(feedbackPath, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseFeedbackLine);
}

function matchesSelection(
  record: AssessmentFeedbackRecord,
  options: TriageCommandOptions,
): boolean {
  if (options.id !== undefined && record.id !== options.id) {
    return false;
  }

  if (options.runId !== undefined && record.runId !== options.runId) {
    return false;
  }

  return true;
}

function selectedRecords(
  lines: readonly FeedbackLine[],
  options: TriageCommandOptions,
): AssessmentFeedbackRecord[] {
  return lines
    .map((line) => line.record)
    .filter((record): record is AssessmentFeedbackRecord => record !== null)
    .filter((record) => matchesSelection(record, options));
}

function formatRecordList(
  records: readonly AssessmentFeedbackRecord[],
): string {
  if (records.length === 0) {
    return "No matching feedback records.";
  }

  const rows = records.map((record) =>
    [
      record.id,
      record.runId,
      record.assessment.verdict,
      record.engineerFeedback.label,
      record.weakCatch.behaviorChange.summary,
    ].join("\t"),
  );

  const header = ["id", "runId", "verdict", "label", "summary"].join("\t");
  return [header, ...rows].join("\n");
}

function applyLabel(
  record: AssessmentFeedbackRecord,
  label: TriageLabel,
  notes: string | undefined,
): AssessmentFeedbackRecord {
  return {
    ...record,
    engineerFeedback: {
      ...record.engineerFeedback,
      label,
      dismissedAt: label === "unknown" ? null : new Date().toISOString(),
      notes: notes ?? record.engineerFeedback.notes,
    },
  };
}

async function writeFeedbackLines(
  feedbackPath: string,
  lines: readonly FeedbackLine[],
): Promise<void> {
  // Only re-serialize records we actually relabeled. Untouched lines keep their
  // original bytes, so unknown/extra fields survive round-trips and the file
  // doesn't churn for records outside the --id/--run-id selection.
  const serialized = lines
    .map((line) =>
      line.dirty && line.record !== null
        ? JSON.stringify(line.record)
        : line.raw,
    )
    .join("\n");
  await writeFile(feedbackPath, `${serialized}\n`, "utf-8");
}

/* istanbul ignore next -- terminal-only interactive prompt */
async function promptForLabel(
  rl: Interface,
  record: AssessmentFeedbackRecord,
): Promise<TriagePromptResult> {
  writeStdout("");
  writeStdout(`${record.id} ${record.assessment.verdict}`);
  writeStdout(record.weakCatch.behaviorChange.summary);
  const answer = await rl.question(
    "Label: [t] true positive, [f] false positive, [i] intended, [u] unknown, [s] skip, [q] quit > ",
  );
  const normalized = answer.trim().toLowerCase();
  if (normalized === "t") {
    return "confirmed-true-positive";
  }
  if (normalized === "f") {
    return "confirmed-false-positive";
  }
  if (normalized === "i") {
    return "intended-change";
  }
  if (normalized === "u") {
    return "unknown";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return null;
}

/* istanbul ignore next -- terminal-only interactive prompt */
async function applyInteractiveLabels(
  lines: FeedbackLine[],
  records: readonly AssessmentFeedbackRecord[],
  options: TriageCommandOptions,
): Promise<number> {
  if (!process.stdin.isTTY) {
    throw new Error("Interactive triage requires a TTY");
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let updated = 0;
  try {
    for (const record of records) {
      const label = await promptForLabel(rl, record);
      if (label === "quit") {
        break;
      }
      if (label !== null) {
        for (const line of lines) {
          if (line.record?.id === record.id) {
            line.record = applyLabel(line.record, label, options.notes);
            line.dirty = true;
            updated += 1;
            break;
          }
        }
      }
    }
  } finally {
    rl.close();
  }

  return updated;
}

function applyNonInteractiveLabel(
  lines: FeedbackLine[],
  options: TriageCommandOptions,
): number {
  if (options.label === undefined) {
    throw new Error("Pass --label or use --interactive");
  }

  if (options.id === undefined && options.runId === undefined) {
    throw new Error("Pass --id or --run-id when applying a label");
  }

  let updated = 0;
  for (const line of lines) {
    if (line.record !== null && matchesSelection(line.record, options)) {
      line.record = applyLabel(line.record, options.label, options.notes);
      line.dirty = true;
      updated += 1;
    }
  }

  return updated;
}

async function runTriageCommand(options: TriageCommandOptions): Promise<void> {
  const feedbackPath = resolveFeedbackPath(options);
  const lines = await loadFeedbackLines(feedbackPath);
  const records = selectedRecords(lines, options);

  if (options.list) {
    writeStdout(formatRecordList(records));
    return;
  }

  const updated = options.interactive
    ? await applyInteractiveLabels(lines, records, options)
    : applyNonInteractiveLabel(lines, options);

  await writeFeedbackLines(feedbackPath, lines);
  writeStdout(`Updated ${String(updated)} feedback record(s).`);
}

export {
  applyLabel,
  formatRecordList,
  labelChoices,
  loadFeedbackLines,
  promptForLabel,
  runTriageCommand,
  selectedRecords,
};
