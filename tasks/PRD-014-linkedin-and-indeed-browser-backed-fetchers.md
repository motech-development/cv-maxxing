# PRD-014 LinkedIn and Indeed Browser-Backed Fetchers

## Objective

Implement browser-assisted vacancy fetchers for LinkedIn and Indeed with app-managed local session storage.

## User Value

The app can ingest major job boards even when static retrieval is incomplete or blocked.

## Scope

- Add hidden browser fetch orchestration in the main process.
- Support persistent local browser profiles for authenticated viewing when needed.
- Capture page snapshot artifacts, extracted text, and normalized vacancy models.
- Handle blocked, expired, and partially loaded pages safely.

## Non-Goals

- Arbitrary browser automation exposed to the renderer.
- Remote session synchronization.

## Requirements

- Keep browser execution in the main process only.
- Never expose raw session tokens to the renderer.
- Persist browser-derived vacancy snapshots as described in section 8.5 and section 16 of `ARCHITECTURE.md`.

## Dependencies

- `PRD-012`
- `PRD-004`
- `PRD-005`
- `PRD-006`
- `ARCHITECTURE.md`

## Acceptance Criteria

- LinkedIn and Indeed vacancies can be fetched through a browser-backed path.
- The fetcher can reuse an app-managed local profile when authentication is required.
- Snapshot, text, and normalized artifacts are persisted with typed status reporting.

## Verification

- Add integration coverage with recorded fixtures or controlled browser mocks.
- Add environment-test coverage for optional live verification if the repo supports it.
