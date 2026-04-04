# PRD-004 Electron Shell and Secure Process Boundaries

## Objective

Implement the secure Electron shell, preload bridge, and typed IPC foundation that enforce the architecture’s process boundaries.

## User Value

This gives the app a safe desktop runtime and prevents product logic from leaking into the renderer or unsafe shell access.

## Scope

- Configure `BrowserWindow` security defaults.
- Create the preload bridge and a typed renderer-facing API surface.
- Add initial IPC wiring and validation at the boundary.
- Ensure the shell works in dev and packaged modes.

## Non-Goals

- Feature-specific IPC handlers beyond bootstrap-safe examples.
- Persistence or generation logic.

## Requirements

- Enforce `nodeIntegration: false` and `contextIsolation: true`.
- Renderer code must not access Node APIs directly.
- IPC ownership must follow section 15 of `ARCHITECTURE.md`.
- Keep the preload API narrow and typed.

## Dependencies

- `PRD-001`
- `PRD-002`
- `ARCHITECTURE.md`

## Acceptance Criteria

- The renderer boots through preload only.
- Main, preload, and renderer boundaries are explicit in code and type definitions.
- The packaged app resolves preload and renderer assets correctly.

## Verification

- Add unit or integration tests for preload API shape where practical.
- Run the app in dev mode and packaged mode.
