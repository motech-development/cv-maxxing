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

### 7.6 Codex availability and onboarding

Codex setup should be progressive in v1.

Do not block first launch on Codex auth or CLI verification.

The onboarding sequence should be:

1. import first source CV
2. land in the workspace
3. let the user enter vacancy data
4. run Codex preflight only when the user requests `Create version`

This keeps the product onboarding focused on the user outcome instead of infrastructure setup.

### 7.7 Codex preflight contract

Before a generation run is enqueued, the main process should execute a synchronous-looking preflight step that checks:

- Codex CLI/runtime is installed and launchable
- saved auth state is available when required
- the runtime can answer a lightweight health probe
- the generation request can be resumed automatically after preflight succeeds

Preflight result shape:

```ts
type CodexPreflightStatus =
  | 'ready'
  | 'checking'
  | 'sign_in_required'
  | 'unavailable'

/**
 * `status` is the authoritative preflight outcome.
 * `canResumeGeneration` semantics by status:
 * - `ready` => always `true`; generation may continue immediately.
 * - `checking` => always `false`; generation remains blocked until a terminal preflight result is returned.
 * - `sign_in_required` => always `true` in v1; this status is only returned after the app has persisted a resumable pending generation command that can continue after re-auth or session recovery.
 * - `unavailable` => always `false`; generation is blocked until local Codex setup is repaired and preflight succeeds.
 *
 * Allowed `failureCode` values by status:
 * - `ready` => no `failureCode`
 * - `checking` => no `failureCode`
 * - `sign_in_required` => `auth_missing` | `auth_expired`
 * - `unavailable` => `cli_missing` | `launch_failed` | `healthcheck_failed`
 */
type CodexPreflightReady = {
  status: 'ready'
  canResumeGeneration: true
  message: string
}

type CodexPreflightChecking = {
  status: 'checking'
  canResumeGeneration: false
  message: string
}

type CodexPreflightSignInRequired = {
  status: 'sign_in_required'
  canResumeGeneration: true
  failureCode: 'auth_missing' | 'auth_expired'
  message: string
}

type CodexPreflightUnavailable = {
  status: 'unavailable'
  canResumeGeneration: false
  failureCode: 'cli_missing' | 'launch_failed' | 'healthcheck_failed'
  message: string
}

type CodexPreflightResult =
  | CodexPreflightReady
  | CodexPreflightChecking
  | CodexPreflightSignInRequired
  | CodexPreflightUnavailable
```

Behavior rules:

- if status is `ready`, the generation command continues without extra UX
- if status is `sign_in_required`, the queued generation remains pending until auth completes or the user cancels; in v1 this status is only valid for resumable pending commands, so `CodexPreflightSignInRequired.canResumeGeneration` must always be `true`
- if status is `unavailable`, vacancy input remains intact and the user can retry after local setup is repaired
- preflight should not discard the currently selected source CV, vacancy URL, or pasted description
- the `checking` probe timeout must be a runtime-configurable value, not a compile-time constant
- resolve the effective `checking` timeout in the main process by first reading the runtime environment variable `CHECKING_TIMEOUT_MS` and parsing it as milliseconds, then falling back to the persisted app config/API field `checkingTimeout`, then the default
- default `checkingTimeout` / `CHECKING_TIMEOUT_MS` to `12000` ms so the probe has enough time for a local Codex launch and health check without leaving the user trapped on a long indefinite wait
- the same resolved timeout value must drive the non-cancellable `Codex Setup / Checking` probe flow and the transition to `failureCode: 'healthcheck_failed'`

### 7.8 Codex onboarding IPC surface

Recommended preload-facing API:

```ts
interface CodexOnboardingApi {
  getCodexPreflight(): Promise<CodexPreflightResult>
  startCodexSignIn(): Promise<CodexPreflightResult>
  retryCodexPreflight(): Promise<CodexPreflightResult>
  openCodexSetupGuide(): Promise<void>
}
```

Runtime config shape for the preflight probe:

```ts
interface CodexRuntimeConfig {
  /**
   * Effective timeout for the non-cancellable `checking` probe.
   * Resolve at runtime from `CHECKING_TIMEOUT_MS` parsed as milliseconds,
   * then persisted config/API, then the default 12000 ms window.
   */
  checkingTimeout: number
}
```

Generation-facing API shape:

```ts
interface CreateTailoredPackageCommand {
  sourceCvId: string
  vacancySourceType: 'url' | 'pasted_text' | 'imported_file'
  vacancySourceUrl?: string
  vacancyPastedText?: string
}

type CreateTailoredPackageResponse =
  | { kind: 'started'; tailoredPackageId: string; generationRunId: string }
  | { kind: 'blocked'; preflight: CodexPreflightResult }
```

Critical rule:

- the renderer does not infer Codex state from logs or process output
- the main process owns Codex probing, auth flow orchestration, retry decisions, and resumability
- the renderer only renders the state returned by typed IPC
- `CreateTailoredPackageCommand` should prefix vacancy intake fields with `vacancy*` to distinguish them from the selected source CV; downstream persistence may still normalize these values into the `Vacancy` entity fields `sourceType` and `sourceUrl`

