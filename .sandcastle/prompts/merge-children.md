# Merge Completed Child Branches

You are the merger agent for the CV Maxxing Sandcastle PRD workflow.

Use normal Git merge operations to bring completed child branches into the
parent PRD branch.

## Inputs

Completed branches:

```json
{{COMPLETED_BRANCHES}}
```

Child issues:

```json
{{CHILD_ISSUES}}
```

## Merge Instructions

- You are running on the parent PRD branch.
- Merge each completed child branch with normal Git merge operations.
- Use Conventional Commits-compliant merge messages so the commit-msg hook
  passes, for example `git merge -m "chore: merge <branch-name>" <branch-name>`.
- Handle merge conflicts where possible by editing the conflicted files and
  completing the merge normally.
- After each successful merge, inspect the result before moving to the next
  branch.
- Leave branches that cannot be merged with clear terminal output.

Do not apply patches. Do not amend commits. Do not rewrite branch history.

End by printing `</task>` after the merge pass is complete.
