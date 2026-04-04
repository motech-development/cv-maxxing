# PRD-023 Full UI and Document Design Fidelity Pass

## Objective

Bring the entire app UI and generated document output up to the intended final visual standard defined by the design sources.

## User Value

The finished product looks like the intended app rather than merely exposing the right features behind approximate layouts.

## Scope

- Review all renderer states against `design/app.pen`.
- Tighten spacing, typography, hierarchy, sizing, and interaction polish across first launch, workspace, Codex setup, library, loading, and package-browsing states.
- Review rendered CV output against `design/cv.pen` and `design/cv.html`.
- Review generated cover-letter preview and PDF presentation for consistent visual quality.
- Fix visual regressions and fidelity gaps discovered during comparison.

## Non-Goals

- New product capabilities outside the v1 architecture.
- Replacing the fixed CV template with a template system.

## Requirements

- Treat `design/app.pen` as the source of truth for desktop app states.
- Treat `design/cv.pen` as the source of truth for CV visual layout and `design/cv.html` as the implementation reference.
- Preserve established behavior and typed boundaries while improving fidelity.
- Cover both desktop app surfaces and document outputs, not just one or the other.
- Resolve visual inconsistencies with targeted changes rather than ad hoc rewrites.

## Dependencies

- `PRD-007`
- `PRD-017`
- `PRD-019`
- `PRD-020`
- `PRD-021`
- `PRD-022`
- `ARCHITECTURE.md`
- `design/app.pen`
- `design/cv.pen`
- `design/cv.html`

## Acceptance Criteria

- All major app states match the intended hierarchy and layout from `design/app.pen` closely enough to serve as the production UI.
- CV preview and exported PDF are visually aligned with the fixed template reference.
- Cover-letter preview and exported PDF meet the project’s final document quality bar and feel visually coherent with the product.
- Visual regressions introduced by earlier implementation tasks are resolved.

## Verification

- Run visual regression checks for major app states and document outputs.
- Perform a side-by-side manual review against `design/app.pen`, `design/cv.pen`, and `design/cv.html`.
- Verify that fixes do not break the existing functional flows covered by automated tests.
