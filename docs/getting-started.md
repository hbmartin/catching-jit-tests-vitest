# Getting started in production

This page is for the person setting up `jittest` for a team to use on real
PRs for the first time. Everything here assumes you have already run the
CLI once locally and seen output.

## Prerequisites checklist

- Node.js `>=22` available on every machine that will run `jittest`
  (developer laptops *and* CI runners).
- Git, with both `--base` and `--head` refs reachable from the working tree.
- A package manager that matches what the target repo expects: `pnpm`,
  `yarn`, or `npm`. `jittest` picks the manager by inspecting
  `package.json#packageManager` and then lockfiles in this order:
  `pnpm-lock.yaml` → `yarn.lock` → `package-lock.json`. If none match, it
  falls back to `npm`.
- The target project must use Vitest. If the package can't run
  `vitest run`, no generated test will ever execute.
- An `ANTHROPIC_API_KEY` with budget. Required for *all* runs — even
  `dodgy-diff` only — because risk inference, generation, and the LLM judge
  ensemble all call the API.

## Install path 1: as a dependency in the target repo

This is the recommended path for teams who want a normal `jittest` binary
on `$PATH` and reproducible installs across CI and laptops.

```sh
pnpm add -D catching-jit-tests-vitest
# or
npm install -D catching-jit-tests-vitest
# or
yarn add -D catching-jit-tests-vitest
```

Run it from a script in the consuming project:

```jsonc
// package.json
{
  "scripts": {
    "jittest": "jittest catch --base origin/main --head HEAD"
  }
}
```

Add a `.jittest/` entry to `.gitignore` so feedback records and any
stray temporary artefacts don't end up committed:

```text
.jittest/
```

## Install path 2: as a sibling tool

If you don't want the package in `dependencies`, clone the repo, build it,
and call the resulting `dist/cli.js` from CI. This works well when one
infrastructure repo runs `jittest` against many service repos via a shared
runner. See [`ci-integration.md`](./ci-integration.md) for a worked
example.

## Verifying the install

Before you turn on PR comments for the whole team, do a dry run on a
non-trivial branch:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."
jittest catch --base origin/main --head HEAD --output json > /tmp/jittest.json
jq '.stats' /tmp/jittest.json
```

You're looking for:

- `filesAnalyzed > 0` — globs are matching.
- `totalTestsGenerated > 0` — the LLM is returning usable code.
- `testsPassedOnParent > 0` — generated tests can actually run against
  your project. If everything fails on parent, the tests are not even
  well-formed against your codebase and something is wrong with the
  Vitest setup, imports, or aliasing.
- `estimatedCost` — sanity-check this against your monthly budget,
  multiplied by your expected PR volume. See
  [`cost-and-performance.md`](./cost-and-performance.md).

## What "good" looks like

There is no universal target ratio, but on a representative TypeScript
service codebase, healthy early numbers tend to be:

| Metric | Typical |
| --- | --- |
| `filesAnalyzed` per PR | 1–6 |
| `totalTestsGenerated` per PR (default flags) | 4–20 |
| `testsPassedOnParent` / `totalTestsGenerated` | `>= 0.6` |
| `weakCatchCount` per PR | usually 0, occasionally 1–3 |
| `reportsGenerated` per PR | 0 most days |

If `reportsGenerated` is consistently `>= 2` per PR, your
`--report-threshold` is probably too low or the LLM is finding genuinely
under-tested code. Check a sample by hand before assuming the latter — see
[`triage-workflow.md`](./triage-workflow.md).

## Configuration surface

There is no config file. Everything is CLI flags or programmatic
overrides through `loadConfig()`. The full table of flags lives in the
[root readme](../readme.md#cli-usage). The flags that matter most in
production are summarised in [`tuning.md`](./tuning.md).

Defaults that production users almost always override:

- `--include` / `--exclude` — defaults assume `src/` or `source/`. Most
  monorepos need explicit globs.
- `--feedback-path` — by default writes to `.jittest/assessment-records.jsonl`
  inside whatever `--cwd` resolves to. Point this at a stable location if
  you want longitudinal data across runs.
- `--report-threshold` — defaults to `0`. Production typically wants
  `0.3` or higher once you have a feel for the noise floor.

## Local development against a private install

If you need to iterate on `jittest` itself against a real consuming
repository:

```sh
# in catching-jit-tests-vitest
pnpm build
pnpm link --global

# in the consuming repo
pnpm link --global catching-jit-tests-vitest
jittest catch --base origin/main --head HEAD
```

Remember to `pnpm unlink --global catching-jit-tests-vitest` when you're
done so CI on the consuming repo doesn't accidentally resolve to your
laptop's build.
