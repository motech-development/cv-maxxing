# PRD-015 Generic Fallback Fetcher and Vacancy Normalization

## Objective

Implement the generic vacancy fetch path for non-board-specific pages, including text extraction and normalized vacancy modeling.

## User Value

Users are not blocked when a role is hosted on a custom careers site or any page outside the named adapters.

## Scope

- Add generic HTTP fetch logic.
- Extract readable job text from arbitrary pages.
- Normalize extracted content into the vacancy schema.
- Persist generic vacancy artifacts through the same storage contract as named boards.

## Non-Goals

- Browser-authenticated flows better handled by board-specific adapters.
- Final Codex tailoring.

## Requirements

- Use the layered fallback flow from section 8.4 of `ARCHITECTURE.md`.
- Keep the normalized vacancy model consistent across all fetchers.
- Persist source URL, board classification, raw text, and normalized output.

## Dependencies

- `PRD-012`
- `PRD-005`
- `PRD-006`
- `ARCHITECTURE.md`

## Acceptance Criteria

- Non-board pages can be fetched and normalized through the fallback path.
- Normalized vacancy output passes schema validation.
- Downstream consumers can treat fallback vacancies the same as named-board vacancies.

## Verification

- Add integration tests with generic HTML fixtures.
- Add unit tests for normalization edge cases.
