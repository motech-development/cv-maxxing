# PRD-017 Codex Preflight, Sign-In, and Resumable Generation

## Objective

Implement Codex preflight, sign-in-required handling, unavailable-state handling, and resumable generation commands.

## User Value

Users can attempt to create a version without losing their vacancy draft or getting blocked permanently by local Codex setup issues.

## Scope

- Implement `CodexPreflightResult` handling in the main process.
- Add preload APIs for preflight, sign-in, retry, and setup guidance.
- Persist resumable pending generation commands.
- Wire the dedicated `Checking`, `Sign In Required`, and `Unavailable` screen states.

## Non-Goals

- Final tailoring generation logic.
- Broad settings management beyond the preflight flow.

## Requirements

- Follow sections 7.6 through 7.9 and section 14 of `ARCHITECTURE.md`.
- Resolve `CHECKING_TIMEOUT_MS`, then `checkingTimeout`, then the default `12000`.
- Preserve vacancy drafts and source CV selection across blocked runs.
- Keep `Checking` non-cancellable in v1 and route retries back through fresh preflight.

## Dependencies

- `PRD-007`
- `PRD-012`
- `PRD-016`
- `PRD-006`
- `ARCHITECTURE.md`

## Acceptance Criteria

- The app exposes typed preflight states exactly as documented.
- Sign-in-required and unavailable flows preserve resumable generation context.
- Retry and cancel behaviors follow the architecture transition rules.

## Verification

- Add integration tests for preflight state transitions and timeout behavior.
- Add e2e coverage for ready, sign-in-required, and unavailable flows.
