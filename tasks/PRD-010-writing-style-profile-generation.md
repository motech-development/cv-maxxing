# PRD-010 Writing-Style Profile Generation

## Objective

Generate and persist a `WritingStyleProfile` for each imported source CV so cover-letter generation can preserve tone and avoid obvious AI phrasing.

## User Value

Cover letters can sound like the user’s original professional style instead of generic generated copy.

## Scope

- Define the writing-style profile schema.
- Compute style signals from normalized or extracted CV text.
- Persist the style profile artifact and metadata linkage.
- Expose profile retrieval for downstream generation services.

## Non-Goals

- Final cover-letter generation.
- User-facing style editing controls.

## Requirements

- Cover sentence length, tone formality, vocabulary tendency, person tendency, punctuation patterns, and banned phrase handling.
- Keep the style profile deterministic enough for tests.
- Align with section 9.4 and section 12.3 of `ARCHITECTURE.md`.

## Dependencies

- `PRD-009`
- `ARCHITECTURE.md`

## Acceptance Criteria

- Each source CV can produce a validated writing-style profile artifact.
- The profile is retrievable by downstream services through a typed interface.
- The profile schema is covered by automated tests.

## Verification

- Add unit tests for style extraction heuristics.
- Add integration tests that persist and reload style profiles.
