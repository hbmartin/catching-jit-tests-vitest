# Triage workflow

A weak catch report is an *invitation* to look at the diff again, not a
verdict that the diff is wrong. This page describes what the report
means, how engineers should respond, and how the team's collective
triage feeds back into threshold tuning.

## Reading a report

A weak catch comes with:

- **Behavior change summary.** A one-line description of what the
  generated test exposed: a boolean flip, a new null, a changed return
  value, a new or removed exception, an output-shape change, or a
  generic difference.
- **Verdict.** One of `strong-catch`, `likely-strong`, `uncertain`,
  `likely-false-positive`, `false-positive`. This is derived from the
  combined assessment score.
- **Combined score.** `[-1, +1]`. Negative is false-positive direction;
  positive is real-catch direction.
- **Dismissal difficulty.** `trivial`, `easy`, `moderate`, `hard`.
  Reflects how easy it is to write off the catch as "yeah but I meant to
  do that." Trivial dismissal (a boolean flip) needs more evidence to
  bother reporting; hard dismissal (an ordering change) needs less.
- **Generated test code, parent result, child result.** What the LLM
  wrote and what happened on each side.

In `--output console`, you get the human-readable summary. In `--output json`,
you get all of the above plus the underlying `assessments` array showing
individual `rubfake` and LLM-judge contributions.

## Verdict cheat-sheet

| Verdict | Score | Typical action |
| --- | --- | --- |
| `strong-catch` | `>= 0.6` | Investigate seriously. The model and the rules both think this is real. |
| `likely-strong` | `>= 0.3` | Read the diff with the test in mind. If you can't immediately defend the behavior change, dig further. |
| `uncertain` | `>= -0.3` | Usually skip unless the touched code is sensitive. Use your own judgement. |
| `likely-false-positive` | `>= -0.6` | Skip. Glance at the report only if domain knowledge tells you otherwise. |
| `false-positive` | `< -0.6` | Skip. Don't waste reviewer time. |

The `--report-threshold` default is `0`, but in our experience teams
should not look at anything below `0.3` once they're past the initial
calibration period.

## A four-step triage

For each reported weak catch:

1. **Does the test even make sense for this code?**
   Open the generated test. If it imports something that doesn't exist,
   asserts on a private implementation detail, or mocks something
   structurally, it's a false positive even if the score is high. Mark
   it as such and move on.

2. **Is the asserted parent behavior the actual contract?**
   Generated tests sometimes assert "the thing the code happened to do"
   rather than "the thing the function is supposed to do." If the
   asserted parent behavior is itself accidental, the catch is noise.

3. **Was the behavior change intentional?**
   This is where PR context matters most. If your PR title and body
   describe exactly the behavior change the test caught — "switch from
   throwing to returning null on missing user" — then it's intent-
   aligned. (The `intent-aware` workflow tries to filter these
   automatically, but it isn't perfect.)

4. **If the behavior change is real and unintentional: fix the code,
   not the test.** Don't add the generated test to your suite verbatim —
   it was written by an LLM in a few seconds. Use it as a starting
   point: write a proper test that pins down the contract, then fix the
   regression.

## Hardening candidates

JSON output includes `hardeningCandidates`: generated tests that pass
on *both* sides. These are not regressions, but they are tests the LLM
considered worth writing and which your existing suite did not cover.

Occasionally a hardening candidate is a genuinely good test that
deserves a home in your real suite. More often it's a redundant or
implementation-detail test. We recommend skimming them only when your
coverage on a sensitive area is known to be thin — there's no need to
look at every one.

## Feedback records

Each assessed weak catch is appended to
`.jittest/assessment-records.jsonl` (configurable via
`--feedback-path`). The schema includes everything from the
report plus a placeholder `engineerFeedback` object for human-supplied
labels.

The intended loop is:

1. Run `jittest` in CI. Records get appended.
2. After triage, mark records by hand or via a lightweight tool.
3. Periodically analyze the records to:
   - measure precision at your current `--report-threshold`,
   - tune the threshold up or down,
   - identify common false-positive patterns to add to
     [`rubfake`](../source/assessors/rubfake.ts).

A minimal labelling script:

```ts
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync(".jittest/assessment-records.jsonl", "utf-8")
  .split("\n")
  .filter(Boolean);

const labelled = lines.map((line) => {
  const record = JSON.parse(line);
  // ... show to a human, collect verdict, mutate engineerFeedback
  return JSON.stringify(record);
});

writeFileSync(".jittest/assessment-records.labelled.jsonl",
  labelled.join("\n") + "\n");
```

## Persisting records across CI runs

By default the feedback file lives inside the workspace, so it's
ephemeral on each CI runner. To accumulate longitudinal data:

- Upload the file as a CI artifact every run (see the workflow example
  in [`ci-integration.md`](./ci-integration.md)).
- Or write to an external store from a post-step:

  ```sh
  aws s3 cp .jittest/assessment-records.jsonl \
    "s3://my-bucket/jittest/$(date +%Y/%m/%d)/$(uuidgen).jsonl"
  ```

Once you have a few weeks of records, calibrating `--report-threshold`
becomes a data exercise rather than a guess.

## What to do with a steady stream of false positives

If `false-positive` and `likely-false-positive` verdicts dominate the
records (which is normal at first), the right move is *not* to disable
`jittest`. In order of preference:

1. Raise `--report-threshold` so humans only see catches above the
   noise floor. This is the main lever.
2. Raise `--risk-threshold` so low-risk PRs don't even generate.
3. Always supply `--pr-title`, `--pr-body`, and any relevant
   `--context-file` paths. Intent-aware filtering depends on this.
4. Investigate whether a specific class of false positive could be
   handled by a new rule in `rubfake`. Look for patterns in the
   `assessment.assessments[*].detectedPatterns` arrays.

The goal is a state where every report a reviewer looks at is worth
the 30 seconds it takes to evaluate it.
