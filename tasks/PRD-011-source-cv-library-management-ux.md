# PRD-011 Source CV Library Management UX

## Objective

Build the source CV library experience for listing imported CVs, selecting the default CV, and managing the workspace’s current source document.

## User Value

Users can manage multiple base CVs and clearly control which one drives future tailored versions.

## Scope

- Render the source CV library states from the app design.
- List imported CVs with relevant metadata.
- Support default selection and current selection changes.
- Wire queries and commands through typed IPC.

## Non-Goals

- Deletion or archive policies beyond what the architecture already fixes.
- Editing CV content in place.

## Requirements

- Follow the `Source CV Library` area in section 14 of `ARCHITECTURE.md`.
- Use persisted CV metadata instead of renderer-local fake state.
- Preserve immutability of imported artifacts.

## Dependencies

- `PRD-006`
- `PRD-008`
- `PRD-009`
- `PRD-007`

## Acceptance Criteria

- The app lists available source CVs and highlights the default CV.
- The user can change the default CV and the selection persists.
- The UI remains functional after app restart.

## Verification

- Add integration coverage for default-selection persistence.
- Add renderer or e2e coverage for library interaction.
