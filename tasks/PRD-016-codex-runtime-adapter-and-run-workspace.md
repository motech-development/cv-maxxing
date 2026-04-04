# PRD-016 Codex Runtime Adapter and Run Workspace

## Objective

Implement the Codex runtime port, local CLI adapter, and per-run workspace layout for structured generation jobs.

## User Value

The product can use Codex as a real structured worker with reproducible inputs, outputs, and logs instead of brittle prompt strings.

## Scope

- Define the `CodexRuntimePort`.
- Implement the local CLI adapter in the main process.
- Create per-run workspace directories and artifact contracts.
- Add JSON schema validation for input and output files.

## Non-Goals

- User-facing preflight screens.
- Full tailoring orchestration across vacancy and CV flows.

## Requirements

- Match section 7 of `ARCHITECTURE.md`.
- Use structured input and output artifacts only.
- Keep runtime execution isolated from the renderer.
- Persist run logs and workspace paths in metadata.

## Dependencies

- `PRD-005`
- `PRD-006`
- `ARCHITECTURE.md`

## Acceptance Criteria

- A generation run can create a run workspace with `input`, `output`, and log artifacts.
- The app can invoke Codex through the adapter and validate structured outputs.
- Runtime failures are captured as typed results and persisted logs.

## Verification

- Add integration tests with a fake or fixture-backed Codex adapter.
- Validate workspace layout and schema enforcement in tests.
