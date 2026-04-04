# PRD-021 Immutable Package History, Browsing, and Regeneration UX

## Objective

Build the immutable package history experience for browsing saved tailored versions, reopening exact artifacts, comparing versions, and regenerating into new packages.

## User Value

Users can safely review prior outputs, compare iterations, and create new versions without ever mutating past generated artifacts.

## Scope

- List saved tailored packages in the workspace.
- Reopen a specific package and its artifacts.
- Surface package metadata, generation summaries, and comparison affordances.
- Implement regeneration as a new package creation flow.

## Non-Goals

- In-place editing of generated documents.
- Collaborative or multi-user package management.

## Requirements

- Preserve the immutability rules in section 12.4 of `ARCHITECTURE.md`.
- Export actions must always target a specific immutable package id.
- Regeneration must create a new package record and leave older ones untouched.

## Dependencies

- `PRD-006`
- `PRD-011`
- `PRD-018`
- `PRD-019`
- `PRD-020`
- `ARCHITECTURE.md`

## Acceptance Criteria

- The user can browse prior packages and reopen exact CV and cover-letter artifacts.
- Regeneration creates a new package instead of mutating an existing one.
- The UI shows enough metadata to distinguish package versions confidently.

## Verification

- Add integration coverage for immutable package persistence.
- Add e2e coverage for browsing a saved package and regenerating a new one.
