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

Read the repository `AGENTS.md`, relevant package files, and existing tests before
changing code.

## Implementation Rules

- Stay inside the assigned child issue scope.
- Use pnpm for repository commands and dependency work.
- Follow TDD for behavior changes: add or update a failing automated test first,
  then implement the minimal change and keep the tests passing.
- Run linting, type-checking, and relevant tests before committing.
- Run `coderabbit review --agent` when available, and wait for a terminal result
  before considering the task complete.
- Commit normal append-only changes on the current Sandcastle child branch.
- Do not skip git hooks. Never use `--no-verify`.
- Do not mutate GitHub issue or pull request state.
- Do not close issues manually.

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
gh run list --workflow update-desktop-visual-snapshots.yml --limit 1
gh run watch
git pull --rebase
```

Use the workflow output and committed snapshot diff as the audit trail. Do not
add new repo automation, retry loops, or PR comments for this flow.

End by printing `</task>` only after implementation, tests, checks, and
CodeRabbit review are complete.
