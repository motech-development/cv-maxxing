# PRD-008 Source CV Import Pipeline

## Objective

Implement the import pipeline for PDF and DOCX source CV files, including original-file storage and extracted text persistence.

## User Value

Users can bring their real source CVs into the product as the basis for all tailoring work.

## Scope

- Add file import commands for PDF and DOCX.
- Copy the original file into app-managed storage.
- Extract raw text and basic metadata such as page count where available.
- Persist import metadata in SQLite and filesystem storage.

## Non-Goals

- Canonical CV normalization.
- Writing-style profile computation.

## Requirements

- Support PDF and DOCX only in v1.
- Store originals and extracted text using the artifact layout from section 11 of `ARCHITECTURE.md`.
- Fail safely on unsupported or unreadable files with typed errors.

## Dependencies

- `PRD-005`
- `PRD-006`
- `ARCHITECTURE.md`

## Acceptance Criteria

- A user can import a PDF or DOCX file into app-managed storage.
- The app persists the original file path, extracted text path, and import metadata.
- The import command is testable without touching real user directories.

## Verification

- Add integration tests using fixture PDF and DOCX files.
- Verify stored artifacts and metadata records are created together.
