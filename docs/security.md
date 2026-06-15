# Security and data handling

`jittest` reads your source code, runs your test suite, and sends
relevant pieces of both to a third-party LLM provider. This page lists
exactly what leaves the box, what stays local, and how to handle the
implications.

## What is sent to the LLM provider

The currently supported provider is **OpenRouter only**. There is no default
model; set `OPENROUTER_MODEL`, pass `--llm-model`, or provide `llm.model`
programmatically.

For each `jittest catch` run, the following data may be sent to the
provider in prompt payloads:

- The **raw unified diff** between `--base` and `--head` for every
  file that matches your include globs and is not excluded.
- The **source of changed functions** (and a small amount of
  surrounding context) for files in the diff.
- The **PR title and body**, if supplied via `--pr-title` and `--pr-body`.
- The **contents of `--context-file`** files, in full.
- The **generated test code** itself (sent to the judge for assessment).
- The **failure messages and stack traces** from failing Vitest runs.

Things that are **not** sent:

- Files outside the include globs (e.g. lockfiles, generated artefacts,
  binary assets).
- Environment variables.
- Secrets stored in the runner's keychain or CI secret store, unless
  they are checked into source files that match the include globs (in
  which case you have a different problem).
- The full repository history; only files in the diff are inspected.

## Risk surface to understand

1. **Source code disclosure.** If any file in the include globs contains
   information you cannot share with the LLM provider — PII, regulated
   data, customer secrets baked into config, proprietary algorithms not
   covered by your provider agreement — then `jittest` will send it.
   This is by design. Mitigations:

   - Tighten `--include` to a deliberately small surface.
   - Add patterns to `--exclude` for any file that may contain
     sensitive content.
   - Don't run `jittest` on repos that violate your provider's data
     processing agreement.

2. **PR title and body leak.** Anything in your PR description is sent
   when you pass `--pr-title` and `--pr-body`. PR descriptions
   sometimes contain customer names, ticket details, or screenshots of
   internal dashboards. If your PR template encourages that, either
   strip those fields before passing them in, or accept that they leave
   the box.

3. **Failure messages can echo data.** If a test failure prints (for
   example) a record returned from a fixture, that string is included
   in the assessment prompt. In practice this is rare for generated
   tests, but be aware of it for fixtures with sensitive content.

4. **Generated tests can contain string literals from your code.** The
   LLM may inline values it saw in the diff. Generated tests are
   *written into temporary worktrees only* and removed after the run,
   so they don't persist in your repo. They do exist on disk briefly,
   and they are visible in the JSON report as `test.code`.

## API key handling

- Store `OPENROUTER_API_KEY` in a real secret manager — CI provider
  secrets, HashiCorp Vault, AWS Secrets Manager, 1Password, etc. Never
  commit it.
- Pass it to the CLI only via environment variable. The CLI deliberately
  does not accept it as a flag for this reason.
- Scope it. Create one specifically for `jittest` so its
  usage and abuse surface are isolated. Rotate keys when teammates
  leave.
- For GitHub PRs from forks, GitHub withholds secrets by default. Do
  not work around this with `pull_request_target`; that pattern has
  well-known supply-chain pitfalls. Run `jittest` only on PRs from
  the same repository unless you have audited the alternative.

## Supply chain: dependency installs in temporary worktrees

`jittest` creates two git worktrees and runs the project's installer
(`pnpm`, `yarn`, or `npm`) in each. That means:

- Any postinstall script in any transitive dependency runs in both
  worktrees with the runner's permissions. This is the same risk you
  already accept by running `pnpm install` in CI — `jittest` doesn't
  add new risk *per dependency*, but it does run install twice.
- The temporary worktree path is under the OS temp directory. On a
  multi-tenant runner, ensure that directory is not world-readable.
- The worktrees are deleted after the run. If a run crashes mid-way,
  stale temp directories may persist; sweep them in long-running
  self-hosted runners.

## Local feedback records

`assessment-records.jsonl` contains, for each assessed weak catch:

- The base and head refs.
- The PR title and body (as supplied).
- The behavior change summary.
- The full generated test code.
- The parent and child execution outcomes (including any failure
  messages).
- The assessor verdict and supporting reasoning.

If you check this file into version control, it is searchable by
anyone with repo access. The default `.gitignore` in this repository
excludes `.jittest/`, but a consumer repo will need to add that
ignore itself. See [`getting-started.md`](./getting-started.md).

If you upload feedback records to a shared store (S3, etc.), apply the
same retention and access controls you would to source code.

## Network egress

The only `jittest`-owned API egress is outbound HTTPS to OpenRouter
(`openrouter.ai`, currently). Git operations and package-manager installs
may contact separate external endpoints, such as git remotes and npm/pnpm/yarn
registries. Vitest execution itself is local unless the project's tests make
network calls.

In a hermetic environment (locked-down corporate VPN, etc.) you must
allow outbound HTTPS to OpenRouter, plus any git or package-registry endpoints
your runner needs.

## Compliance posture

If your organization needs an explicit statement for compliance review:

- `jittest` is an LLM-augmented test generator that sends diff context,
  changed source code, and (optionally) PR metadata to OpenRouter and the
  upstream model providers selected by your OpenRouter routing/model settings.
- Data sent is governed by your OpenRouter and upstream provider agreements
  and any DPA you
  have in place.
- The `jittest` application sends no telemetry, analytics, or third-party
  requests beyond the configured LLM provider; dependency installation and git
  fetches are runner/tooling traffic.
- The package itself is MIT licensed (see `LICENSE`).
- Source for the CLI is available; you can audit exactly what is sent
  by reading `source/prompts/*` and `source/utils/llm-client.ts`.

If your codebase is unable to legally use a hosted LLM, **do not run
`jittest` against it**. There is no on-prem or local-model
configuration in this codebase today.
