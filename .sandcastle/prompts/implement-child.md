# Implement Child PRD Task

You are implementing one planned child issue inside a normal Sandcastle branch.

## Context

- Parent issue: #{{PARENT_ISSUE_NUMBER}} {{PARENT_ISSUE_TITLE}}
- Child issue: #{{CHILD_ISSUE_NUMBER}} {{CHILD_ISSUE_TITLE}}
- Branch: {{CHILD_BRANCH_NAME}}

## Required Inspection

Before editing, inspect both GitHub issues:

```sh
gh issue view {{PARENT_ISSUE_NUMBER}} --json number,title,body,url,state
gh issue view {{CHILD_ISSUE_NUMBER}} --json number,title,body,url,state
```

Read the repository `AGENTS.md`, relevant package files, and existing checks
before changing code.

## Implementation Rules

- Stay inside the assigned child issue scope.
- Use pnpm for repository commands and dependency work.
- Follow the project testing rules in `AGENTS.md`: use TDD for
  coverage-instrumented app behavior, and do not add unit tests for repo-owned
  Sandcastle automation.
- Run linting, type-checking, and relevant tests before committing.
- Run `coderabbit review --agent` when available, and wait for a terminal result
  before considering the task complete.
- Commit normal append-only changes on the current Sandcastle child branch.
- Do not skip git hooks. Never use `--no-verify`.
- Do not mutate GitHub issue or pull request state.
- Do not close issues manually.
- Do not rewrite child branch history: no amend, rebase, reset-to-rewrite, patch
  stacks, custom resume flows, or opaque recovery machinery.

## macOS Visual Snapshot Updates

Use the `Update Desktop Visual Snapshots` workflow when your branch has expected
desktop UI visual snapshot changes that require Darwin baselines.

Trigger it with the current pull request number:

```sh
pr_number="$(gh pr view --json number --jq .number)"
gh workflow run update-desktop-visual-snapshots.yml -f pr_number="${pr_number}"
```

Then watch the run and pull the resulting snapshot commit:

```sh
run_id="$(gh run list --workflow update-desktop-visual-snapshots.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "${run_id}"
git pull --ff-only
```

Use the workflow output and committed snapshot diff as the audit trail. Do not
add new repo automation, retry loops, or PR comments for this flow.

End by printing exactly `</task>` only after implementation, checks, and
CodeRabbit review are complete. That tag is the Codex-compatible completion
signal for this run.
