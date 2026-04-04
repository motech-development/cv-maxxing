# PRD-012 Vacancy Intake Drafts and URL Classification

## Objective

Implement vacancy intake commands, draft persistence, and source classification for URL, pasted-text, and imported-file paths.

## User Value

Users can start a tailoring request from real job inputs and recover their work if Codex setup or fetching blocks progress.

## Scope

- Build vacancy intake form state and typed commands.
- Persist normalized vacancy drafts before generation.
- Classify vacancy sources by board and source type.
- Support `url`, `pasted_text`, and `imported_file` intake modes.

## Non-Goals

- Full live fetching for every board.
- Tailoring or rendering outputs.

## Requirements

- Align with section 8.1 and section 7.9 of `ARCHITECTURE.md`.
- Preserve vacancy drafts across blocked Codex setup flows.
- Expose board classification for downstream fetcher selection.

## Dependencies

- `PRD-006`
- `PRD-007`
- `ARCHITECTURE.md`

## Acceptance Criteria

- The user can enter vacancy data through all v1 intake modes.
- Draft vacancy data persists before generation starts.
- URL classification produces `linkedin`, `indeed`, `greenhouse`, `generic`, or `unknown`.

## Verification

- Add unit tests for URL classification.
- Add integration tests for draft persistence and reload behavior.
