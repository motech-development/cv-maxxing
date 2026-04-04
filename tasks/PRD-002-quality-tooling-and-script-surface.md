# PRD-002 Quality Tooling and Script Surface

## Objective

Add the baseline developer tooling, package scripts, and static quality gates required by the architecture.

## User Value

Agents can build features against one predictable command surface and one consistent quality contract.

## Scope

- Add linting and formatting-compatible tooling.
- Add `pnpm` scripts for dev, type-check, lint, test, build, and package flows.
- Establish shared config files for TypeScript and linting.

## Non-Goals

- CI workflow implementation.
- Feature tests beyond smoke checks for the scaffold.

## Requirements

- Script coverage must match section 19.2 of `ARCHITECTURE.md`.
- `pnpm test` must aggregate at least unit and integration suites.
- Do not weaken lint rules to make the scaffold pass.
- The script surface must work on a clean clone after dependency install.

## Dependencies

- `PRD-001`
- `ARCHITECTURE.md`

## Acceptance Criteria

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm package:mac` or an equivalent packaged-build command exist.
- Lint and type-check pass on the scaffold.
- The tooling configuration does not rely on global machine state.

## Verification

- Execute lint, type-check, test, and build scripts locally.
- Verify the package manifest documents the expected command surface.
