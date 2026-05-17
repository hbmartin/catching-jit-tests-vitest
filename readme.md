# catching-jit-tests-vitest

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
8. Emit console, JSON, or GitHub-comment-ready reports.

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
  and child checkouts.
- Package-manager detection for `pnpm`, `npm`, and `yarn`.
- Console, JSON, and GitHub comment output.
- Assessment feedback records for later triage and tuning.
- TypeScript exports for lower-level pipeline pieces.

## Requirements

- Node.js `>=22`
- Git
- A TypeScript project that can run tests with Vitest
- One of `pnpm`, `npm`, or `yarn` available for dependency installation in
  temporary worktrees
- `ANTHROPIC_API_KEY` in the environment

The current LLM provider implementation supports Anthropic only. The default
model is `claude-sonnet-4-20250514`.

## Quick start

From this repository:

```sh
corepack enable
pnpm install
pnpm build
export ANTHROPIC_API_KEY="sk-ant-..."
node dist/cli.js catch --base origin/main --head HEAD
```

After installing or linking the package into another project, use the `jittest`
binary:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."
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
  catch    Generate catching tests for the current diff

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
  --include <glob>         Changed file glob to include
  --exclude <glob>         Changed file glob to exclude
  --timeout <ms>           Per-test timeout
  --output <format>        console | json | github-comment
  --report-threshold <n>   Minimum score to report
  --feedback-path <path>   JSONL file for assessor feedback records
  --context-file <path>    Extra local context file for intent analysis
  --pr-title <text>        Pull request title for intent-aware analysis
  --pr-body <text>         Pull request body for intent-aware analysis
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
| `--output` | `console` | One of `console`, `json`, or `github-comment`. |
| `--report-threshold` | `0` | Minimum combined assessment score required for a weak catch to be reported. Range: `-1` to `1`. |
| `--feedback-path` | `.jittest/assessment-records.jsonl` | Where assessment feedback records are appended. |
| `--context-file` | none | May be repeated. File contents are passed to intent analysis. |
| `--pr-title` | empty | Helps the intent-aware workflow decide what behavior was intended. |
| `--pr-body` | empty | Helps the intent-aware workflow decide what behavior was intended. |
| `--cwd` | `.` | Repository root to analyze. |

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

The CLI reads changed files with:

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
  "version": "0.1.0",
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
    "diffRiskScore": 0.42
  },
  "reports": [],
  "hardeningCandidates": [],
  "statusMessage": "No tests were generated for the current diff."
}
```

When the run is skipped or no tests are generated, `stats` may be `null` and
`statusMessage` explains why.

### GitHub comment

GitHub comment output is Markdown formatted for PR comments:

```sh
jittest catch --output github-comment > jittest-comment.md
```

If no reports meet the threshold, this formatter returns an empty string unless
there is a status message, such as a skipped low-risk run.

## Configuration

Configuration is currently supplied through CLI flags or programmatic API
overrides. There is no project-level config file loader yet.

Default runtime configuration:

```ts
{
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096
  },
  judgeModels: ["claude-sonnet-4-20250514"],
  riskThreshold: 0,
  testsPerFunction: 3,
  maxTotalTests: 50,
  workflow: "both",
  testTimeout: 30000,
  batchSize: 10,
  parallelWorktrees: true,
  reportThreshold: 0,
  rubfakeEnabled: true,
  llmJudgeEnabled: true,
  outputFormat: "console",
  feedbackPath: ".jittest/assessment-records.jsonl",
  contextFiles: [],
  include: ["src/**/*.ts", "source/**/*.ts"],
  exclude: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"]
}
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | API key used for test generation, risk inference, mutant generation, and LLM judging. |

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
- Placeholder engineer feedback fields

This repository ignores `.jittest/` by default so local feedback records do not
accidentally get committed.

Use a different path with:

```sh
jittest catch --feedback-path report/jittest-assessments.jsonl
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
const config = loadConfig({
  workflow: "dodgy-diff",
  testsPerFunction: 1,
});

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

Common exports include:

- Configuration: `loadConfig`, `createDefaultConfig`,
  `parseCatchCommandOptions`, `workflowSchema`, `outputFormatSchema`
- Diff analysis: `extractDiff`, `extractDiffContext`, `analyzeFileChanges`,
  `applyRiskAnalysis`, `computeRiskScore`
- Generation: `dodgyDiffWorkflow`, `intentAwareWorkflow`,
  `loadIntentContext`
- Execution and harvesting types: `DualExecutionResult`, `TestResult`,
  `WeakCatch`, `HardeningCandidate`
- Assessment: `assessWeakCatch`
- Reporting: `formatCatchResult`, `formatJsonReport`, `formatPRComment`
- Runtime validation schemas from `source/runtime-schemas.ts`

## Local development

Install dependencies:

```sh
corepack enable
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

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: corepack enable

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      - name: Run JiTTest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
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

## Troubleshooting

### `ANTHROPIC_API_KEY` is missing or invalid

Set a valid Anthropic API key before running the CLI:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."
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
- Only the Anthropic provider is implemented.
- There is no config-file loader yet; use CLI flags or programmatic overrides.
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
