# PRD-019 CV Renderer, Preview, and PDF Export

## Objective

Implement the shared CV render pipeline that turns tailored CV JSON into a previewable HTML document and exported PDF aligned with `design/cv.html`.

## User Value

Users can trust that what they preview in the app is what they export as a PDF.

## Scope

- Create the CV render view model.
- Generate HTML from structured tailored CV content.
- Render the preview inside the app.
- Export the same rendered artifact to PDF through Chromium.

## Non-Goals

- Cover-letter rendering.
- Manual CV editing.

## Requirements

- Use `design/cv.pen` for visual validation and `design/cv.html` as the implementation reference.
- Keep pagination in the renderer, not in Codex output.
- Use one shared path for preview and PDF export as described in section 13.2 of `ARCHITECTURE.md`.

## Dependencies

- `PRD-007`
- `PRD-018`
- `ARCHITECTURE.md`
- `design/cv.pen`
- `design/cv.html`

## Acceptance Criteria

- Tailored CV JSON renders to an HTML structure aligned with `design/cv.html`.
- The preview surface and exported PDF originate from the same render output.
- Layout validation can detect overflow or pagination failures.

## Verification

- Add unit tests for render view-model and pagination logic.
- Add visual regression coverage for the rendered CV.
- Add integration coverage for PDF artifact creation.
