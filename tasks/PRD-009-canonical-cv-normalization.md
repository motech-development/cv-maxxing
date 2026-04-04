# PRD-009 Canonical CV Normalization

## Objective

Normalize imported source CV content into the canonical CV JSON model used by generation and rendering.

## User Value

All downstream tailoring and rendering work can operate on one stable structured representation instead of brittle document parsing logic.

## Scope

- Define the canonical CV schema.
- Transform extracted source text into structured CV JSON.
- Persist the normalized model to app storage and metadata records.
- Handle incomplete or sparse CV content gracefully.

## Non-Goals

- Vacancy matching.
- Cover-letter generation.

## Requirements

- Align the schema with section 9.3 of `ARCHITECTURE.md`.
- Use validation to reject malformed normalized outputs.
- Keep normalization logic independently testable from UI and storage adapters.

## Dependencies

- `PRD-008`
- `ARCHITECTURE.md`

## Acceptance Criteria

- Imported CVs produce validated canonical JSON with the required core sections.
- Normalized artifacts are persisted and linked from the source CV record.
- The normalization path handles missing optional sections without crashing.

## Verification

- Add unit tests for normalization edge cases.
- Add integration coverage for persistence of normalized CV artifacts.
