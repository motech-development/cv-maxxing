# PRD-020 Cover Letter Generation, Preview, and PDF Export

## Objective

Deliver the cover-letter pipeline from structured generation output through HTML rendering, in-app PDF preview, and PDF export.

## User Value

Users can generate a style-matched cover letter and review or export it without leaving the desktop app.

## Scope

- Finalize the cover-letter structured contract.
- Implement dedicated cover-letter HTML rendering.
- Produce a PDF artifact through the shared Chromium export path.
- Surface cover-letter preview and export actions in the workspace.

## Non-Goals

- Rich text editing of generated cover letters.
- Alternative cover-letter templates.

## Requirements

- Align with section 13.1.1 and section 13.2 of `ARCHITECTURE.md`.
- The cover letter must preserve the imported CV’s writing style.
- Preview the generated PDF artifact in-app rather than a separate non-PDF-only representation.

## Dependencies

- `PRD-010`
- `PRD-018`
- `PRD-019`
- `ARCHITECTURE.md`

## Acceptance Criteria

- The app can persist, preview, and export a generated cover-letter PDF.
- The cover-letter renderer uses the shared Chromium export pipeline.
- Workspace actions expose cover-letter preview and export alongside the tailored CV.

## Verification

- Add integration coverage for cover-letter artifact generation.
- Add e2e coverage for previewing and exporting the cover-letter PDF.
