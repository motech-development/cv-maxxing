# PRD-006 SQLite Schema and Persistence Baseline

## Objective

Create the SQLite metadata schema and persistence baseline for source CVs, vacancies, tailored packages, generation runs, and pending commands.

## User Value

This gives the app durable state for imports, generated outputs, resumable actions, and package history.

## Scope

- Choose and wire the SQLite access layer.
- Implement initial schema and migrations.
- Add repository or adapter boundaries for core entities.
- Ensure database paths can target isolated test locations.

## Non-Goals

- Full product workflows that consume the schema.
- Artifact file storage beyond the metadata contract.

## Requirements

- Align entities with section 10 of `ARCHITECTURE.md`.
- Keep SQLite behind infrastructure or adapter boundaries.
- Add support for pending resumable generation metadata.
- Make migrations deterministic and repeatable.

## Dependencies

- `PRD-001`
- `PRD-005`
- `ARCHITECTURE.md`

## Acceptance Criteria

- The database schema exists for `SourceCv`, `Vacancy`, `TailoredPackage`, and `GenerationRun`.
- Repositories or adapters can create and query those records in tests.
- Schema creation and migration steps are automated.

## Verification

- Add integration tests against a temporary SQLite database.
- Validate the schema against the canonical domain model in the architecture.
