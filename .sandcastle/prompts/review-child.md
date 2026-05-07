# Review Child PRD Branch

You are reviewing an implemented Sandcastle child branch before it is merged into
the parent PRD branch.

## Context

- Parent issue: #{{PARENT_ISSUE_NUMBER}} {{PARENT_ISSUE_TITLE}}
- Parent branch: {{PARENT_BRANCH_NAME}}
- Child issue: #{{CHILD_ISSUE_NUMBER}} {{CHILD_ISSUE_TITLE}}
- Branch: {{CHILD_BRANCH_NAME}}

## Review Steps

1. Inspect the branch diff:

   ```sh
   git diff {{PARENT_BRANCH_NAME}}..HEAD
   ```

2. Compare the diff against the child issue acceptance criteria and parent PRD.
3. Add meaningful tests where the implementation has important edge cases or
   uncovered behavior.
4. Fix obvious correctness, scope, typing, linting, and maintainability issues.
5. Run relevant pnpm checks for the touched code.
6. Commit any review refinements as normal append-only commits.

## macOS Visual Snapshot Review

Use the `Update Desktop Visual Snapshots` workflow when the implemented branch
has expected desktop UI visual snapshot changes that require Darwin baselines.

Inspect and watch the updater with raw GitHub CLI commands:

```sh
pr_number="$(gh pr view --json number --jq .number)"
gh workflow run update-desktop-visual-snapshots.yml -f pr_number="${pr_number}"
gh run list --workflow update-desktop-visual-snapshots.yml --limit 3
gh run watch
gh run view --log
git pull --rebase
```

Use the updater run logs and committed snapshot PNG diff as the audit trail. Do
not add new repo automation, retry loops, or PR comments for this flow.

Do not mutate GitHub issue or pull request state. Do not rewrite branch history.

End by printing `</task>` after review and verification are complete.
