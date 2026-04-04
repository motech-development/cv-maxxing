# CV Maxxing Architecture

Status: Decisioned v1 architecture based on confirmed requirements as of April 4, 2026.

## 1. Reconnaissance Digest

- Repository state observed:
  - `package.json` exists and declares `pnpm@10.28.0`
  - no Electron app, TypeScript config, lockfile, Docker config, tests, or database schema exist yet
  - design assets present:
    - `design/app.pen`
    - `design/cv.pen`
    - `design/cv.html`
- `design/app.pen` defines the desktop states we need to build:
  - first launch
  - workspace empty
  - workspace loading
  - workspace active
  - source CVs empty
  - source CVs active
- `design/cv.pen` and `design/cv.html` define a two-page A4 CV template with fixed layout and Manrope typography.
- The active workspace design already implies these product areas:
  - source CV library
  - vacancy intake
  - saved tailored versions list
  - preview surface
  - export actions
  - side rail with role details and adaptation summary

## 2. Confirmed Product Decisions

These are now fixed inputs to the architecture.

- The app may call the internet where needed.
- The app must use Codex for the AI work, in a pattern similar to OpenClaw’s Codex-backed workflows.
- The app must fetch vacancy data from live job URLs.
- v1 target platform is macOS Intel.
- Tailoring may strengthen phrasing if it remains truthful.
- Tailored outputs are immutable once generated.
- The app should also generate cover letters.
- Cover-letter writing style must match the source CV and must not read as obvious AI output.
- Cover letters must be exportable as PDF from inside the app and previewable in-app as generated PDFs.
- Only one fixed CV template is required.

## 3. External Constraints That Shape the Design

### 3.1 Codex is mandatory

This architecture therefore treats Codex as the primary generation runtime, not an optional provider.

### 3.2 Live URL ingestion is mandatory

This rules out paste-only intake. The system must support real fetch and parse flows for:

- LinkedIn
- Indeed
- Greenhouse
- generic fallback pages

### 3.3 Output immutability is mandatory

The app should not expose a freeform editor for generated CVs or cover letters. The user can:

- generate
- preview
- compare
- export
- regenerate

The user cannot directly edit the generated document body in v1.

### 3.4 Single fixed template is mandatory

The rendering layer should optimize around one template only:

- `design/cv.pen` is the visual source of truth
- `design/cv.html` is the implementation reference

No template abstraction is needed in v1 beyond internal clean separation.

## 4. Recommended Product Shape

Build this as an Electron-first local desktop monolith.

Do not introduce a required web backend for v1.

Do not introduce Docker in the baseline path.

Rationale:

- the product is single-user
- all files are local
- preview and PDF export are local
- SQLite is enough
- Electron can host the whole workflow
- Docker would add operational weight without solving a real v1 problem

Docker remains optional later for isolated helpers such as OCR or browser workers, but it should not be required to run the app.

## 5. Architecture Summary

```text
Electron Desktop App
├── Main Process
│   ├── Window lifecycle
│   ├── IPC router
│   ├── Source CV library service
│   ├── Vacancy ingestion service
│   ├── Codex orchestration service
│   ├── Tailored package service
│   ├── HTML/PDF rendering service
│   ├── SQLite persistence
│   └── Local file storage
├── Preload
│   └── Typed renderer-safe API
└── Renderer
    ├── React + TypeScript UI
    ├── design/app.pen-aligned screens
    ├── preview surface
    └── immutable version browsing
```

## 6. Primary Technical Decisions

| Area | Decision |
|---|---|
| App shell | Electron + React + TypeScript |
| Package manager | `pnpm` |
| Persistence | SQLite + local filesystem |
| AI runtime | Codex-first local orchestration adapter |
| Vacancy fetch | deterministic fetchers first, browser automation second, Codex extraction third |
| CV rendering | shared HTML renderer derived from `design/cv.html` |
| PDF export | Chromium `printToPDF()` from hidden render surface |
| Cover letters | generated alongside tailored CV package, style-matched, immutable, previewed in-app as PDF, exportable as PDF |
| Backend | none required for v1 |
| Docker | not required for v1 |

## 7. Codex Runtime Architecture

### 7.1 Why a Codex runtime adapter is needed

The app must use Codex, but the rest of the app cannot depend directly on a specific CLI or backend transport.

So the app needs a dedicated `CodexRuntimePort`.

```text
CodexRuntimePort
└── CodexCliRuntimeAdapter
```

### 7.2 Recommended v1 approach

Recommendation: integrate with a local Codex CLI runtime adapter from the Electron main process.

The Electron app should:

- prepare a structured task workspace for each generation run
- write normalized source inputs to JSON files
- invoke Codex in a controlled subprocess
- request structured JSON output only
- read the result artifact back into the app

