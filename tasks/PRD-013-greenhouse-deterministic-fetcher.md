# PRD-013 Greenhouse Deterministic Fetcher

## Objective

Implement the deterministic Greenhouse vacancy fetcher using HTTP retrieval and DOM parsing.

## User Value

Users can reliably ingest Greenhouse job pages without needing browser automation for the common case.

## Scope

- Detect Greenhouse URLs.
- Fetch vacancy content through deterministic HTTP.
- Parse and extract raw HTML, cleaned text, and normalized vacancy fields.
- Persist the vacancy snapshot artifacts.

## Non-Goals

- Browser-backed login flows.
- Generic fallback handling outside Greenhouse pages.

## Requirements

- Follow the adapter strategy in section 8.3 and section 8.4 of `ARCHITECTURE.md`.
- Persist raw HTML, extracted text, and normalized vacancy JSON.
- Return typed fetch errors and classification metadata.

## Dependencies

- `PRD-012`
- `PRD-005`
- `PRD-006`
- `ARCHITECTURE.md`

## Acceptance Criteria

- Greenhouse URLs can be fetched and parsed into persisted vacancy artifacts.
- Normalized vacancy fields include core job metadata when present.
- The fetcher is isolated behind the vacancy fetcher port.

## Verification

- Add integration tests using stored Greenhouse fixtures.
- Validate persisted artifacts and normalized output shape.
