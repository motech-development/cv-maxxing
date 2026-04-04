# PRD-003 Test Harness and CI Baseline

## Objective

Establish the automated test harness and pull-request CI workflow required for ongoing development.

## User Value

The project can reject regressions early and future agents can prove work without inventing their own verification path.

## Scope

- Configure Vitest for unit and integration testing.
- Configure Playwright for Electron end-to-end smoke coverage.
- Add test fixtures and isolated test temp-path handling.
- Add CI workflows for lint, type-check, tests, and build verification.

## Non-Goals

- Full product test coverage.
- Release publishing or notarization automation.

## Requirements

- CI must follow the baseline defined in sections 19.5 and 22 of `ARCHITECTURE.md`.
- Tests must support isolated app-data and database paths.
- End-to-end smoke coverage must be runnable locally.
- CI must cache `pnpm` dependencies and surface failure artifacts where relevant.

## Dependencies

- `PRD-001`
- `PRD-002`
- `ARCHITECTURE.md`

## Acceptance Criteria

- Unit, integration, and e2e harnesses exist with at least one passing smoke test each.
- Pull request CI runs lint, type-check, tests, and build verification.
- The test environment does not require a globally installed Codex runtime for mandatory suites.

## Verification

- Run `pnpm test`.
- Run the e2e smoke command locally.
- Confirm CI passes on a branch with the new workflow enabled.