Why this is the strongest Codex-first architecture:

- it keeps Codex as the real worker, not just GPT prompting under another name
- it aligns with Codex local-machine workflows
- it avoids baking undocumented backend coupling into the app
- it gives us a strong audit trail for every generation run

### 7.3 Runtime contract

Each generation job should provide Codex with:

- normalized source CV JSON
- extracted source CV text
- normalized vacancy JSON
- fetched vacancy raw text and metadata
- rendering contract
- truthfulness rules
- style-preservation rules
- output JSON schema

Each generation job should expect back:

- tailored CV JSON
- cover letter JSON
- cover letter render model or structured section model
- change summary
- confidence notes
- trace metadata

### 7.4 Codex workspace layout

Use a per-run local workspace such as:

```text
app-data/runs/{runId}/
├── input/
│   ├── source-cv.json
│   ├── source-cv.txt
│   ├── vacancy.json
│   ├── vacancy.txt
│   └── task.json
├── output/
│   ├── tailored-cv.json
│   ├── cover-letter.json
│   ├── summary.json
│   └── run.log
└── temp/
```

This gives reproducibility and debugging without exposing raw internals to the renderer.

### 7.5 Why not drive everything through ad hoc prompting

The app should not send only giant prompt strings and trust freeform prose.

Codex must be treated as a structured worker with:

- deterministic input artifacts
- structured output artifacts
- schema validation
- retry logic
- failure capture

That is the difference between a toy wrapper and a real desktop product.

## 8. Vacancy Ingestion Architecture

### 8.1 Intake modes

The app should support:

1. live URL fetch
2. pasted text
3. saved page/file import

Live URL fetch is the primary path. The others are resilience paths.

### 8.2 Fetch pipeline

Use a layered ingestion strategy:

```text
1. URL classification
2. Deterministic fetch adapter
3. Browser-assisted fetch when needed
4. Text extraction and cleanup
5. Codex-assisted structuring
6. Persist snapshot and structured vacancy model
```

### 8.3 Source adapters

```text
VacancyFetcherPort
├── GreenhouseFetcher
├── LinkedInFetcher
├── IndeedFetcher
└── GenericFetcher
```

### 8.4 Fetch strategy by source

#### Greenhouse

Use deterministic HTTP fetch and DOM parsing first.

#### LinkedIn and Indeed

Use a browser-backed fetch path when static retrieval is incomplete or blocked.

Recommended implementation:

- Playwright-driven hidden browser context managed by main process
- persistent local profile support for authenticated sessions when required
- page snapshot persisted after fetch

#### Generic fallback

Use:

- standard HTTP fetch
- readability / article extraction
- DOM text extraction
- Codex-assisted field normalization

### 8.5 Persisted vacancy artifacts

Always persist:

- original URL
- board classification
- fetch timestamp
- raw HTML or browser snapshot
- extracted text
- normalized vacancy JSON

This matters because job listings disappear, mutate, and sometimes return different HTML on later requests.

## 9. Source CV Import Architecture

### 9.1 Supported formats

v1 source inputs:

- PDF
- DOCX

### 9.2 Import pipeline

```text
1. Copy original file into app storage
2. Extract text and metadata
3. Normalize into canonical CV JSON
4. Compute style fingerprint
5. Persist source record
```

### 9.3 Canonical CV model

Use a structured JSON model as the single source of truth for generation and rendering.

Core sections:

- identity
- contact
- summary
- experience
- selected work
- impact highlights
- skills
- tools
- education
- certifications
- languages
- focus
- references

### 9.4 Style fingerprint

Because cover letters must match the original CV style, every imported CV should also generate a `WritingStyleProfile`.

This profile should capture:

- sentence length tendencies
- tone formality
- preferred vocabulary
- first-person vs third-person tendency
- punctuation patterns
- cliché blacklist
- banned AI phrases

This becomes a hard constraint in cover-letter generation.

## 10. Canonical Domain Model

### `SourceCv`

- id
- displayName
- originalFilePath
- originalFileType
- importedAt
- checksum
- pageCount
- extractedTextPath
- normalizedCvPath
- writingStyleProfilePath
- isDefault

### `Vacancy`

- id
- sourceType: `url | pasted_text | imported_file`
- sourceUrl
- sourceBoard: `linkedin | indeed | greenhouse | generic | unknown`
- rawHtmlPath
- rawTextPath
- normalizedVacancyPath
- title
- employer
- location
- fetchedAt

### `TailoredPackage`

