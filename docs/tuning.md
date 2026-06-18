# Tuning for signal quality

The four flags that determine whether `jittest` is useful or noisy are:

- `--risk-threshold` — *should we run at all?*
- `--report-threshold` — *should this catch reach a human?*
- `--tests-per-function` — *how many shots per change?*
- `--workflow` — *which generation strategy?*

This page is a recipe for landing on values that work for your repo.

## The two thresholds

`jittest` has two independent gates, and confusing them is the most
common source of "why am I getting nothing" or "why am I getting
everything" reports.

```text
diff
  │
  ▼
[risk score 0..1]  ─── below --risk-threshold? ──►  skip generation
  │
  ▼
[generate tests, run on parent+child, harvest weak catches]
  │
  ▼
[per-catch assessment score -1..1]  ─── below --report-threshold? ──►  silent
  │
  ▼
final report
```

The risk score is computed from sensitivity, complexity, coverage gap, and
defect history (see [the readme](../readme.md#2-risk-scoring)). The
assessment score is the weighted combination of `rubfake` rule output and
the LLM judge ensemble. They are not the same number and don't move
together.

## A staged rollout

This is the rollout we recommend for a team adopting `jittest` for the
first time:

### Week 1: observe

```sh
jittest catch \
  --risk-threshold 0 \
  --report-threshold -1 \
  --output json > /tmp/jittest.json
```

`--report-threshold -1` reports *everything*, including assessed false
positives. Don't post these as PR comments. Save the JSON artifacts and
the `assessment-records.jsonl` files for a week. The goal is data: how
many catches, of what verdicts, on which kinds of PRs.

### Week 2: pick a reporting floor

Inspect a sample of weak catches by hand. For each, write down whether you
think it's a true positive (a regression an engineer would want to know
about) or a false positive (brittle, infra failure, intent-aligned change,
etc.). Then plot or simply sort the catches by `assessment.combinedScore`
and pick the lowest score above which true positives dominate. That's
your `--report-threshold` candidate. Common landing zones:

| Threshold | What gets through |
| --- | --- |
| `0.0` | Anything labelled `uncertain` or better. Noisy. |
| `0.3` | `likely-strong` and `strong-catch`. Reasonable starting point. |
| `0.6` | Only `strong-catch`. Very low volume, very high signal. |

### Week 3: add a risk floor

If your CI bill is bigger than you want, raise `--risk-threshold` to skip
generation entirely on low-risk diffs. Pick the value from JSON output:
look at the `stats.diffRiskScore` for PRs you wish *hadn't* run, and
choose a threshold above them. Common values are `0.2` to `0.4`. Above
`0.5`, you'll skip a lot of legitimate refactors.

Risk threshold is a cost knob, not a quality knob. Setting it too high
just means you never run on small bug fixes — which are often exactly the
diffs that benefit most.

## `--tests-per-function`

This sets the number of LLM-generated candidates per changed function or
inferred risk target. The default of `3` is a reasonable balance between
shot diversity and cost.

- **Lower (1–2)** for cost-sensitive setups or large diffs. You will
  catch fewer regressions but pay proportionally less. Acceptable when
  combined with `--workflow intent-aware` because intent-aware
  generation is already targeted.
- **Higher (4–6)** when you have a small, high-stakes surface (auth,
  billing, money-handling). More shots improve the chance of catching
  subtle behavior changes.

Don't raise this above 6 without also raising `--max-total-tests` —
otherwise the cap silently truncates your candidates.

## `--workflow`: when to choose what

| Workflow | Best for | Trade-off |
| --- | --- | --- |
| `dodgy-diff` | Routine diffs, refactors, bug fixes | Cheaper, faster, but produces more brittle tests because it doesn't reason about intent |
| `intent-aware` | High-impact PRs where you can supply title, body, and context files | More expensive (more LLM calls, mutant validation step), much better at distinguishing intentional change from regression |
| `both` (default) | When budget allows and you want the best of both | Roughly doubles cost relative to `dodgy-diff` alone |

In CI, many teams run `both` on all PRs and live with the cost. If that
isn't viable, a useful split is:

- `dodgy-diff` for everyone.
- `intent-aware` only when the diff touches `src/auth/**`, `src/billing/**`,
  or anything else on a curated sensitive-paths list. Wire this with two
  workflow jobs and the appropriate `--include` globs.

## The `rubfake` and LLM judge knobs

Both assessment passes are on by default. You almost never want to turn
them off in production. The pipeline is designed so that:

- `rubfake` catches obvious infra failures, broken mocks, type errors in
  generated tests, snapshot brittleness, and implementation-detail
  assertions — cheaply and locally.
- The LLM judge ensemble decides whether the failure looks like an
  unintended behavior change given the diff intent.

If you disable `rubfake` (via `loadConfig({ rubfakeEnabled: false })`),
you will pay more in tokens for the LLM judge to re-derive the same
filters. If you disable the LLM judge, you lose the verdict mapping
entirely and effectively just use `rubfake`'s rule score.

## `report-threshold` is clamped by `dismissalDifficulty`

The pipeline internally raises your `--report-threshold` for catches
whose behavior change is "easy to dismiss as intentional":

| `dismissalDifficulty` | Effective minimum threshold |
| --- | --- |
| `trivial` (boolean flip) | `-0.2` |
| `easy` (null introduced, return value changed) | `0.0` |
| `moderate` (exception added/removed, default) | `0.3` |
| `hard` (output shape, ordering) | `0.5` |

So even if you set `--report-threshold -1`, you won't see every weak
catch — `hard` ones still need `0.5`. This is intentional: a passing
generated test that fails on an ordering change is very often a brittle
test, not a real regression. Don't try to fight this with a lower flag;
adjust the source code if you really want.

## Recipes

**Low-noise, low-cost first pass:**

```sh
jittest catch \
  --workflow dodgy-diff \
  --risk-threshold 0.3 \
  --report-threshold 0.5 \
  --tests-per-function 2 \
  --max-total-tests 20
```

**High-signal review of a sensitive PR:**

```sh
jittest catch \
  --workflow intent-aware \
  --risk-threshold 0 \
  --report-threshold 0.3 \
  --tests-per-function 5 \
  --pr-title "$PR_TITLE" \
  --pr-body "$PR_BODY" \
  --context-file docs/auth-invariants.md
```

**Bulk evaluation against a feedback corpus:**

```sh
jittest catch \
  --workflow both \
  --risk-threshold 0 \
  --report-threshold -1 \
  --feedback-path artifacts/jittest-$(git rev-parse --short HEAD).jsonl \
  --output json > "artifacts/jittest-$(git rev-parse --short HEAD).json"
```

## Tuning the assessors

The two thresholds above gate *reporting*. The `assessors` block controls how
the combined score that those thresholds act on is computed. It lives in
`jittest.config.json`:

```json
{
  "assessors": {
    "rubfakeWeight": 0.4,
    "llmWeight": 0.6,
    "rubfakeOverrideScore": -0.8,
    "verdictThresholds": { "strongCatch": 0.6, "likelyStrong": 0.3, "uncertain": -0.3, "likelyFalsePositive": -0.6 },
    "dismissalThresholds": { "trivial": -0.2, "easy": 0, "moderate": 0.3, "hard": 0.5 }
  }
}
```

- `rubfakeWeight` / `llmWeight` weight the rule-based and LLM-judge scores in
  the combined score. Raise `rubfakeWeight` if you trust the static rules more
  than the judge (cheaper, more deterministic); raise `llmWeight` for the
  reverse.
- `rubfakeOverrideScore` is the rule-based score at or below which a
  high-confidence false-positive shortcuts the judge entirely.
- `verdictThresholds` map the combined score to a verdict label.
- `dismissalThresholds` raise the effective report threshold for catches that
  are easy to dismiss (a trivial boolean flip must clear a lower bar than a
  hard-to-triage ordering change).

Rather than guessing, label some feedback records and let
[`jittest calibrate`](../readme.md#calibration) grid-search these weights and a
report threshold against your labels. It prints precision/recall/F1 for the
current config versus the best it found, plus a ready-to-paste block.

## Dropping flaky catches

A generated test that only *sometimes* passes on the parent can masquerade as a
weak catch (passes on parent, "fails" on child) when really it is just
non-deterministic. `--flake-guard-runs N` re-runs every candidate `N` times on
the parent and drops any that are not green on all `N` runs, before dual
execution. Start at `--flake-guard-runs 3` if you see catches that do not
reproduce; it trades extra parent runs for a cleaner signal.
