# Cost and performance

`jittest` does three expensive things per PR: it calls the LLM, it runs
Vitest twice, and it installs dependencies in two temporary worktrees.
This page explains which one is your bottleneck and how to push back.

## A rough cost model

For each `jittest catch` run, the LLM is invoked roughly as:

- 1× risk inference (intent-aware only)
- 1× mutant generation per identified risk (intent-aware only)
- 1× test generation per changed function or per risk target, multiplied
  by `--tests-per-function`
- 1× per weak catch for the LLM judge ensemble (one call per configured
  judge model)

In practice, on a default config (`workflow=both`, `testsPerFunction=3`,
`judgeModels=[claude-sonnet-4-...]`):

| Diff shape | LLM calls per PR | Typical cost (USD) |
| --- | --- | --- |
| 1 small function changed, no weak catches | 4–6 | $0.01–$0.03 |
| 3 functions changed, 1 weak catch | 10–14 | $0.05–$0.10 |
| 8 functions changed, 2 weak catches | 25–35 | $0.15–$0.30 |
| Monorepo bulk change, 30+ files | 50+ | $0.50+ |

These are *rough* numbers from default flags; your mileage will vary
heavily with prompt size (large diffs ➜ larger prompts) and the model in
`config.llm.model`. The CLI reports `estimatedCost` in JSON output — log
that to track real numbers.

## Where the time goes

For a typical PR with default flags on a service-sized repo:

```text
~5%   diff extraction & risk scoring
~40%  test generation (LLM round-trips)
~25%  dependency install in worktrees
~25%  Vitest runs (parent + child)
~5%   assessment (rubfake + LLM judge)
```

The split shifts with repo size. On a monorepo, dependency install
dominates and can take longer than the LLM work. On a tiny package, the
LLM is the only thing that matters.

## Cost knobs, ranked by impact

### 1. `--risk-threshold` (the biggest knob)

Skipping generation entirely costs nothing. If you can avoid running
`jittest` on 40% of PRs by raising the threshold to `0.3`, you have
cut your monthly bill by ~40%. See [`tuning.md`](./tuning.md).

### 2. `--workflow`

`dodgy-diff` alone is roughly half the cost of `both`. `intent-aware`
alone is closer to two-thirds of `both` because it adds the risk
inference and mutant generation steps but avoids generating
diff-as-mutant tests.

### 3. `--max-total-tests`

This is a hard cap on the number of generated tests that are executed.
The default of `50` is generous. Lowering to `20` rarely loses anything
useful on normal PRs and dramatically cuts the time spent in Vitest.

### 4. `--tests-per-function`

Reducing from `3` to `1` cuts per-function generation cost to one-third.
You lose shot diversity. See the tuning guide for when this is fine.

### 5. `judgeModels` (programmatic only)

By default the LLM judge ensemble uses a single Sonnet model. If you
configure additional judges via `loadConfig({ judgeModels: [...] })`,
each adds one LLM call per weak catch. Stick with one unless you've
measured an accuracy gain.

### 6. Model choice

`config.llm.model` defaults to `claude-sonnet-4-20250514`. Substituting a
cheaper Haiku model for generation cuts cost by ~5× per call but
produces lower-quality tests. We do not recommend it for production
without thorough A/B testing on your own feedback records.

## Time knobs

### `--parallel-worktrees`

Defaults to `true`. Runs the parent and child setup-and-install in
parallel. Halves wall-clock time on the install phase at the cost of
roughly doubled peak disk and CPU usage. Turn off only if your CI runner
is small enough that two parallel `pnpm install`s OOM or thrash.

### `--batch-size`

Generated tests are written and run in batches of this size (default
`10`). Larger batches reduce Vitest startup overhead but increase the
chance a single bad generated test crashes the batch. `10` is fine for
most repos; raise to `20–25` for monorepos where Vitest startup is slow.

### `--timeout`

Per-Vitest-run timeout, default `30000` ms. If your test suite genuinely
takes >30s per file, raise this — otherwise leave it alone. Some teams
*lower* it to `15000` to catch generated tests that loop or hang.

## Monorepo tactics

Without intervention, `jittest` on a monorepo will:

1. Install the entire workspace's dependencies into the parent worktree.
2. Install them again into the child worktree.
3. Run Vitest from the workspace root.

That's slow, and the result is also less precise: a tiny change in
`packages/utils` triggers risk analysis across thousands of files.

Better:

```sh
# CI matrix-style: one job per affected package
jittest catch \
  --cwd packages/api \
  --include "src/**/*.ts" \
  --base "origin/$BASE" \
  --head HEAD
```

Detect which packages a PR touches and only run `jittest` for those.
Many repos already have a `turbo`, `nx`, or `pnpm --filter` mechanism
for this; reuse it.

## Caching dependency installs

The temporary worktrees are deleted after each run, so the package
manager's network fetch happens every time. To shave 20–60% off the
install phase, configure the runner's CI cache for the package manager's
*global* cache (not `node_modules`):

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: pnpm
```

pnpm in particular benefits a lot from a warm content-addressed store.

## Measuring real cost

Every run emits `stats.estimatedCost` (USD) and `stats.estimatedTokens`
in JSON output. The simplest dashboard is to append these to a CSV per
PR:

```sh
jittest catch ... --output json > report.json
jq -r '[.stats.estimatedCost, .stats.estimatedTokens,
        .stats.llmCallCount, .stats.duration] | @csv' report.json \
  >> jittest-cost-log.csv
```

If you push this into a spreadsheet or a TSDB, you'll have a daily view
of cost trends. Watch for the regression where a single very large PR
spikes the day's total — that's usually the signal to raise
`--risk-threshold` or scope `--cwd` more tightly.

## Things that do not save money

- Disabling `rubfake` — the LLM judge has to reproduce its work, more
  expensively.
- Setting `--max-total-tests` very low (`<5`) — you stop catching
  anything and still pay for risk inference and generation prompts.
- Pre-emptively reducing prompt context — the prompts are already lean;
  most cost is in completions, not prompts.