- id
- sourceCvId
- vacancyId
- status: `queued | fetching | generating | rendering | ready | failed`
- createdAt
- updatedAt
- tailoringStrategyVersion
- renderTemplateVersion
- changeSummaryPath
- tailoredCvPath
- coverLetterPath
- cvHtmlPath
- cvPdfPath

### `GenerationRun`

- id
- tailoredPackageId
- runWorkspacePath
- codexTaskVersion
- startedAt
- finishedAt
- status
- logPath
- failureReason

## 11. Persistence Strategy

Use:

- SQLite for metadata
- local filesystem for large artifacts

Suggested local storage shape:

```text
app-data/
├── app.db
├── source-cvs/
│   └── {sourceCvId}/
│       ├── original.pdf
│       ├── extracted.txt
│       ├── normalized.json
│       └── style-profile.json
├── vacancies/
│   └── {vacancyId}/
│       ├── snapshot.html
│       ├── extracted.txt
│       └── normalized.json
├── packages/
│   └── {packageId}/
│       ├── tailored-cv.json
│       ├── cover-letter.json
│       ├── cv.html
│       └── cv.pdf
└── runs/
    └── {runId}/
        ├── input/
        ├── output/
        └── run.log
```

## 12. Tailoring Pipeline

### 12.1 Guardrail policy

The system may strengthen language, but it must not lie.

Allowed:

- stronger summarization
- reordering achievements
- skill emphasis shifts
- more explicit alignment to vacancy language
- compression and prioritization
- cover-letter framing based on real evidence

Not allowed:

- invented companies
- invented technologies
- invented dates
- invented metrics
- invented degrees
- invented certifications
- invented job responsibilities

### 12.2 Pipeline stages

```text
1. Normalize source CV
2. Compute writing-style profile
3. Fetch and normalize vacancy
4. Extract vacancy priority signals
5. Map source evidence to vacancy priorities
6. Generate tailored CV JSON
7. Generate cover-letter JSON
8. Validate factual consistency
9. Validate style consistency
10. Render CV HTML
11. Export CV PDF
12. Persist immutable package
```

### 12.3 Style-preserving cover-letter generation

The cover-letter generator must not behave like a generic marketing writer.

Use a dedicated style-control step:

```text
Source CV
-> WritingStyleProfile
-> CoverLetterPromptContract
-> Codex generation
-> StyleSimilarityValidator
```

The validator should reject or retry outputs that show:

- generic AI openings
- inflated enthusiasm not present in the CV tone
- repetitive transition phrases
- overly polished corporate filler
- vocabulary drift far outside the source CV style

### 12.4 Immutable output model

Since the user does not want manual edits:

- every package is versioned
- regeneration creates a new package
- no in-place edits are allowed
- exports always map to a specific immutable package id

## 13. Rendering and PDF Export

### 13.1 CV rendering source of truth

Use:

- `design/cv.pen` for visual validation
- `design/cv.html` for the implementation skeleton

### 13.1.1 Cover-letter rendering source of truth

V1 must also render cover letters to PDF inside the app.

Recommendation:

- implement a dedicated cover-letter HTML renderer
- reuse the same Chromium-based preview/export pipeline as the CV
- keep the visual language aligned with the imported CV tone and the app’s restrained document style

The cover letter does not need to reuse the exact CV layout, but it must be generated as a real PDF artifact and previewed in-app as that PDF output.

### 13.2 Shared render path

Use one render path for:

- preview
- PDF export

Pipeline:

```text
Tailored CV JSON
-> render view model
-> HTML string matching cv.html structure
-> preview in renderer
-> hidden BrowserWindow
-> printToPDF()
```

This keeps preview and exported PDF aligned.

For cover letters, use the same rule:

- generate structured cover-letter data
- render to HTML
- produce PDF through the shared Chromium pipeline
- preview the generated PDF in-app before export

### 13.3 Page handling

The renderer must own pagination.

Codex should not decide page breaks directly.

Codex produces structured content. The renderer decides:

- what lands on page 1
- what overflows to page 2
- how long each block may be
- when a package fails layout validation

## 14. UI Architecture

Map the renderer directly to `design/app.pen`.

### Screens and states

#### First Launch

- import first source CV
- explain supported formats
- explain next steps

#### Source CV Library

- current default source CV
- available source CVs
- add/remove/select default

#### Workspace Active

- left sidebar: saved tailored packages
- main control strip: job intake and generation summary
- preview stage: current CV preview
- right rail: vacancy details and export actions

#### Loading / Processing

- show package state transitions from the main process job engine

### UI rule

The renderer never performs generation or fetch logic directly.

The renderer only:

- submits commands
- queries package state
- renders previews

## 15. Electron Process Boundaries

### Main process owns

- filesystem access
- SQLite access
- Codex process execution
- browser-assisted vacancy fetch
- HTML rendering for PDF export
- secure settings storage

