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

`plan` accepts GitHub issue JSON on stdin as either an array of issues or an object with an `issues` array:

```sh
pnpm --filter @cv-maxxing/prd-orchestrator plan < issues.json
```

Without stdin, `plan` reads open issues through `gh issue list` and prints the selected PRD, child task DAG, blockers, warnings, next executable tasks, and unavailable PRDs. It does not create branches, pull requests, commits, worktrees, or Sandcastle workers.

## Live one-child execution

`run --one-child` accepts the same JSON preview input as the planner tests when stdin is provided. Without stdin, it runs the live orchestration tracer bullet:

1. fetch open GitHub issues
2. require a clean, up-to-date local `main`
3. create or resume the PRD draft branch and PR
4. run Sandcastle impact analysis and implementation on isolated worker branches
5. apply the worker diff to the PRD branch
6. run selected host verification commands
7. create one child commit, push with `--force-with-lease`, run CodeRabbit, and update the draft PR ledger
8. write local run state under `.git/prd-orchestrator/runs/<run-id>/status.json`

```sh
pnpm --filter @cv-maxxing/prd-orchestrator build
pnpm --filter @cv-maxxing/prd-orchestrator exec prd-orchestrator run --one-child
```

## Full-run foundation

## Resume, status, cleanup

`resume-pr <number>` verifies that the PR is owned by the orchestrator and prints the recovered run status.

`status` prints the latest local run state.

`cleanup` removes stale run and Sandcastle artifacts while preserving active run state and committed `.sandcastle` config.

## Full-run foundation

The scheduler foundation supports the later full multi-child `run` loop:

- only currently unblocked child tasks are eligible for scheduling
- non-overlapping impact surfaces may run in one parallel batch
- overlapping files, design files, snapshots, shared contracts, or high-risk/uncertain analysis force sequential execution
- a blocked child records its blocker while independent runnable children continue
- repeated remediation requires new evidence or a changed strategy
- cleanup preserves active PRD runs, active Sandcastle artifacts, committed `.sandcastle` config, and live processes
- status and resume logic remain inspectable from run state, PR body ledger, remote PR state, and commits

Automatic merge remains outside the orchestrator boundary. Human review and merge are required.
