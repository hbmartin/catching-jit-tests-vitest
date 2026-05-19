# CI integration

`jittest` is designed to run inside a pull request workflow. This page
collects the practical details — fetch depth, caching, comment posting,
and failure modes — that the root readme's CI example glosses over.

## What CI must provide

1. **Both refs locally.** `jittest` runs `git diff --name-only <base>...<head>`
   and creates worktrees at both refs. Shallow clones (the GitHub Actions
   default) only have `HEAD`. Use `fetch-depth: 0`, or fetch the base
   branch explicitly:

   ```yaml
   - uses: actions/checkout@v4
     with:
       fetch-depth: 0
   ```

   Or for shallow-but-correct:

   ```sh
   git fetch --no-tags --prune --depth=1 origin "+refs/heads/${BASE}:refs/remotes/origin/${BASE}"
   ```

   In practice, `fetch-depth: 0` is simpler and unblocks the AST diff
   analyzer's history-based heuristics too.

2. **A working package manager.** The runner installs dependencies inside
   both temporary worktrees, so the manager indicated by
   `package.json#packageManager` (or the detected lockfile) must be
   available on `PATH`. With pnpm specifically, enable corepack:

   ```yaml
   - run: corepack enable
   ```

3. **`ANTHROPIC_API_KEY` as a secret.** Never hard-code it in workflow
   YAML. Use `secrets.ANTHROPIC_API_KEY` (or your provider's equivalent)
   and pass it as an `env:` entry. See [`security.md`](./security.md).

4. **Permissions to comment** if you want PR comments posted:

   ```yaml
   permissions:
     contents: read
     pull-requests: write
   ```

## Reference: GitHub Actions

A complete, production-shaped workflow:

```yaml
name: jittest

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: jittest-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  catch:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - run: corepack enable

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Run jittest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          pnpm exec jittest catch \
            --base "origin/${{ github.base_ref }}" \
            --head HEAD \
            --pr-title "$PR_TITLE" \
            --pr-body "$PR_BODY" \
            --risk-threshold 0.25 \
            --report-threshold 0.4 \
            --output json \
            > jittest-report.json

          node <<'NODE'
          const { readFileSync, writeFileSync } = require("node:fs");

          const escapeHtml = (value) =>
            String(value ?? "")
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;");

          const report = JSON.parse(readFileSync("jittest-report.json", "utf8"));
          const reports = report.reports ?? [];
          const regressionLabel =
            reports.length === 1 ? "regression" : "regressions";
          const summary =
            `${reports.length} potential ${regressionLabel} detected. ` +
            "If these changes are intentional, no action is needed.";

          if (reports.length === 0 && report.statusMessage === undefined) {
            process.exit(0);
          }

          const lines =
            reports.length === 0
              ? ["## JiTTest: Status", "", escapeHtml(report.statusMessage)]
              : [
                  "## JiTTest: Behavior Change Detection",
                  "",
                  summary,
                  "",
                  ...reports.flatMap((item, index) => [
                    `### ${index + 1}. ${escapeHtml(item.headline)}`,
                    "",
                    escapeHtml(item.senseCheck)
                      .split("\n")
                      .map((line) => `> ${line}`)
                      .join("\n"),
                    "",
                  ]),
                ];

          writeFileSync("jittest-comment.md", `${lines.join("\n")}\n`);
          NODE

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: jittest-report
          path: |
            jittest-report.json
            jittest-comment.md
            .jittest/assessment-records.jsonl

      - name: Post comment if present
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if [ -s jittest-comment.md ]; then
            gh pr comment "${{ github.event.pull_request.number }}" \
              --body-file jittest-comment.md
          fi
```

The workflow above runs `jittest` once in JSON mode, uploads that report, and
derives lightweight PR comment Markdown from the same artifact. If you need the
exact built-in comment formatting instead, choose `--output github-comment` and
skip the JSON artifact, or move the JSON-to-Markdown conversion into a checked-in
script you can test.

## `concurrency` matters

Without `concurrency: cancel-in-progress: true`, every force-push to a PR
spawns another `jittest` run that bills API tokens. The block above
cancels the previous run for the same PR.

## Required vs optional inputs

| Input | When to provide | Why |
| --- | --- | --- |
| `--pr-title`, `--pr-body` | Always, when available | Steers `intent-aware` workflow toward the *intended* behavior change. Cheap insurance against false positives. |
| `--context-file` | Domain docs that explain auth, billing, or other sensitive logic | Routes critical context to the intent step without bloating every prompt. May be repeated. |
| `--cwd` | Monorepos | Restrict the run to one package per CI job to keep runtime predictable. |

## Self-hosted runners

The only real difference is that you must ensure git, Node, and the
chosen package manager are installed on the runner image. The temporary
worktree path defaults to the OS temp directory; on long-running self-
hosted runners, occasionally clean stale `*jittest*` directories under
`/tmp` if a previous run crashed mid-install.

## Non-GitHub CI providers

Nothing in `jittest` is GitHub-specific — `--output github-comment`
just emits Markdown. For GitLab, Buildkite, Jenkins, etc.:

1. Make sure both refs are present (`git fetch origin <base>`).
2. Run `jittest catch --output json` and parse the JSON yourself, or choose
   `--output github-comment` if you only need Markdown.
3. Post the resulting summary wherever the team reviews diffs — merge request
   descriptions, Slack, Linear, etc.

## Failure modes you will hit

- **`origin/main` not found.** Forgot `fetch-depth: 0`. Either fix the
  checkout or pass a ref that *is* fetched (often `HEAD~1` for a single-
  commit shallow clone, but only useful for testing).
- **Dependency install times out.** Large monorepos with many workspace
  packages effectively `pnpm install` twice. See
  [`cost-and-performance.md`](./cost-and-performance.md) for mitigation —
  most teams set `--parallel-worktrees true` (the default) and accept the
  cost, or scope `--cwd` to a single package.
- **`ANTHROPIC_API_KEY` empty in PRs from forks.** GitHub Actions
  withholds secrets from forked-PR workflows by default. Use
  `pull_request_target` with care, or run `jittest` only on PRs from the
  same repository (`if: github.event.pull_request.head.repo.full_name == github.repository`).
- **Comment never posts.** Check `jittest-comment.md` is non-empty *and*
  the workflow has `pull-requests: write` *and* the bot account isn't
  rate-limited. The CLI deliberately emits empty output when there are
  no reportable catches and no status message; that is not a bug.

## Should this block merges?

In our experience, no — at least not at first. The signal is high but not
high enough to fail builds before you have triage data from a few weeks
of runs. Start advisory (comments only), tune
`--report-threshold` until reviewers stop complaining about noise, and
only then consider gating merges on `reportsGenerated == 0` for high-risk
diffs.
