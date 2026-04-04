# PRD-018 Tailoring Pipeline and Validation

## Objective

Implement the end-to-end tailoring pipeline that maps a source CV and vacancy into structured tailored CV and cover-letter outputs with factual and style validation.

## User Value

Users receive a truthful tailored package that is aligned to the role without inventing claims or sounding like generic AI output.

## Scope

- Assemble normalized generation inputs.
- Extract vacancy priorities and map source evidence.
- Generate tailored CV JSON and cover-letter JSON.
- Run factual consistency and style validation before outputs are accepted.

## Non-Goals

- HTML rendering and PDF export.
- Package browsing UX beyond status updates.

## Requirements

- Enforce the guardrails in section 12.1 of `ARCHITECTURE.md`.
- Treat validation failures as retryable or failed generation outcomes with typed reasons.
- Persist change summaries, confidence notes, and trace metadata.

## Dependencies

- `PRD-009`
- `PRD-010`
- `PRD-013`
- `PRD-014`
- `PRD-015`
- `PRD-016`
- `PRD-017`
- `ARCHITECTURE.md`

## Acceptance Criteria

- The pipeline can produce validated tailored CV and cover-letter artifacts from normalized inputs.
- Factual violations and style violations are detected and surfaced explicitly.
- Successful runs persist package-ready structured outputs and summaries.

## Verification

- Add unit tests for factual and style validators.
- Add integration coverage from normalized inputs through validated structured outputs.