### 7.9 Resume semantics

If the user clicks `Create version` and the run is blocked on Codex setup:

- persist the normalized vacancy draft first
- persist the selected source CV id first
- create a resumable pending command record
- after successful sign in or retry, resume the exact pending generation command instead of forcing the user to re-enter data

If the user cancels from the sign-in-required state:

- keep the vacancy draft in the UI
- do not create a failed package record
- record only a cancelled preflight event if audit history is needed

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
- explain that Codex setup happens later, only when the user creates the first version

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

#### Codex Setup States

These states now exist in `design/app.pen` and should be implemented as first-class renderer routes or screen modes:

- `CV Maxxing / Codex Setup / Checking`
- `CV Maxxing / Codex Setup / Sign In Required`
- `CV Maxxing / Codex Setup / Unavailable`

State intent:

- `Checking`: lightweight preflight state shown immediately after the user asks to create a version and the app is probing the local Codex runtime; v1 should treat this as non-cancellable to avoid abandoning an in-flight probe halfway through, but it must use a runtime-configurable timeout window so the user is not trapped on an indefinite probe. The effective timeout should come from the runtime env var `CHECKING_TIMEOUT_MS`, then the persisted `checkingTimeout` setting, then the default `12000` ms without requiring a rebuild.
- `Sign In Required`: blocking state shown when the runtime exists but a usable sign-in is missing or expired; this state must support both retry after failed sign-in and user cancel back to the workspace with the vacancy draft preserved
- `Unavailable`: blocking state shown when the local Codex runtime cannot be launched or verified; this state must support repeated retry attempts and may remain in place if retry fails again

Transition rules:

- `First Launch` -> `Workspace / Empty` after first source CV import succeeds
- `Workspace / Empty` -> `Codex Setup / Checking` after the first `Create version` click
- `Codex Setup / Checking` -> `Workspace / Loading` when preflight returns `ready`
- `Codex Setup / Checking` -> `Codex Setup / Sign In Required` when preflight returns `sign_in_required`
- `Codex Setup / Checking` -> `Codex Setup / Unavailable` when preflight returns `unavailable`
- `Codex Setup / Checking` -> `Codex Setup / Unavailable` when the configurable preflight timeout elapses; emit `failureCode: 'healthcheck_failed'` and show timeout-aware recovery messaging
- `Codex Setup / Sign In Required` -> `Codex Setup / Checking` after successful sign-in
- `Codex Setup / Sign In Required` -> `Workspace / Empty` when the user cancels; preserve the vacancy draft per section 7.9
- `Codex Setup / Sign In Required` -> `Codex Setup / Sign In Required` when sign-in fails and the dialog remains open with an error message
- `Codex Setup / Unavailable` -> `Codex Setup / Checking` after `Retry check` starts a new preflight attempt
- `Codex Setup / Unavailable` -> `Codex Setup / Unavailable` when `Retry check` fails again and the app stays blocked on local setup
- `Workspace / Loading` -> `Workspace / Active` when generation and rendering succeed

Preflight and retry notes:

- `Codex Setup / Checking` does not support user-initiated cancel in v1; the app should wait for a terminal preflight result and then route accordingly
- `Codex Setup / Checking` should fail closed on timeout instead of spinning forever; default the timeout to the runtime-configurable `12000` ms value and map timeout expiry to `failureCode: 'healthcheck_failed'`
- expose that timeout through both `CHECKING_TIMEOUT_MS` and the persisted config/API field `checkingTimeout` so developers or operators can tune the probe without recompiling; a CLI or UI setting can be added later if user-facing adjustment is desired
- `Retry check` should always route through `Codex Setup / Checking` first, not jump directly to success or failure UI without a fresh probe
- failed sign-in attempts should keep the user in `Codex Setup / Sign In Required` with a specific inline error, not bounce them to `Unavailable`

Copy guidance:

- first launch should frame Codex setup as a later step, not a prerequisite
- sign-in copy should explain that this is a one-time local setup on the current Mac
- unavailable copy should focus on local repair and safe retry, not on vague backend failure wording
- when `Unavailable` is reached from `Checking` because `failureCode: 'healthcheck_failed'`, the user-facing message should say the local Codex health check timed out and should offer a visible `Retry check` action

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
- Codex preflight and resumable onboarding state
- browser-assisted vacancy fetch
- HTML rendering for PDF export
- secure settings storage

### Preload owns

- typed API surface
- input validation at boundary
- typed Codex onboarding and retry commands

### Renderer owns

- React state
- screen composition
- immutable package browsing
- preview presentation
- mapping typed preflight state to the dedicated setup screens in `design/app.pen`

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
- ESLint
- Prettier-compatible formatting via repository tooling
- Vitest
- Playwright

## 19. Repository Bootstrap and Delivery Architecture

### 19.1 Initial repository scaffold

The first implementation tasks must establish a production-shaped baseline rather than a throwaway prototype.

Bootstrap the repo as:

