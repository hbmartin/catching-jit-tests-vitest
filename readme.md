# catching-jit-tests-vitest

[![npm version](https://badge.fury.io/js/catching-jit-tests-vitest.svg)](https://www.npmjs.com/package/catching-jit-tests-vitest)
[![ci](https://github.com/hbmartin/catching-jit-tests-vitest/actions/workflows/ci.yml/badge.svg)](https://github.com/hbmartin/catching-jit-tests-vitest/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/hbmartin/catching-jit-tests-vitest/graph/badge.svg?token=Po1nDYEr5f)](https://codecov.io/gh/hbmartin/catching-jit-tests-vitest)
[![NPM License](https://img.shields.io/npm/l/catching-jit-tests-vitest?color=blue)](https://github.com/hbmartin/catching-jit-tests-vitest/blob/main/LICENSE)
[![Context7](https://img.shields.io/badge/[]-Context7-059669)](https://context7.com/hbmartin/catching-jit-tests-vitest)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/hbmartin/catching-jit-tests-vitest)

Generate just-in-time Vitest tests for a git diff, run those tests on both
sides of the change, and report the generated tests that expose behavior that
changed from the parent branch to the PR branch.

This package provides the `jittest` CLI and a set of TypeScript building blocks
for diff analysis, generated test execution, weak-catch harvesting, and
false-positive filtering.

## Contents

- [What this does](#what-this-does)
- [Core idea](#core-idea)
- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [CLI usage](#cli-usage)
- [Examples](#examples)
- [How the pipeline works](#how-the-pipeline-works)
- [Output formats](#output-formats)
- [Configuration](#configuration)
- [Feedback records](#feedback-records)
- [Triage](#triage)
- [Calibration](#calibration)
- [Programmatic API](#programmatic-api)
- [Local development](#local-development)
- [Project layout](#project-layout)
- [CI example](#ci-example)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [License](#license)

## What this does

`catching-jit-tests-vitest` is designed for TypeScript projects that use
Vitest. For every diff, it can:

1. Read the changed TypeScript files between a base ref and a head ref.
2. Score the diff for risk using sensitivity, complexity, nearby test coverage,
   and git history.
3. Generate focused Vitest tests with an LLM.
4. Create temporary git worktrees for the parent and child revisions.
5. Run the same generated tests against both worktrees.
6. Harvest tests that pass on the parent but fail on the child.
7. Filter likely false positives with rule-based and LLM-based assessors.
8. Emit console, JSON, GitHub-comment-ready, or GitHub step-summary reports.

The goal is not to replace your normal test suite. The goal is to find
behavioral changes that your existing tests did not already pin down.

## Core idea

The central signal is a "weak catch":

- The generated test passes on the parent revision.
- The same generated test fails on the child revision.
- The failure appears to describe an unintended behavior change rather than a
  brittle generated test or an intentional product change.

Weak catches are reviewed by assessors before they become engineer-facing
reports. Tests that pass on both parent and child are retained as "hardening
candidates" in JSON output because they may still be useful regression tests.

## Features

- `jittest catch` CLI for analyzing the current diff or an arbitrary pair of git
  refs.
- Two generation workflows:
  - `dodgy-diff`: treats the changed child code as a potential mutant and asks
    for tests that assert the parent behavior.
  - `intent-aware`: infers PR intent and concrete risks, generates risk
    mutants, validates that generated tests kill those mutants, then runs the
    tests against the real child revision.
- Risk-based gating with `--risk-threshold`.
- Repeated `--include` and `--exclude` globs for monorepos and mixed-language
  repositories.
- Temporary worktree execution so generated tests are run against clean parent
  and child checkouts, reusing a single dependency install when the lockfile is
  unchanged across the two refs.
- Package-manager detection for `pnpm`, `npm`, and `yarn`.
- Pluggable LLM providers: OpenRouter, a generic OpenAI-compatible endpoint, or
  any AI SDK model injected programmatically.
- On-disk LLM response cache and a run-level token/dollar budget.
- Optional flake guard (`--flake-guard-runs`) that drops candidates that are not
  stably green on the parent revision.
- Console, JSON, and GitHub comment output.
- GitHub step-summary output plus side-output files for one-pass CI artifacts.
- Assessment feedback records plus a `jittest calibrate` command that turns
  triaged labels into recommended assessor weights.
- A `jittest triage` command for labeling feedback records by record ID or run
  ID.
- TypeScript exports for lower-level pipeline pieces.

## Requirements

- Node.js `>=22`
- Git
- A TypeScript project that can run tests with Vitest
- One of `pnpm`, `npm`, or `yarn` available for dependency installation in
  temporary worktrees
- An API key for your LLM provider (`OPENROUTER_API_KEY`, or `LLM_API_KEY` for
  the generic provider)
- A model supplied by `--llm-model`, `OPENROUTER_MODEL` / `LLM_MODEL`, or
  programmatic config

The CLI ships with two providers: `openrouter` (default) and a generic
`openai-compatible` provider for OpenAI, Together, vLLM, Ollama, and similar
endpoints (set `--llm-provider openai-compatible --llm-base-url <url>` or
`LLM_PROVIDER` / `LLM_BASE_URL`). Library consumers can bypass both and inject
any [AI SDK](https://sdk.vercel.ai) model directly — see
[Programmatic API](#programmatic-api). There is no default model.

## Quick start

From this repository:

```sh
corepack enable
corepack prepare pnpm@11.1.3 --activate
pnpm install
pnpm build
export OPENROUTER_API_KEY="sk-or-..."
export OPENROUTER_MODEL="anthropic/claude-sonnet-4"
node dist/cli.js catch --base origin/main --head HEAD
```

After installing or linking the package into another project, use the `jittest`
binary:

```sh
export OPENROUTER_API_KEY="sk-or-..."
export OPENROUTER_MODEL="anthropic/claude-sonnet-4"
jittest catch --base origin/main --head HEAD
```

For local package development, you can also link the built CLI:

```sh
pnpm build
pnpm link --global
jittest --help
```

## CLI usage

```text
Usage
  jittest <command> [options]

Commands
  catch      Generate catching tests for the current diff
  format     Render a saved JSON report as Markdown
  calibrate  Analyze feedback records and recommend assessor weights
  triage     Label assessment feedback records

Global options
  --help     Show help
  --version  Show version

catch options
  --base <ref>             Base git ref (default: origin/main)
  --head <ref>             Head git ref (default: HEAD)
  --workflow <name>        dodgy-diff | intent-aware | both
  --risk-threshold <num>   Minimum risk score required for generation
  --tests-per-function <n> Candidates per changed function
  --max-total-tests <n>    Maximum generated tests to execute
  --batch-size <n>         Generated tests per execution batch
  --parallel-worktrees <b> Run parent/child installs and tests in parallel
  --assess-concurrency <n> Weak catches assessed concurrently (default: 4)
  --flake-guard-runs <n>   Re-run candidates on parent N times; drop flaky ones
  --include <glob>         Changed file glob to include
  --exclude <glob>         Changed file glob to exclude
  --timeout <ms>           Per-test timeout
  --output <format>        console | json | github-comment | github-step-summary
  --fail-on <verdict>      Exit 2 when a report at this verdict or stronger is found
  --json-file <path>       Also write the JSON report to this file
  --summary-file <path>    Also write GitHub step-summary Markdown to this file
  --comment-file <path>    Also write GitHub PR-comment Markdown to this file
  --report-threshold <n>   Minimum score to report
  --feedback-path <path>   JSONL file for assessor feedback records
  --context-file <path>    Extra local context file for intent analysis
  --auto-context-file <p>  Optional repo guidance file to auto-load when present
  --no-auto-context        Disable auto-loading AGENTS/CLAUDE/CONTRIBUTING docs
  --pr-title <text>        Pull request title for intent-aware analysis
  --pr-body <text>         Pull request body for intent-aware analysis
  --llm-model <model>      Model id (provider-specific)
  --llm-provider <name>    openrouter | openai-compatible (default: openrouter)
  --llm-base-url <url>     Base URL for the openai-compatible provider
  --max-cost-usd <number>  Run-level OpenRouter dollar budget
  --max-tokens <number>    Run-level LLM token budget
  --cwd <path>             Repository root (default: .)
  --config <path>          Path to jittest.config.json (default: auto-discover)
  --no-cache               Disable the on-disk LLM response cache
  --cache-dir <path>       LLM cache directory (default: .jittest/cache)

calibrate options
  --feedback-path <path>   JSONL feedback records to analyze
  --output <format>        console | json
  --config <path>          Path to jittest.config.json (default: auto-discover)
  --cwd <path>             Repository root (default: .)

format options
  jittest format <report.json> --output github-step-summary
  --input <path>           Saved JSON report (positional path also accepted)
  --output <format>        json | github-comment | github-step-summary
  --out <path>             Write rendered output to this file instead of stdout
  --cwd <path>             Repository root for relative paths (default: .)

triage options
  --feedback-path <path>   JSONL feedback records to update
  --id <record-id>         Limit to one feedback record
  --run-id <run-id>        Limit to one run's feedback records
  --label <label>          unknown | confirmed-true-positive | confirmed-false-positive | intended-change
  --notes <text>           Notes to store with the label
  --list                   List matching feedback records
  --interactive            Prompt for labels in a terminal
  --config <path>          Path to jittest.config.json (default: auto-discover)
  --cwd <path>             Repository root (default: .)
```

### Option reference

| Option | Default | Notes |
| --- | --- | --- |
| `--base` | `origin/main` | Parent ref used for diff extraction and parent worktree. |
| `--head` | `HEAD` | Child ref used for diff extraction and child worktree. |
| `--workflow` | `both` | One of `dodgy-diff`, `intent-aware`, or `both`. |
| `--risk-threshold` | `0` | Skips generation when the computed diff risk is below this value. Range: `0` to `1`. |
| `--tests-per-function` | `3` | Number of LLM-generated candidates per changed function or inferred risk target. |
| `--max-total-tests` | `50` | Upper bound on generated tests that will be executed. |
| `--batch-size` | `10` | Number of generated tests to write and run per execution batch. |
| `--parallel-worktrees` | `true` | Accepts `true`, `false`, `1`, `0`, `yes`, or `no`. |
| `--include` | `src/**/*.ts`, `source/**/*.ts` | May be repeated. Replaces the default include list when provided. |
| `--exclude` | `**/*.test.ts`, `**/*.spec.ts`, `**/node_modules/**` | May be repeated. Replaces the default exclude list when provided. |
| `--timeout` | `30000` | Timeout in milliseconds for each Vitest run. |
| `--output` | `console` | One of `console`, `json`, `github-comment`, or `github-step-summary`. |
| `--fail-on` | none | Exit with code `2` when any reported catch has this verdict or stronger. Use `any-report` to fail on any report. |
| `--json-file` | none | Also write the JSON report to this path. Useful when stdout is reserved for another format. |
| `--summary-file` | none | Also write GitHub step-summary Markdown to this path, commonly `$GITHUB_STEP_SUMMARY`. |
| `--comment-file` | none | Also write GitHub PR-comment Markdown to this path. Empty when there is no comment-worthy output. |
| `--report-threshold` | `0` | Minimum combined assessment score required for a weak catch to be reported. Range: `-1` to `1`. |
| `--feedback-path` | `.jittest/assessment-records.jsonl` | Where assessment feedback records are appended. |
| `--context-file` | none | May be repeated. File contents are passed to intent analysis. |
| `--auto-context-file` | `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` | Optional repo guidance file to auto-load when present. May be repeated; replaces the configured default list when supplied. |
| `--no-auto-context` | false | Disable automatic repo guidance context discovery. |
| `--pr-title` | empty | Helps the intent-aware workflow decide what behavior was intended. |
| `--pr-body` | empty | Helps the intent-aware workflow decide what behavior was intended. |
| `--llm-model` | none | OpenRouter model id. If omitted, `OPENROUTER_MODEL` or `llm.model` must provide one. |
| `--max-cost-usd` | none | Run-level dollar guardrail. Existing in-flight calls may finish and overshoot. |
| `--max-tokens` | none | Run-level LLM token guardrail. This is separate from `llm.maxTokens`, the per-call output cap. |
| `--cwd` | `.` | Repository root to analyze. |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed without a configured failing finding. This includes advisory runs with reports when `--fail-on` is not set. |
| `1` | CLI/runtime error. |
| `2` | `jittest catch --fail-on <verdict>` matched at least one reported catch. |
| `3` | `jittest catch` resolved `--base` and `--head` to the same commit and exited before diff extraction or LLM calls. |

## Examples

Analyze the current branch against `origin/main`:

```sh
jittest catch
```

Analyze a specific pair of refs:

```sh
jittest catch --base main --head feature/auth-timeout
```

Run only the direct diff-as-mutant workflow:

```sh
jittest catch --workflow dodgy-diff
```

Run only intent-aware risk analysis and provide PR context:

```sh
jittest catch \
  --workflow intent-aware \
  --pr-title "Preserve session refresh while rotating tokens" \
  --pr-body "This change rotates access tokens but should not log users out." \
  --context-file docs/auth.md
```

Gate generation to higher-risk diffs:

```sh
jittest catch --risk-threshold 0.35
```

Analyze a monorepo package:

```sh
jittest catch \
  --cwd packages/api \
  --include "src/**/*.ts" \
  --exclude "**/*.generated.ts" \
  --exclude "**/*.test.ts"
```

Emit JSON for automation:

```sh
jittest catch --output json > jittest-report.json
```

Emit Markdown suitable for a PR comment:

```sh
jittest catch --output github-comment > jittest-comment.md
```

Emit JSON and a GitHub step summary from one run:

```sh
jittest catch \
  --output json \
  --summary-file "$GITHUB_STEP_SUMMARY" \
  --json-file jittest-report.json
```

Render a saved JSON report later:

```sh
jittest format jittest-report.json --output github-step-summary --out summary.md
```

Fail a CI step when a strong enough report is found:

```sh
jittest catch --output json --fail-on likely-strong
```

Reduce cost and runtime during experiments:

```sh
jittest catch \
  --workflow dodgy-diff \
  --tests-per-function 1 \
  --max-total-tests 10 \
  --batch-size 5
```

## How the pipeline works

### 1. Diff extraction

The CLI first resolves `--base` and `--head` to commits. If both refs resolve
to the same commit, the run exits immediately with status code `3` before diff
extraction, LLM calls, worktree setup, or dependency installation.

Otherwise, it reads changed files with:

```text
git diff --name-only <base>...<head>
```

It then filters paths with the configured include and exclude globs, reads the
file-level diff, parses hunks, detects changed exported symbols, finds nearby
test files, and uses the TypeScript compiler API to identify changed functions.

Only matching TypeScript files are analyzed by default:

```text
src/**/*.ts
source/**/*.ts
```

Test files and `node_modules` are excluded by default.

### 2. Risk scoring

The risk score is a weighted value from `0` to `1`. It combines:

- Sensitivity score: auth, payments, access control, secrets, data model,
  endpoints, config, and utility changes.
- Complexity score: file count, hunk count, and line churn.
- Coverage gap: changed files without nearby test files.
- Defect history: historical git touches for changed files.

Current weighting:

```text
sensitivity:    0.40
complexity:     0.25
coverage gap:   0.20
defect history: 0.15
```

If `--risk-threshold` is greater than the computed score, the run is skipped
before generating tests.

### 3. Test generation

The `dodgy-diff` workflow asks the LLM to generate Vitest tests that pass on the
parent code and fail on the child code.

The `intent-aware` workflow:

1. Infers the intent of the diff from PR title, PR body, optional context files,
   and the raw diff.
2. Lists concrete risks that could compile and pass existing tests.
3. Generates minimal mutants representing those risks.
4. Generates tests that kill those mutants.
5. Keeps only intent-aware tests that pass on parent code and fail against the
   generated mutant.

Generated test files are placed under the changed source file's directory using
the pattern:

```text
<name>.<hash>.jittest.test.ts
```

They are written only inside temporary worktrees and removed after execution.

### 4. Worktree setup and dependency installation

The CLI creates a temporary directory under the OS temp folder and adds two git
worktrees:

- `parent`: checked out at `--base`
- `child`: checked out at `--head`

Dependencies are installed in both worktrees. Package manager detection prefers
the `packageManager` field in `package.json`, then lockfiles:

- `pnpm-lock.yaml`
- `yarn.lock`
- `package-lock.json`

If no package manager is declared and no lockfile is present, the fallback order
starts with `npm`.

### 5. Dual execution

Generated tests are run with Vitest JSON output:

```text
vitest run --reporter=json --no-color <generated test files>
```

The runner sets these environment variables for generated test runs:

```text
VITEST_CACHE=false
VITEST_MAX_THREADS=1
```

Each generated test is evaluated by comparing its parent and child outcomes.

### 6. Harvesting

The harvester classifies generated tests into:

- Weak catches: pass on parent, fail on child.
- Hardening candidates: pass on parent, pass on child.

Weak catches are summarized as behavior changes such as boolean flips,
introduced nulls, changed return values, changed exceptions, or generic
behavioral differences.

### 7. Assessment

Weak catches are assessed before they are reported. The default assessment stack
uses:

- `rubfake`: rule-based filters for common false-positive patterns such as
  broken mocks, type errors in generated tests, infra failures, timeout/flaky
  failures, snapshot brittleness, and implementation-detail tests.
- LLM ensemble judging: asks configured judge models whether the observed
  failure is likely unexpected given the diff intent.

The combined score is mapped to a verdict:

| Score range | Verdict |
| --- | --- |
| `>= 0.6` | `strong-catch` |
| `>= 0.3` | `likely-strong` |
| `>= -0.3` | `uncertain` |
| `>= -0.6` | `likely-false-positive` |
| `< -0.6` | `false-positive` |

Only catches at or above the effective report threshold are shown in the final
report.

## Output formats

### Console

Console output is the default. It includes the refs analyzed, workflow, files
analyzed, risk score, generated test counts, weak catch counts, estimated cost,
risk reasons, and report summaries.

Example shape:

```text
JiTTest catch analysis

Base: origin/main
Head: HEAD
Workflow: both
Files analyzed: 2
Risk score: 0.42
Risk threshold: 0.00
Eligible for generation: yes
Tests generated: 6
Weak catches: 1
Hardening candidates: 3
Reports generated: 1
Duration: 38s
Cost: $0.0123

Reasons:
- Touches authentication or session logic.
- A large portion of changed files do not have nearby tests.

Reports:
1. Boolean result flipped from true to false
   The generated test passed before the change and now fails on the changed
   branch, suggesting an unintended behavior change.
```

### JSON

JSON output is intended for scripts and dashboards:

```sh
jittest catch --output json > jittest-report.json
```

The top-level JSON shape is:

```json
{
  "version": "0.3.0",
  "stats": {
    "duration": "38s",
    "diffExtractionMs": 120,
    "testGenerationMs": 24500,
    "executionMs": 8600,
    "assessmentMs": 4300,
    "filesAnalyzed": 2,
    "functionsAnalyzed": 4,
    "totalTestsGenerated": 6,
    "testsPassedOnParent": 5,
    "testsFailedOnChild": 1,
    "weakCatchCount": 1,
    "hardeningCandidateCount": 3,
    "assessedAsTP": 1,
    "assessedAsFP": 0,
    "assessedAsUncertain": 0,
    "reportsGenerated": 1,
    "byWorkflow": {
      "dodgyDiff": {
        "generated": 3,
        "weakCatches": 1,
        "hardeningCandidates": 1
      },
      "intentAware": {
        "generated": 3,
        "weakCatches": 0,
        "hardeningCandidates": 2
      }
    },
    "llmCallCount": 9,
    "estimatedTokens": 12000,
    "estimatedCost": 0.0123,
    "llmUsage": {
      "callCount": 9,
      "totalInputTokens": 7000,
      "totalOutputTokens": 5000,
      "totalTokens": 12000,
      "totalCostUsd": 0.0123,
      "costKnown": true,
      "byModel": [
        {
          "model": "anthropic/claude-sonnet-4",
          "callCount": 9,
          "inputTokens": 7000,
          "outputTokens": 5000,
          "totalTokens": 12000,
          "costUsd": 0.0123,
          "costKnown": true
        }
      ],
      "budget": {
        "status": "within-budget",
        "skippedCalls": 0,
        "overshootAllowed": true,
        "dollarBudgetEnforced": true
      },
      "events": []
    },
    "diffRiskScore": 0.42
  },
  "reports": [],
  "hardeningCandidates": [],
  "statusMessage": "No tests were generated for the current diff."
}
```

When the run is skipped or no tests are generated, `stats` may be `null` and
`statusMessage` explains why.

When a run-level token or dollar budget is exhausted, already generated tests
still execute and non-LLM assessment continues. Future LLM generation or judging
is skipped, and `stats.llmUsage` records the budget event and skipped-call
count.

### GitHub comment

GitHub comment output is Markdown formatted for PR comments:

```sh
jittest catch --output github-comment > jittest-comment.md
```

If no reports meet the threshold, this formatter returns an empty string unless
there is a status message, such as a skipped low-risk run.

### GitHub step summary

GitHub step-summary output is Markdown formatted for `$GITHUB_STEP_SUMMARY`:

```sh
jittest catch --output github-step-summary >> "$GITHUB_STEP_SUMMARY"
```

In CI, the more common pattern is to keep JSON on stdout or in a file and emit
the summary as a side output:

```sh
jittest catch \
  --output json \
  --json-file jittest-report.json \
  --summary-file "$GITHUB_STEP_SUMMARY"
```

The same renderer can be applied to a saved report:

```sh
jittest format jittest-report.json --output github-step-summary --out summary.md
```

## Configuration

Configuration is resolved from three layers, lowest precedence first:

1. A `jittest.config.json` file (auto-discovered by walking up from `--cwd`, or
   pointed at explicitly with `--config <path>`).
2. Environment variables.
3. CLI flags / programmatic API overrides.

Default runtime configuration:

```ts
{
  llm: {
    provider: "openrouter", // or "openai-compatible"
    baseUrl: undefined,     // required for the openai-compatible provider
    model: "anthropic/claude-sonnet-4", // required; no built-in default
    maxTokens: 4096, // per-call output-token cap
    providerOptions: {},
    budget: {}
  },
  judgeModels: [],
  riskThreshold: 0,
  testsPerFunction: 3,
  maxTotalTests: 50,
  workflow: "both",
  testTimeout: 30000,
  batchSize: 10,
  parallelWorktrees: true,
  assessConcurrency: 4, // weak catches assessed in parallel
  flakeGuardRuns: 1,    // >1 re-runs candidates on parent and drops flaky ones
  reportThreshold: 0,
  rubfakeEnabled: true,
  llmJudgeEnabled: true,
  assessors: {
    rubfakeWeight: 0.4,
    llmWeight: 0.6,
    rubfakeOverrideScore: -0.8,
    verdictThresholds: { strongCatch: 0.6, likelyStrong: 0.3, uncertain: -0.3, likelyFalsePositive: -0.6 },
    dismissalThresholds: { trivial: -0.2, easy: 0, moderate: 0.3, hard: 0.5 }
  },
  cache: { enabled: true, dir: ".jittest/cache" }, // LLM response cache
  outputFormat: "console",
  feedbackPath: ".jittest/assessment-records.jsonl",
  contextFiles: [],
  autoContext: true,
  autoContextFiles: ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"],
  sensitivityGlobs: [],
  include: ["src/**/*.ts", "source/**/*.ts"],
  exclude: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"]
}
```

### Config file

Any subset of the runtime configuration above can be set in
`jittest.config.json`. The `assessors` block is the main thing you will tune by
hand or via `jittest calibrate` (see [Calibration](#calibration)):

```json
{
  "reportThreshold": 0.1,
  "assessors": { "rubfakeWeight": 0.55, "llmWeight": 0.45 },
  "sensitivityGlobs": [
    { "label": "memberships", "pattern": "modules/memberships/**", "weight": 0.95 },
    { "label": "webhooks", "pattern": "src/webhooks/**", "weight": 0.9 }
  ]
}
```

`sensitivityGlobs` lets a repository teach the risk scorer about project-specific
sensitive paths. Matching files can raise the sensitivity component of the risk
score and add a corresponding risk reason.

By default, intent-aware analysis also auto-loads repo guidance files when they
exist: `AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md`. These are optional and
quietly skipped when absent. Use `autoContext: false` or `--no-auto-context` to
disable this, or set `autoContextFiles` / `--auto-context-file` to choose a
different allowlist.

### LLM response cache

Generation and judging responses are cached on disk (default `.jittest/cache`,
keyed on model + prompt + decoding params + output schema), so re-running on an
unchanged diff is near-free and records as zero-cost cache hits. Disable with
`--no-cache` or relocate with `--cache-dir`.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` / `LLM_API_KEY` | Yes | API key for test generation, risk inference, mutant generation, and LLM judging. `LLM_API_KEY` takes precedence. |
| `OPENROUTER_MODEL` / `LLM_MODEL` | Yes unless `--llm-model` or programmatic `llm.model` is set | Model id. |
| `LLM_PROVIDER` | No | `openrouter` (default) or `openai-compatible`. |
| `LLM_BASE_URL` | When provider is `openai-compatible` | Base URL of the OpenAI-compatible endpoint. |

All other environment variables from the current process are inherited by the
Vitest runs in the temporary worktrees.

## Feedback records

Each assessed weak catch is appended to the configured feedback path. The
default path is:

```text
.jittest/assessment-records.jsonl
```

Records include:

- Run ID and timestamp
- Base and head refs
- Workflow
- Risk score
- PR metadata
- Weak catch details
- Assessment details
- Engineer feedback (`engineerFeedback.label`: `unknown` by default; set it to
  `confirmed-true-positive`, `confirmed-false-positive`, or `intended-change`
  during triage to feed calibration)

This repository ignores `.jittest/` by default so local feedback records do not
accidentally get committed.

Use a different path with:

```sh
jittest catch --feedback-path report/jittest-assessments.jsonl
```

## Triage

`jittest triage` labels feedback records in place so the calibration loop does
not require hand-editing JSONL.

List records from a run:

```sh
jittest triage --run-id "$RUN_ID" --list
```

Label every record from a run:

```sh
jittest triage \
  --run-id "$RUN_ID" \
  --label confirmed-true-positive \
  --notes "reviewed in PR 123"
```

Label a single record:

```sh
jittest triage \
  --id fb4d2ce3b91966cd \
  --label intended-change
```

For local terminal use, `--interactive` prompts for labels one record at a time.

## Calibration

Once you have triaged some records (set their `engineerFeedback.label`), close
the loop with `jittest calibrate`. It reads the feedback JSONL, scores the
current assessor configuration against your labels (precision / recall / F1),
grid-searches better combiner weights and a report threshold, and prints a
recommended `jittest.config.json` block. It only reports — nothing is written
automatically, so you decide whether to adopt the suggestion.

```sh
jittest calibrate                 # human-readable summary + recommended block
jittest calibrate --output json   # machine-readable metrics
```

Example:

```text
jittest calibrate
Labeled records: 142 (positive: 38, negative: 104, skipped: 60)
Current  precision=0.61 recall=0.74 f1=0.67 (TP=28 FP=18 FN=10 TN=86)
Best     precision=0.79 recall=0.71 f1=0.75 (TP=27 FP=7 FN=11 TN=97)

Recommended jittest.config.json block:
{
  "reportThreshold": 0.05,
  "assessors": { "rubfakeWeight": 0.55, "llmWeight": 0.45 }
}
```

## Programmatic API

The package exports lower-level TypeScript utilities for building custom
workflows. Example:

```ts
import {
  LLMClient,
  applyRiskAnalysis,
  dodgyDiffWorkflow,
  extractDiffContext,
  harvestWeakCatches,
  loadConfig,
} from "catching-jit-tests-vitest";

const cwd = process.cwd();
const config = loadConfig(
  {
    workflow: "dodgy-diff",
    testsPerFunction: 1,
  },
  { cwd, configPath: "jittest.config.json" },
);

const diff = await applyRiskAnalysis(
  cwd,
  await extractDiffContext({
    cwd,
    baseRef: "origin/main",
    headRef: "HEAD",
  }),
);

const llm = new LLMClient(config.llm);
const generated = await dodgyDiffWorkflow(diff, cwd, llm, config);

console.log({
  riskScore: diff.riskScore,
  generated: generated.length,
});
```

`loadConfig(overrides?, options?)` accepts a second options object:

```ts
const config = loadConfig(
  { testsPerFunction: 1 },
  {
    cwd: process.cwd(),
    configPath: "jittest.config.json",
    env: { OPENROUTER_MODEL: "anthropic/claude-sonnet-4" },
    ignoreEnv: false,
  },
);
```

Use `ignoreEnv: true` or an explicit `env` map for deterministic config tests.

### Bring your own AI SDK provider

Library consumers can bypass the built-in providers entirely by injecting a
resolved [AI SDK](https://sdk.vercel.ai) model (`languageModel`) or a factory
(`modelFactory`, which lets judge ensembles vary the model id). No
`OPENROUTER_API_KEY` is required in this mode; token usage falls back to the AI
SDK's accounting and dollar cost is reported as unknown.

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { LLMClient } from "catching-jit-tests-vitest";

const llm = new LLMClient({
  model: "claude-sonnet-4", // used as the stats label
  maxTokens: 4096,
  languageModel: anthropic("claude-sonnet-4"),
});
```

Common exports include:

- Configuration: `loadConfig`, `createDefaultConfig`,
  `parseCatchCommandOptions`, `parseFormatCommandOptions`,
  `parseTriageCommandOptions`, `workflowSchema`, `outputFormatSchema`
- Diff analysis: `extractDiff`, `extractDiffContext`, `analyzeFileChanges`,
  `applyRiskAnalysis`, `computeRiskScore`
- Generation: `dodgyDiffWorkflow`, `intentAwareWorkflow`,
  `loadIntentContext`
- Execution and harvesting types: `DualExecutionResult`, `TestResult`,
  `WeakCatch`, `HardeningCandidate`
- Assessment: `assessWeakCatch`
- Reporting: `formatCatchResult`, `formatJsonReport`, `formatPRComment`,
  `formatGithubStepSummary`
- Commands: `runFormatCommand`, `runTriageCommand`
- Runtime validation schemas from `source/runtime-schemas.ts`

## Local development

Install dependencies:

```sh
corepack enable
corepack prepare pnpm@11.1.3 --activate
pnpm install
```

Build the package:

```sh
pnpm build
```

Run the CLI from source output:

```sh
node dist/cli.js --help
node dist/cli.js catch --base origin/main --head HEAD
```

Run checks:

```sh
pnpm typecheck
pnpm lint
pnpm test
```

Format files:

```sh
pnpm format
```

Development scripts:

| Script | Purpose |
| --- | --- |
| `pnpm build` | Compile TypeScript into `dist/`. |
| `pnpm dev` | Run TypeScript in watch mode. |
| `pnpm typecheck` | Type-check without emitting files. |
| `pnpm lint` | Run Biome with warnings treated as errors. |
| `pnpm format` | Run Biome and write formatting fixes. |
| `pnpm test` | Run Vitest with coverage. |

## Project layout

```text
source/
  assessors/       Rule-based and LLM-based weak-catch assessment
  commands/        CLI command orchestration
  diff/            Git diff extraction, AST analysis, risk scoring
  execution/       Worktree setup, dependency installation, Vitest execution
  feedback/        JSONL assessment record storage
  generation/      Dodgy-diff and intent-aware test generation
  harvest/         Weak catch and hardening candidate harvesting
  prompts/         LLM prompt templates
  reporting/       Console, JSON, and GitHub comment formatters
  utils/           Process, LLM, concurrency, logging helpers
test/
  *.test.ts        Unit tests for the pipeline
```

Important root files:

- `package.json`: package metadata, scripts, binary definition.
- `vitest.config.ts`: test and coverage configuration.
- `tsconfig.json`: TypeScript source config.
- `tsconfig.build.json`: declaration-emitting build config.
- `biome.jsonc`: lint and formatting rules.
- `LICENSE`: MIT license.

## CI example

This example runs the built CLI in a pull request workflow and posts a PR
comment when `jittest` produces one.

For read-only workflows, use `contents: read`, write JSON with `--json-file`, and
write the GitHub step summary with `--summary-file "$GITHUB_STEP_SUMMARY"`.
That path does not require `pull-requests: write`; upload the JSON and feedback
JSONL as artifacts for later triage.

```yaml
name: jittest

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  catch:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 11.1.3

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      - name: Run JiTTest
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_MODEL: anthropic/claude-sonnet-4
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          node dist/cli.js catch \
            --base "origin/${{ github.base_ref }}" \
            --head HEAD \
            --pr-title "$PR_TITLE" \
            --pr-body "$PR_BODY" \
            --output github-comment \
            > jittest-comment.md

      - name: Post comment if present
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if [ -s jittest-comment.md ]; then
            gh pr comment "${{ github.event.pull_request.number }}" \
              --body-file jittest-comment.md
          fi
```

If you install the package into the target repository instead of building this
repository, replace `node dist/cli.js catch` with `jittest catch` or
`pnpm exec jittest catch`.

This repository also includes a manual, JSON-producing demo workflow at
[`.github/workflows/jittest-demo.yml`](.github/workflows/jittest-demo.yml). It
accepts arbitrary base/head refs, tuning thresholds, model, and budget inputs,
then uploads the resulting JiTTest report as a workflow artifact.

For a manually triggered workflow that accepts a pull request number as input,
see [Manual GitHub Action for a Pull Request](docs/manual-github-action-pr.md).

## Troubleshooting

### `OPENROUTER_API_KEY` or model is missing or invalid

Set a valid OpenRouter API key and model before running the CLI:

```sh
export OPENROUTER_API_KEY="sk-or-..."
export OPENROUTER_MODEL="anthropic/claude-sonnet-4"
```

### No files are analyzed

The default include globs are `src/**/*.ts` and `source/**/*.ts`. Use
`--include` for other layouts:

```sh
jittest catch --include "packages/*/lib/**/*.ts"
```

### Generation is skipped

If you set `--risk-threshold`, the run is skipped when the computed risk score
is below that threshold. Lower the threshold or omit the option.

### No tests are generated

Common causes:

- The diff has no changed TypeScript functions after filtering.
- Intent-aware risk inference did not find concrete risks.
- The LLM returned invalid or empty test code.
- The generated tests exceeded `--max-total-tests` and were truncated.

### Worktree setup fails

Check that both refs exist locally:

```sh
git rev-parse origin/main
git rev-parse HEAD
```

In CI, use `fetch-depth: 0` or explicitly fetch the base branch.

### Base and head are the same commit

`jittest catch` resolves both refs before diff extraction. If they resolve to
the same commit, it exits before LLM calls or worktree setup with exit code `3`
and a status message. In CI this usually means the base/head refs were wired
incorrectly.

### Dependency installation fails inside worktrees

The runner installs dependencies in both temporary worktrees. Make sure the
target project has a valid `package.json` and lockfile, and that the selected
package manager is available in the environment.

### Vitest is not found

The runner executes Vitest through the target package manager. Install Vitest in
the target project:

```sh
pnpm add -D vitest
```

### Generated tests are brittle or invalid

Generated tests are expected to be noisy. The assessment phase filters common
false positives, and you can reduce report volume with:

```sh
jittest catch --report-threshold 0.4
```

### Runtime or cost is too high

Reduce the number of generated tests:

```sh
jittest catch --tests-per-function 1 --max-total-tests 10
```

You can also use only one workflow:

```sh
jittest catch --workflow dodgy-diff
```

### GitHub comment output is empty

This is expected when there are no reportable weak catches and no status
message. Use `--output json` if you always need a machine-readable artifact.

## Limitations

- The CLI is currently focused on TypeScript and Vitest.
- The built-in providers are OpenRouter and generic OpenAI-compatible endpoints;
  other AI SDK models require programmatic integration.
- Configuration is JSON-only today; JavaScript/TypeScript config files are not
  loaded.
- Generated tests may be invalid, flaky, or too specific. The assessor reduces
  this noise but cannot remove it completely.
- Dependency installation in temporary worktrees can be slow for large
  projects.
- The LLM receives source snippets, diffs, PR context, and generated-test
  assessment context. Do not run this on code you cannot send to the configured
  LLM provider.
- Generated test import paths are derived for colocated TypeScript modules and
  may need future adaptation for unusual module layouts.

## License

MIT. See [LICENSE](LICENSE).
