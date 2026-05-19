# Troubleshooting in production

The root readme has a [general troubleshooting
section](../readme.md#troubleshooting). This page is for issues that
only show up once `jittest` is running on real PRs in CI.

## "It ran but produced nothing useful"

### Empty `filesAnalyzed`

```sh
jittest catch --output json | jq '.stats.filesAnalyzed'
# 0
```

Causes, in order of likelihood:

1. Your include globs don't match the layout. Defaults are
   `src/**/*.ts` and `source/**/*.ts`. Monorepos with
   `packages/*/src/**/*.ts` will return zero matches by default.
2. The diff against `--base` is empty in CI because of a shallow
   checkout. Verify with `git rev-list --count <base>..<head>`. If
   it's 0, you forgot `fetch-depth: 0`.
3. All changed files are excluded. Common culprit: tests, generated
   code, or `.d.ts` files. Confirm with
   `git diff --name-only <base>...<head>`.

### `filesAnalyzed > 0` but `totalTestsGenerated = 0`

The diff was analyzed but no functions were extracted, or all
generation attempts returned invalid code. Common causes:

- The diff touches only non-function code: imports, type aliases,
  exports, configuration constants. The AST analyzer is function-
  oriented and ignores these.
- For `intent-aware`, no concrete risks were identified from the
  PR title and body. Pass `--context-file` with more context, or
  fall back to `--workflow dodgy-diff`.
- The LLM returned malformed test code. Rare with default models;
  more common with smaller models. Re-run; if persistent, raise an
  issue with the JSON output attached.

### `totalTestsGenerated > 0` but `testsPassedOnParent` is very low

This is a serious symptom: it means the generated tests can't even
parse or run against your codebase. Almost always one of:

- **Vitest config mismatch.** Generated tests are placed colocated with
  the changed source. If your `vitest.config.ts` `test.include` is
  narrow (e.g. `test/**/*.test.ts`), Vitest doesn't see the generated
  files. Broaden `test.include` to cover the source tree.
- **Path alias resolution.** If your code uses `@/foo/bar` style
  imports that depend on `vitest.config.ts` resolution, the generated
  tests will fail when they use relative paths and other tests use
  aliases (or vice versa). Make sure resolution is configured so both
  styles work.
- **Missing global mocks.** If your real tests rely on a global setup
  file that mocks fs, network, time, etc., generated tests don't get
  those mocks and may fail for reasons that have nothing to do with
  the diff. Add the setup files to the Vitest config rather than
  importing them per-test.
- **Top-level imports the generated test needs aren't installed.** This
  shows up as `Cannot find module` failures on parent. Almost always
  an `--include` or `--exclude` issue letting through code that
  imports something only in a different workspace.

## "It's eating my CI budget"

See [`cost-and-performance.md`](./cost-and-performance.md) for the
full menu. The quickest single change is usually:

```sh
jittest catch \
  --risk-threshold 0.3 \
  --workflow dodgy-diff \
  --max-total-tests 20
```

That combination skips low-risk PRs entirely, drops the intent-aware
workflow's extra LLM calls, and caps the number of tests executed.
Expect a ~60% drop in cost.

## "Comments aren't showing up on PRs"

Confirm in order:

1. The workflow has `permissions: pull-requests: write`.
2. `--output github-comment` is used (not `console`).
3. `jittest-comment.md` is non-empty *before* the post step. The CLI
   intentionally emits empty output when there are no reportable
   catches.
4. The bot account isn't rate-limited and has access to the repo.

Add a `cat jittest-comment.md` step before `gh pr comment` if you
need to debug what's actually being produced.

## "Worktree setup fails"

```text
Error: failed to add worktree at '/tmp/jittest-XXXXXX/parent'
```

Common causes:

- Both refs need to exist locally. Re-fetch the base branch before
  running.
- The base ref must be valid syntax. `origin/main` is valid;
  `origin\main` is not.
- `/tmp` (or the OS temp dir) is out of space. Worktrees can be
  hundreds of MB after install. Free space or set `TMPDIR` to a
  larger volume.
- The repo has uncommitted submodule changes. Stash or commit first.

## "Dependency install fails in worktrees"

The worktree gets a clean checkout of the ref but inherits the runner
environment. Failures typically come from:

- A `.npmrc` that points at a private registry and requires
  authentication. Make sure your auth token is in the environment
  the worktree install will see (most package managers honor
  environment variables for tokens).
- A `package.json#packageManager` field that pins a version not
  installed on the runner. This project uses `pnpm@11.1.3`; install that
  exact version in CI with `pnpm/action-setup` *before* `jittest`.
- Postinstall scripts that require system tooling not present on the
  runner. Either install the tooling or set `ignore-scripts` / use
  `pnpm install --ignore-scripts` — but be aware that may break the
  project's own setup.

## "Generated tests time out"

```text
Test 'should ...' timed out after 30000ms
```

Two distinct cases:

1. **Your project's normal tests are slow.** Raise `--timeout`. Use
   `60000` if your test files routinely take 30+ seconds.
2. **A generated test is genuinely hung.** This sometimes happens if
   the LLM writes a busy-wait or accidentally constructs an infinite
   loop. It is treated as a child-side failure and assessed; `rubfake`
   will usually mark it as a likely false positive. If you see this
   repeatedly on the same code, lower `--timeout` instead — fail
   faster, save runtime.

## "Worktree leak fills the disk"

The runner deletes worktrees on success and on most failure paths. If
the process is `SIGKILL`-ed (CI cancel, OOM kill), stale directories
under `${TMPDIR}/jittest-*` may persist. A periodic cleanup task:

```sh
find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name 'jittest-*' \
  -mmin +120 -print -exec rm -rf {} +
```

Run this on self-hosted runners daily. Ephemeral runners reclaim the
disk on shutdown so this is moot.

## "Anthropic rate limits are hitting"

If you see `429` or token-bucket errors:

- Add `concurrency: cancel-in-progress: true` to your workflow so
  rapid pushes don't fan out parallel runs.
- Stagger runs across multiple workspace-scoped API keys if you have
  multiple repos.
- Reduce `--tests-per-function` and `--max-total-tests` to cut the
  call rate per run.
- Contact Anthropic support to raise the workspace's rate limits.

The Anthropic SDK retries retryable errors, including 429s, up to its default
`maxRetries=2` with exponential backoff. If those retries are exhausted,
`jittest` surfaces the final error and exits non-zero. Treat that as an alert,
not as something to silently retry forever.

## "I changed the source but the result didn't change"

Two things to double-check:

1. You rebuilt: `pnpm build`. The CLI runs from `dist/`.
2. You're really hitting the local build. `which jittest` will tell
   you. If you have it linked globally and also installed locally,
   resolution order surprises you.

## Reporting bugs

When filing an issue, please include:

- The `jittest --version` output.
- The full `stats` object from a `--output json` run.
- The flags you ran with (excluding `ANTHROPIC_API_KEY`).
- For false-positive reports: the relevant entries from
  `assessment-records.jsonl`. These contain everything the team
  needs to reproduce the verdict.
