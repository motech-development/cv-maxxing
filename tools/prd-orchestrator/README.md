# PRD Orchestrator

`@cv-maxxing/prd-orchestrator` is the repo-level automation package for running PRD implementation work from GitHub child tasks.

The v1 lifecycle is intentionally narrow:

1. `plan` inspects the first eligible PRD and prints a dry-run execution plan.
2. `run --one-child` proves one child task from selection through draft PR update.
3. `resume-pr <number>` resumes an existing automation-owned draft PR.
4. `status` reports local lock, run, Sandcastle, and draft PR status.
5. `cleanup` removes stale local orchestrator and Sandcastle artifacts while preserving active runs.

The orchestrator owns GitHub, git push, CodeRabbit, and CI polling credentials. Sandcastle workers are isolated Docker workers that receive PRD context and task prompts, but they do not receive GitHub credentials and do not mutate GitHub directly.

Run state belongs outside tracked files under `.git/prd-orchestrator/runs/<run-id>/`. Sandcastle runtime artifacts remain untracked under `.sandcastle/`.

## Dry-run planning

Issue 82 implements the read-only `plan` command. It accepts GitHub issue JSON on stdin as either an array of issues or an object with an `issues` array:

```sh
pnpm --filter @cv-maxxing/prd-orchestrator plan < issues.json
```

The command prints the selected PRD, child task DAG, blockers, warnings, next executable tasks, and unavailable PRDs. It does not create branches, pull requests, commits, worktrees, or Sandcastle workers.

## Full-run foundation

Issue 89 keeps full multi-child live execution out of scope, but documents and tests the scheduling foundation that a later full `run` command will use:

- only currently unblocked child tasks are eligible for scheduling
- non-overlapping impact surfaces may run in one parallel batch
- overlapping files, design files, snapshots, shared contracts, or high-risk/uncertain analysis force sequential execution
- a blocked child records its blocker while independent runnable children continue
- repeated remediation requires new evidence or a changed strategy
- cleanup preserves active PRD runs, active Sandcastle artifacts, committed `.sandcastle` config, and live processes
- status and resume logic remain inspectable from run state, PR body ledger, remote PR state, and commits

Live multi-child execution, remote branch mutation, and automatic merge remain outside this slice.
