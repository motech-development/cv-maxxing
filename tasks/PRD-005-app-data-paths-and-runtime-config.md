# PRD-005 App-Data Paths and Runtime Config

## Objective

Implement deterministic app-data path management and runtime configuration resolution for dev, test, and packaged environments.

## User Value

The app can persist data safely, tests can run in isolation, and runtime behaviors such as Codex preflight timeout can be tuned without recompiling.

## Scope

- Create app-data root resolution logic.
- Add runtime config loading for environment variables and persisted settings.
- Define dev, test, and packaged path behavior.
- Add typed config access for the main process.

## Non-Goals

- Full settings UI.
- Database schema or artifact persistence implementation.

## Requirements

- Support runtime resolution for `CHECKING_TIMEOUT_MS` and `checkingTimeout`.
- Keep secrets out of plain config files.
- Make test roots injectable.
- Document the path layout expected by the architecture.

## Dependencies

- `PRD-001`
- `PRD-004`
- `ARCHITECTURE.md`

## Acceptance Criteria

- The app can resolve stable storage roots in dev, test, and packaged modes.
- The main process can read effective runtime config values through one typed path.
- Tests can override storage roots without mutating real user data.

## Verification

- Add unit tests for config precedence and path resolution.
- Validate the resolved layout against section 11 of `ARCHITECTURE.md`.
