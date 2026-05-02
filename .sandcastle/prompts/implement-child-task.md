# Implement PRD Child Task

You are implementing one PRD child task inside an isolated Sandcastle worker.

## Parent PRD

{{PARENT_PRD}}

## Assigned Child Task

{{CHILD_TASK}}

## Sibling Task Summaries

{{SIBLING_SUMMARIES}}

## Expected Write Surfaces

{{EXPECTED_WRITE_SURFACES}}

## Pencil Workflow Requirements

{{PENCIL_WORKFLOW_REQUIREMENTS}}

## Instructions

- Stay within the assigned child task scope.
- Follow the repository `AGENTS.md` and package-local conventions.
- Use Pencil for `.pen` design inspection/editing when the Pencil workflow requirements say it is required.
- Include explicit Pencil screenshot evidence or saved persistence evidence when `.pen` files changed.
- Do not mutate GitHub state.
- Do not manually close issues.
- Keep worker branches local.
- Run focused checks before reporting completion.
- Do not run CodeRabbit inside the Sandcastle worker. The parent orchestrator runs `coderabbit review --agent` on the host after it applies the child diff, and host CodeRabbit remains the blocking review gate.
- If SQLCipher-backed tests cannot run because the Docker worker lacks the native `@journeyapps/sqlcipher` binding, report those checks as host-required verification and continue with typecheck, lint, and non-SQLCipher focused tests. Do not mark missing Docker SQLCipher bindings as a child implementation failure by themselves.

End with concise acceptance and verification evidence.
