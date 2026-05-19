# Manual GitHub Action for a Pull Request

This guide shows how to add a manually triggered GitHub Actions workflow that
runs `jittest` against a pull request number. The workflow resolves the pull
request number to git refs, fetches the PR head, runs the installed
`catching-jit-tests-vitest` CLI, and comments on the pull request when a report
is produced.

The CLI does not need a GitHub-specific PR option for this setup. It already
accepts arbitrary refs through `--base` and `--head`, so the workflow handles
the GitHub lookup and passes those refs to `jittest catch`.

## Prerequisites

- A GitHub repository that uses Vitest.
- Node.js `>=22` in the workflow.
- The project can install dependencies with pnpm.
- The repository has an `ANTHROPIC_API_KEY` Actions secret.
- `catching-jit-tests-vitest` is installed in the project.

Install the package in the repository that will run the workflow:

```sh
pnpm add -D catching-jit-tests-vitest
```

If the project uses npm or yarn, adapt the install and execution commands in
the workflow. For example, replace `pnpm install --frozen-lockfile` and
`pnpm exec jittest catch` with the equivalent package-manager commands.

## Add the API key

Add an Actions secret named `ANTHROPIC_API_KEY`:

1. Open the repository on GitHub.
2. Go to **Settings** > **Secrets and variables** > **Actions**.
3. Create a repository secret named `ANTHROPIC_API_KEY`.
4. Store the Anthropic API key used by `jittest`.

## Add the workflow

Create `.github/workflows/jittest-manual-pr.yml` in the consuming project:

```yaml
name: jittest manual PR

on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: Pull request number to analyze
        required: true
        type: string

permissions:
  contents: read
  pull-requests: write

jobs:
  catch:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11.1.3

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Resolve pull request refs
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ inputs.pr_number }}
        run: |
          BASE_REF="$(gh pr view "$PR_NUMBER" --json baseRefName --jq '.baseRefName')"
          HEAD_REF="jittest-pr-$PR_NUMBER"

          git fetch --no-tags origin "refs/heads/${BASE_REF}:refs/remotes/origin/${BASE_REF}"
          git fetch --no-tags origin "refs/pull/${PR_NUMBER}/head:${HEAD_REF}"

          PR_TITLE_DELIMITER="JITTEST_PR_TITLE_${RANDOM}_${RANDOM}"
          PR_BODY_DELIMITER="JITTEST_PR_BODY_${RANDOM}_${RANDOM}"

          {
            echo "PR_NUMBER=$PR_NUMBER"
            echo "BASE_REF=$BASE_REF"
            echo "HEAD_REF=$HEAD_REF"
            echo "PR_TITLE<<$PR_TITLE_DELIMITER"
            gh pr view "$PR_NUMBER" --json title --jq '.title'
            echo "$PR_TITLE_DELIMITER"
            echo "PR_BODY<<$PR_BODY_DELIMITER"
            gh pr view "$PR_NUMBER" --json body --jq '.body // ""'
            echo "$PR_BODY_DELIMITER"
          } >> "$GITHUB_ENV"

      - name: Run JiTTest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          pnpm exec jittest catch \
            --base "origin/${BASE_REF}" \
            --head "$HEAD_REF" \
            --pr-title "$PR_TITLE" \
            --pr-body "$PR_BODY" \
            --output github-comment \
            > jittest-comment.md

      - name: Post comment if present
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if [ -s jittest-comment.md ]; then
            gh pr comment "$PR_NUMBER" --body-file jittest-comment.md
          fi
```

## Run the workflow

1. Open the repository on GitHub.
2. Go to **Actions**.
3. Select **jittest manual PR**.
4. Click **Run workflow**.
5. Enter the pull request number.
6. Start the workflow run.

When `jittest` emits GitHub-comment output, the workflow posts that output back
to the pull request. If no reportable behavior changes are found and there is no
status message, `jittest-comment.md` stays empty and no comment is posted.

## Security

This workflow fetches and executes pull request code while
`ANTHROPIC_API_KEY` is available in the job environment. The CLI also installs
dependencies in temporary worktrees and runs generated Vitest tests there. Run
this workflow only for trusted pull requests, or protect the job with a GitHub
Environment that requires maintainer approval before secrets are exposed.

## Troubleshooting

### The workflow cannot find the PR

Confirm that the input is only the pull request number, such as `123`, not a
URL or branch name. The workflow uses `gh pr view "$PR_NUMBER"` to read PR
metadata.

### The base or head ref cannot be resolved

Keep `fetch-depth: 0` on `actions/checkout`, and make sure both fetch commands
in the `Resolve pull request refs` step completed successfully. `jittest`
creates temporary worktrees from the refs passed to `--base` and `--head`.

### `jittest` is not found

Install `catching-jit-tests-vitest` in the consuming project and run
`pnpm install --frozen-lockfile` before `pnpm exec jittest catch`. For npm or
yarn projects, use the package manager's equivalent command.

### No comment is posted

This can be expected. The GitHub comment formatter writes an empty file when no
weak catches meet the report threshold and there is no status message. Use
`--output json` in a separate debugging run if you need a machine-readable
artifact for every run.