### Preload owns

- typed API surface
- input validation at boundary

### Renderer owns

- React state
- screen composition
- immutable package browsing
- preview presentation

## 16. Security and Privacy

### Baseline Electron security

- `nodeIntegration: false`
- `contextIsolation: true`
- strict preload bridge
- no arbitrary shell access from renderer

### Sensitive data

The app handles personal and potentially sensitive employment data.

Store locally only:

- source CVs
- vacancy snapshots
- tailored packages
- cover letters

If Codex auth or API secrets are needed, store them in the OS keychain rather than plain app config.

### Browser session handling

For LinkedIn or Indeed paths that need authenticated viewing:

- use a dedicated local browser profile
- keep the profile under app-managed local storage
- never surface raw session tokens to the renderer

## 17. Suggested Codebase Structure

```text
src/
├── main/
│   ├── bootstrap/
│   ├── ipc/
│   ├── services/
│   │   ├── codex/
│   │   ├── vacancy/
│   │   ├── source-cv/
│   │   ├── packages/
│   │   └── render/
│   └── infrastructure/
├── preload/
├── renderer/
│   ├── app/
│   ├── routes/
│   ├── features/
│   │   ├── source-cvs/
│   │   ├── vacancies/
│   │   ├── packages/
│   │   └── preview/
│   └── shared/
├── domain/
│   ├── source-cv/
│   ├── vacancy/
│   ├── package/
│   ├── style/
│   └── common/
├── application/
│   ├── commands/
│   ├── queries/
│   └── ports/
└── tests/
```

## 18. Suggested Stack

- Electron
- React
- TypeScript
- Vite
- pnpm
- SQLite
- Drizzle ORM or Kysely
- Zod
- Vitest
- Playwright

## 19. Implementation Plan

### Phase 1. Foundation

- scaffold Electron + React + TypeScript app
- configure pnpm workspace
- establish main/preload/renderer boundaries
- create SQLite schema
- implement local app-data layout
- reproduce the main `design/app.pen` states

### Phase 2. Source CV library

- import PDF and DOCX
- store originals
- extract text
- normalize into canonical CV JSON
- compute writing-style profile
- build source CV library screens

### Phase 3. Vacancy ingestion

- classify job board by URL
- implement Greenhouse deterministic fetcher
- implement LinkedIn and Indeed browser-backed fetchers
- implement generic fallback fetcher
- persist vacancy snapshots and normalized vacancy models

### Phase 4. Codex generation engine

- implement Codex runtime adapter
- define task JSON schema
- define output JSON schema
- implement generation-run workspace
- add factual and style validation

### Phase 5. Rendering and export

- implement `cv.html`-compatible renderer
- wire preview surface
- export CV to PDF
- attach exported artifact to immutable package

### Phase 6. Cover letters

- add cover-letter generation contract
- add style-similarity validation
- implement dedicated cover-letter HTML renderer
- surface in-app cover-letter PDF preview
- export cover letters as PDF from inside the app

### Phase 7. Hardening

- retry logic
- better failure reporting
- package comparison
- regeneration UX
- authenticated browser session management

## 20. Testing Strategy

### Unit tests

- vacancy normalization
- CV normalization
- style profile generation
- prompt/task assembly
- factual validation
- style validation
- render view-model pagination logic

### Integration tests

- import source CV -> fetch vacancy -> generate package -> render -> export PDF
- generate multiple packages for one source CV
- reopen an existing package and export the exact same PDF again

### End-to-end tests

- first launch import flow
- create package from Greenhouse URL
- create package from LinkedIn or Indeed with browser-assisted fetch
- browse saved packages
- download a specific PDF on demand

### Visual regression tests

- compare rendered preview against `design/cv.html`-aligned snapshots
- check A4 size and two-page export constraints

## 21. Final Recommendation

Build v1 as:

- a macOS Intel Electron desktop app
- React + TypeScript + pnpm
- SQLite + local filesystem
- no required backend
- no required Docker
- Codex-driven generation via a local Codex runtime adapter
- browser-capable live vacancy fetching
- immutable tailored package history
- shared HTML preview/export path based on `design/cv.html`
- one fixed CV template
- style-matched cover-letter generation
- in-app cover-letter PDF preview
- in-app cover-letter PDF export

## 22. References

- Local UI source: `design/app.pen`
- CV visual source: `design/cv.pen`
- CV HTML source: `design/cv.html`
- OpenClaw OpenAI/Codex provider docs: https://docs.openclaw.ai/providers/openai
- OpenAI local shell docs: https://developers.openai.com/api/docs/guides/tools-local-shell/
- OpenAI Codex app docs: https://developers.openai.com/codex/app/
