# PRD-001 Repo Workspace Scaffold

## Objective

Create the production-shaped repository scaffold for the Electron desktop app using `pnpm`, TypeScript, React, Vite, and explicit `main` / `preload` / `renderer` boundaries.

## User Value

This gives every later feature task a stable foundation instead of forcing agents to invent project structure ad hoc.

## Scope

- Create the `pnpm` workspace layout.
- Scaffold the Electron app shell and entry points.
- Establish the top-level source directories from the architecture.
- Configure TypeScript project structure for separated process boundaries.

## Non-Goals

- Implement product features.
- Add persistence or business logic beyond basic bootstrap wiring.

## Requirements

- Align with the directory shape in `ARCHITECTURE.md`.
- Use ES Modules only.
- Keep imports and aliases consistent with clean process boundaries.
- Include a runnable local development entry point.

## Dependencies

- `ARCHITECTURE.md`

## Acceptance Criteria

- The repo contains a working Electron + React + TypeScript + Vite scaffold.
- `src/main`, `src/preload`, `src/renderer`, `src/domain`, `src/application`, and `tests` exist.
- The app can launch a placeholder desktop window in development mode.
- TypeScript configuration separates main, preload, and renderer concerns cleanly.

## Verification

- Run the dev entry point successfully.
- Run the build command successfully.
- Confirm the repository layout matches the architecture document.
