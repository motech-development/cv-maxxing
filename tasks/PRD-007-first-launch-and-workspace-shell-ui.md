# PRD-007 First-Launch and Workspace Shell UI

## Objective

Build the renderer shell and primary screen states defined in `design/app.pen` for first launch, empty workspace, loading workspace, and active workspace.

## User Value

Users can understand the product flow immediately and later tasks can attach real workflows to stable screen states instead of placeholder UI.

## Scope

- Implement top-level app routes or screen modes.
- Reproduce the shell layout from `design/app.pen`.
- Add placeholder state wiring for first launch, empty, loading, and active workspace views.
- Keep the preview, side rails, and package list regions structurally present.

## Non-Goals

- Real source CV import, vacancy fetch, or generation logic.
- Final styling polish and exact visual acceptance; those are completed in `PRD-023`.

## Requirements

- Follow section 14 of `ARCHITECTURE.md`.
- Keep renderer concerns limited to view composition and typed command submission.
- Make screen transitions injectable from app state so later features can reuse them.

## Dependencies

- `PRD-001`
- `PRD-004`
- `ARCHITECTURE.md`
- `design/app.pen`

## Acceptance Criteria

- The app renders first-launch, empty, loading, and active workspace states.
- The top-level layout regions align with the architecture and design sources.
- State switching does not require page reloads or ad hoc renderer side effects.
- The shell is implementation-ready for later visual fidelity work without structural rewrites.

## Verification

- Add renderer tests for screen-state mapping.
- Add a Playwright or visual smoke check for the top-level shell.
