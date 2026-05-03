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

Do not mutate GitHub issue or pull request state. Do not rewrite branch history.

End by printing `</task>` after review and verification are complete.
