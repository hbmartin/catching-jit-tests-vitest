# Production guide

This directory is the operator's manual for running `catching-jit-tests-vitest`
(`jittest`) against real pull requests. The top-level [`readme.md`](../readme.md)
explains *what* the tool does; these pages explain *how to run it well* over
weeks and months — without setting fire to your LLM bill, drowning reviewers in
noise, or leaking source code to a provider you didn't intend.

If you have not run `jittest catch` even once locally, start with the
[Quick start](../readme.md#quick-start) section in the root readme, then come
back here.

## Read in order

1. [`getting-started.md`](./getting-started.md) — provisioning a production
   install: Node, package manager, repo layout, API key handling, first
   end-to-end run, and what "good" looks like.
2. [`ci-integration.md`](./ci-integration.md) — wiring `jittest` into GitHub
   Actions and other CI providers. Covers fetch depth, caching, PR comment
   posting, failure modes, and required permissions.
3. [`tuning.md`](./tuning.md) — choosing `--risk-threshold`,
   `--report-threshold`, `--tests-per-function`, `--max-total-tests`, and
   workflow mix to get a useful signal-to-noise ratio for *your* codebase.
4. [`cost-and-performance.md`](./cost-and-performance.md) — controlling spend
   and wall-clock time: which knobs matter most, how to estimate cost per PR,
   when to use `dodgy-diff` vs `intent-aware`, and tactics for monorepos.
5. [`triage-workflow.md`](./triage-workflow.md) — what engineers do with a
   weak catch report. Includes a verdict cheat-sheet, dismissal heuristics,
   and how to feed `assessment-records.jsonl` back into threshold tuning.
6. [`security.md`](./security.md) — what data leaves the box, how to handle
   the Anthropic API key, what to do for code that must not be sent to a
   third-party LLM, and supply-chain considerations for the temporary
   worktrees.
7. [`troubleshooting.md`](./troubleshooting.md) — production-specific
   failures: empty diffs in shallow checkouts, dependency install
   timeouts, flaky generated tests, worktree leaks, and rate limits.

## Mental model in one paragraph

`jittest` runs after a diff exists. For each PR it scores risk, asks an LLM
to write Vitest tests targeted at the changed code, runs those tests against
both `--base` and `--head` in temporary git worktrees, and reports
*weak catches* — tests that pass on the parent but fail on the child. A
rule-based filter (`rubfake`) and an LLM judge ensemble assess each weak
catch and emit a verdict from `strong-catch` down to `false-positive`. You
gate what reaches engineers with `--report-threshold`, and you gate whether
the pipeline runs at all with `--risk-threshold`. Everything else is a
volume or cost knob.

## When this is the wrong tool

`jittest` is designed to *catch regressions that your existing test suite
would have missed*. It is not a replacement for unit tests, a coverage
tool, a static analyzer, or a code reviewer. If your test suite is already
exhaustive for the changed surface, `jittest` will mostly produce
hardening candidates (tests that pass on both sides). That is a valid
outcome — but it is also a sign you may want a higher `--risk-threshold`
so you only spend tokens on diffs where existing coverage is thin.
