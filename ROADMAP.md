# Roadmap

Planned and deferred work for `catching-jit-tests-vitest`.

## Packaged GitHub Action (deferred)

Today, wiring `jittest` into CI requires hand-writing a workflow step (see
[`docs/ci-integration.md`](docs/ci-integration.md) and
[`docs/manual-github-action-pr.md`](docs/manual-github-action-pr.md)). A
first-class, reusable GitHub Action would reduce adoption to a few lines of YAML.

**Shape:** a composite (or Docker) `action.yml` at the repo root that:

- Accepts inputs mirroring the CLI flags — `base`, `head`, `workflow`,
  `risk-threshold`, `llm-model`, `llm-provider`, `max-cost-usd`, `cache-dir`,
  etc., plus an `openrouter-api-key` (passed through to `OPENROUTER_API_KEY`).
- Runs `jittest catch --output github-comment` against the PR's base/head.
- Posts the rendered comment to the pull request (e.g. via
  `actions/github-script` or `peter-evans/create-or-update-comment`), updating a
  single sticky comment per PR rather than appending new ones.
- Surfaces `weakCatchCount` / `reportsGenerated` as step outputs so downstream
  steps can gate or annotate.

**Usage sketch:**

```yaml
- uses: hbmartin/catching-jit-tests-vitest@v1
  with:
    base: origin/main
    head: HEAD
    openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
    llm-model: anthropic/claude-sonnet-4
```

**Open questions:**

- Composite action (reuses the runner's Node + package manager, faster) vs.
  Docker action (hermetic, pins the `jittest` version). Composite is the likely
  default; the tool already needs the project's own toolchain to install
  dependencies in the worktrees.
- Caching the `.jittest/cache` directory across runs via `actions/cache` keyed on
  the diff, to make re-runs near-free.
- Whether to publish the Action to the GitHub Marketplace alongside the npm
  package release.
