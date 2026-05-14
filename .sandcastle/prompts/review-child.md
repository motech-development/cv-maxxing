# Review Child PRD Branch

You are reviewing an implemented Sandcastle child branch before it is merged into
the parent PRD branch.

## Context

- Parent issue: #{{PARENT_ISSUE_NUMBER}} {{PARENT_ISSUE_TITLE}}
- Parent branch: {{PARENT_BRANCH_NAME}}
- Child issue: #{{CHILD_ISSUE_NUMBER}} {{CHILD_ISSUE_TITLE}}
- Branch: {{CHILD_BRANCH_NAME}}

## Review Steps

1. Inspect the parent and child issue context:

   ```sh
   gh issue view {{PARENT_ISSUE_NUMBER}} --json number,title,body,url,state
   gh issue view {{CHILD_ISSUE_NUMBER}} --json number,title,body,url,state
   ```

2. Inspect the branch diff against the parent PRD branch:

   ```sh
   git diff {{PARENT_BRANCH_NAME}}..HEAD
   ```

3. Compare the diff against the child issue acceptance criteria, parent PRD, and
   current parent branch.
4. Add meaningful tests only when required by `AGENTS.md` for the changed code.
5. Fix obvious correctness, scope, typing, linting, and maintainability issues.
6. Run relevant pnpm checks for the touched code.
7. Commit any review refinements as normal append-only commits.

## macOS Visual Snapshot Review

Use the `Update Desktop Visual Snapshots` workflow when the implemented branch
has expected desktop UI visual snapshot changes that require Darwin baselines.

Inspect and watch the updater with raw GitHub CLI commands:

```sh
pr_number="$(gh pr view --json number --jq .number)"
gh workflow run update-desktop-visual-snapshots.yml -f pr_number="${pr_number}"
run_id="$(gh run list --workflow update-desktop-visual-snapshots.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "${run_id}"
gh run view "${run_id}" --log
git pull --ff-only
```

Use the updater run logs and committed snapshot PNG diff as the audit trail. Do
not add new repo automation, retry loops, or PR comments for this flow.

Do not mutate GitHub issue or pull request state. Do not rewrite branch history:
no amend, rebase, reset-to-rewrite, patch stacks, custom resume flows, or opaque
recovery machinery.

End by printing exactly `</task>` after review and verification are complete.
That tag is the Codex-compatible completion signal for this run.