- `pnpm` workspace, even if v1 ships as one desktop app package, so app code, shared packages, and test utilities can evolve without a structural rewrite
- Electron + React + TypeScript + Vite scaffold with separate `main`, `preload`, and `renderer` entry points
- shared TypeScript project references or equivalent build separation so the Electron process boundaries remain explicit
- path aliases only where they reflect architecture boundaries clearly; avoid alias sprawl
- `.env.example` and runtime config loading for non-secret local configuration such as `CHECKING_TIMEOUT_MS`
- deterministic app-data path resolution for dev, test, and packaged modes

### 19.2 Baseline package scripts

The scaffold should expose explicit scripts for:

- local development
- type-checking
- linting
- unit tests
- integration tests
- end-to-end tests
- production build
- packaged desktop build for macOS Intel

Representative script surface:

```text
pnpm dev
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test
pnpm build
pnpm package:mac
```

Exact naming may vary, but the repo must provide a stable equivalent for each concern.

### 19.3 Quality gate architecture

The repo should fail fast on quality regressions.

Minimum enforced gates:

- TypeScript type-check passes
- ESLint passes
- unit and integration test suites pass
- Playwright end-to-end smoke coverage passes on CI for at least the core happy path

Quality rules:

- `pnpm test` should aggregate at least unit and integration coverage
- e2e may remain a separate CI job, but it must be runnable locally through a single documented command
- generated artifacts and temporary app-data for tests must write to isolated test-specific directories
- tests must not depend on a globally installed Codex runtime unless the specific suite is marked as an opt-in environment test

### 19.4 Test environment strategy

Split test responsibility deliberately:

- unit tests for domain logic, normalization, validators, and render view-model logic
- integration tests for SQLite adapters, filesystem-backed services, IPC handlers, and render/export orchestration
- end-to-end tests for Electron user journeys and screen-state transitions
- optional environment tests for Codex CLI availability and live-site fetch compatibility, excluded from required CI unless explicitly enabled later

Test harness requirements:

- injectable app-data root
- injectable database path
- fake or fixture-backed Codex runtime adapter for deterministic non-environment tests
- fixture-backed vacancy snapshots and source CV inputs
- PDF export assertions that validate artifact existence and selected metadata, not byte-for-byte equality unless the renderer is fully stabilized

### 19.5 CI architecture

CI should be introduced as part of foundation work, not deferred until late hardening.

Recommended required workflow shape:

```text
Pull Request CI
├── Install dependencies with pnpm
├── Lint
├── Type-check
├── Unit + integration tests
├── Build verification
└── Required Electron/Playwright smoke job for the core happy path
```

CI rules:

- every pull request must run lint, type-check, tests, and build verification
- required CI should use a pinned Node version compatible with the repo toolchain
- CI should cache `pnpm` dependencies
- CI should publish failure logs and Playwright artifacts when relevant
- packaging/distribution automation is not required in v1 baseline, but build verification must prove the desktop app compiles successfully

### 19.6 Packaging architecture

The architecture should anticipate distributable macOS Intel builds early.

Baseline packaging requirements:

- signed notarization is not required for the first local-development milestone unless distribution work explicitly starts
- the build system must still produce a runnable packaged app artifact for macOS Intel
- preload hardening and asset path resolution must work in both dev and packaged modes

## 20. Implementation Plan

### Phase 0. Repo foundation and delivery platform

- scaffold `pnpm` workspace and Electron + React + TypeScript app shell
- configure linting, formatting, and type-checking
- configure Vitest and Playwright harnesses
- establish CI workflow for lint, type-check, tests, and build verification
- establish packaged-build path for macOS Intel

### Phase 1. Foundation

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
- implement Codex preflight and resumable setup flow
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

## 21. Testing Strategy

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
- IPC command/query coverage for package browsing, Codex preflight, and resumable pending commands
- SQLite and filesystem adapter tests against isolated temporary app-data roots

### End-to-end tests

- first launch import flow
- first `Create version` flow when Codex is already ready
- first `Create version` flow when sign-in is required
- retry from Codex unavailable state after local repair
- create package from Greenhouse URL
- create package from LinkedIn or Indeed with browser-assisted fetch
- browse saved packages
- download a specific PDF on demand

### Visual regression tests

- compare rendered preview against `design/cv.html`-aligned snapshots
- check A4 size and two-page export constraints
- verify major `design/app.pen` screen states remain visually aligned during UI iteration

## 22. CI and Release Baseline

### Required CI checks for v1 development

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- build verification command
- Playwright Electron smoke coverage for the core happy path

### Recommended optional CI checks

- packaging verification for macOS Intel on protected branches

### Release baseline

- local developer builds must be reproducible from a clean clone
- packaged builds must resolve preload, renderer assets, and app-data paths correctly
- release automation may remain manual in v1 as long as the packaging process is documented and repeatable

## 23. Final Recommendation

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

## 24. References

- Local UI source: `design/app.pen`
- CV visual source: `design/cv.pen`
- CV HTML source: `design/cv.html`
- OpenClaw OpenAI/Codex provider docs: https://docs.openclaw.ai/providers/openai
- OpenAI local shell docs: https://developers.openai.com/api/docs/guides/tools-local-shell/
- OpenAI Codex app docs: https://developers.openai.com/codex/app/
