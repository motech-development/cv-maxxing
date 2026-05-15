# CV Maxxing Architecture

Status: Decisioned v1 architecture based on confirmed requirements as of April 8, 2026.

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
  - original CVs empty
  - original CVs active
- `design/cv.pen` and `design/cv.html` define the A4 CV visual system, with dynamic multi-page pagination and Manrope typography.
- The active workspace design already implies these product areas:
  - active original CV management
  - vacancy intake
  - saved tailored applications list
  - preview surface
  - export actions
  - side rail with role details and adaptation summary

## 2. Confirmed Product Decisions

These are now fixed inputs to the architecture.

- The app may call the internet only where product behavior requires it: the local AI worker runtime and user-initiated vacancy page access.
- The app must use a provider-neutral local AI worker abstraction for generation workflows.
- v1 must ship with a bring-your-own Codex CLI adapter as the only AI worker adapter, in a pattern similar to OpenClaw’s Codex-backed workflows.
- The app must fetch vacancy data from live job URLs and support pasted job descriptions as the fallback.
- v1 must not support saved page/file vacancy imports.
- v1 target platforms are macOS Intel and Apple Silicon.
- CV adaptation may strengthen phrasing if it remains truthful.
- Adapted CVs and cover letters are immutable once generated.
- The app should also generate cover letters.
- Cover-letter writing style must match the original CV and must not read as obvious AI output.
- Cover letters must be exportable as PDF from inside the app, previewable in-app as generated PDFs, and copyable as plain text from the UI.
- Exported files are PDF-only. The app must never export DOCX or other editable document formats.
- Only one CV visual template family is required, but it must support dynamic single-page and multi-page output.
- v1 has one active original CV in the UI. Replacing it creates a new original CV snapshot; existing tailored applications keep references to the snapshot used at generation time.
- v1 output language is British English only. Non-English original CVs or vacancies should be blocked when detected.
- v1 has no telemetry, analytics, crash reporting, remote config, background update checks, or runtime font CDN calls.

## 3. External Constraints That Shape the Design

### 3.1 A local AI worker is mandatory

This architecture treats the AI worker as a mandatory local generation dependency, not an optional provider.

The app-facing boundary should be provider-neutral. v1 implements only a Codex CLI adapter, but the domain and application layers must not be hard-wired to Codex-specific names or transport assumptions.

### 3.2 Live URL ingestion is mandatory

This rules out paste-only intake. The system must support real fetch and parse flows for:

- LinkedIn
- Indeed
- Greenhouse
- generic fallback pages

Authenticated LinkedIn and Indeed pages must use an app-managed browser session. v1 only promises extraction when the user can visibly open the job page in that internal browser; pasted job text remains the fallback when extraction is blocked or incomplete.

### 3.3 Output immutability is mandatory

The app should not expose a freeform editor for generated CVs or cover letters. The user can:

- generate
- preview
- export
- copy cover-letter text
- delete
- create a new tailored application again from the same input if needed

The user cannot directly edit the generated document body in v1.

There should be no explicit `Regenerate` action and no tailored-application comparison feature.

### 3.4 Dynamic single template family is mandatory

The rendering layer should optimize around one visual template family:

- `design/cv.pen` is the authoritative visual reference
- `design/cv.html` is the implementation reference

No multi-template abstraction is needed in v1 beyond internal clean separation. The renderer must support dynamic pagination:

- page 1 uses the full document header
- page 2 and later use the compressed continued header from `design/cv.html`
- a section continued on a new page renders the previous section heading with `(CONTINUED)`
- content is not silently dropped to force a fixed page count
- output longer than 3 CV pages should show a non-blocking warning

### 3.5 Security and privacy are product constraints

The app handles sensitive employment and personal data.

Sensitive local data must be encrypted at rest from the start:

- original CV files
- extracted CV text
- normalized CV JSON
- writing style profiles
- vacancy snapshots, text, and normalized JSON
- adapted CV JSON/render models
- cover-letter JSON/render models/plain text
- generated PDFs
- failure logs containing sensitive content

Store encryption keys in the OS keychain. Prefer SQLCipher for SQLite so metadata does not become a plaintext leakage path.

If the encryption key cannot be unlocked, the app must fail closed and offer retry/help/reset, not weak recovery.

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
│   ├── Original CV service
│   ├── Vacancy ingestion service
│   ├── AI worker orchestration service
│   ├── Tailored application service
│   ├── HTML/PDF rendering service
│   ├── encrypted SQLite persistence
│   └── encrypted local file storage
├── Preload
│   └── Typed renderer-safe API
└── Renderer
    ├── React + TypeScript UI
    ├── design/app.pen-aligned screens
    ├── preview surface
    └── immutable tailored application browsing
```

## 6. Primary Technical Decisions

| Area                | Decision                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| App shell           | Electron + React + TypeScript                                                                                    |
| Package manager     | `pnpm`                                                                                                           |
| Persistence         | SQLCipher-backed SQLite + encrypted local filesystem artifacts                                                   |
| AI runtime          | Provider-neutral local AI worker port; v1 ships Codex CLI adapter only                                           |
| Vacancy fetch       | app-owned fetch/browser capture plus AI-backed URL and pasted-description normalization                          |
| CV rendering        | dynamic shared HTML renderer derived from `design/cv.html`                                                       |
| PDF export          | Chromium `printToPDF()` from hidden render surface                                                               |
| PDF preview         | preview the actual generated PDF artifact in-app                                                                 |
| Cover letters       | generated alongside each adapted CV, style-matched, immutable, previewed/exported as PDF, copyable as plain text |
| Backend             | none required for v1                                                                                             |
| Docker              | not required for v1                                                                                              |
| UI styling          | Tailwind for app UI with CSS-variable tokens; no MUI                                                             |
| Renderer data state | TanStack Query for IPC-backed async state; no Redux                                                              |
| Database mapper     | Drizzle ORM with SQLCipher-compatible SQLite driver                                                              |

## 7. AI Worker Runtime Architecture

### 7.1 Why an AI worker port is needed

The app needs a local AI worker, but the rest of the app must not depend directly on Codex, Claude Code, Gemini, an API transport, or any provider-specific auth model.

Use a provider-neutral application port:

```text
GenerationWorkerPort
└── CodexCliWorkerAdapter
```

v1 ships only `CodexCliWorkerAdapter`. Provider selection may exist as internal config, for example `aiWorkerProvider: 'codex'`, but it should not be exposed in the v1 UI.

### 7.2 Recommended v1 approach

Recommendation: integrate with a bring-your-own local Codex CLI adapter from the Electron main process.

The Electron app should:

- prepare a structured task workspace for each generation run
- decrypt only the required original CV and vacancy artifacts into a restricted transient run workspace
- invoke the configured worker in a controlled subprocess from that workspace
- request structured JSON output only
- validate the result against the JSON contract
- import accepted outputs into encrypted app storage
- delete plaintext run workspace contents on success, failure, or cancellation

Why this is the strongest v1 architecture:

- it keeps Codex as the real v1 worker without hard-wiring the domain to Codex forever
- it supports future `ClaudeCodeCliWorkerAdapter`, `GeminiCliWorkerAdapter`, or API-backed adapters
- it avoids giving the worker broad access to encrypted app storage
- it keeps generation auditable without storing raw prompts or plaintext logs long-term

### 7.3 Runtime contract

Each generation job should provide the worker with:

- normalized original CV JSON
- extracted original CV text
- writing style profile
- normalized vacancy JSON
- fetched vacancy text and metadata
- rendering contract
- British English output rules
- cover-letter date-format rules
- output JSON schema

The worker should not browse the internet or fetch extra context in v1. The app fetches and snapshots the vacancy first, then passes bounded input artifacts to the worker.

Each generation job should expect back:

- adapted CV structured model
- cover-letter structured model
- cover-letter plain text derived by the app from the same canonical cover-letter model
- change summary
- gap notes and validation hints
- provider trace metadata safe to redact or discard

The worker must not return final PDFs and must not decide page breaks.

### 7.4 Transient worker workspace layout

Use a per-run transient workspace such as:

```text
app-data/runs/{runId}/
├── input/
│   ├── original-cv.json
│   ├── original-cv.txt
│   ├── writing-style-profile.json
│   ├── vacancy.json
│   ├── vacancy.txt
│   └── task.json
├── output/
│   ├── adapted-cv.json
│   ├── cover-letter.json
│   ├── summary.json
│   └── run.log
└── temp/
```

These plaintext files exist only while the run is active. After validation, the app imports accepted artifacts into encrypted storage and deletes plaintext workspace contents. On failure or cancellation, delete plaintext contents and retain only redacted structured failure metadata.

### 7.5 Why not drive everything through ad hoc prompting

The app should not send only giant prompt strings and trust freeform prose.

The worker must be treated as a structured worker with:

- deterministic input artifacts
- structured output artifacts
- schema validation
- bounded retry logic
- cancellation
- redacted failure capture

Schema validity is the required acceptance gate for generation output in v1. Truthfulness, spelling, and date-format expectations should be enforced through the prompt contract and final user review rather than post-generation text-comparison validators.

### 7.6 AI worker availability and onboarding

AI worker setup should be a required startup readiness gate in v1.

The app should not let the user enter the workspace, import the first CV, or create vacancy drafts until the configured local AI worker has passed setup preflight. The only actions available before readiness should be setup, provider-specific sign-in/setup, setup guide access, retry, and app exit.

The onboarding sequence should be:

1. launch the app into `AI Worker Setup / Checking`
2. verify that the configured provider runtime is installed, launchable, authenticated when required, and healthy
3. route to `AI Worker Setup / Sign In Required` or `AI Worker Setup / Unavailable` if setup is blocked
4. route to `First Launch` only after preflight returns `ready`
5. import the first original CV
6. land in the workspace
7. let the user enter vacancy data and adapt their CV without discovering worker setup late

The v1 UI should use neutral language such as `AI worker setup` in normal product flow. It may say `Codex` only in the provider-specific setup screen, setup guide, and diagnostics for the v1 adapter.

### 7.7 AI worker preflight contract

At startup, and again before a generation run if readiness is stale or a pending command is being resumed, the main process should execute a synchronous-looking preflight step that checks:

- configured worker provider
- runtime is installed and launchable
- saved auth state is available when required
- the runtime can answer a lightweight health probe
- any pending generation request can be resumed automatically after preflight succeeds

Preflight result shape:

```ts
type AiWorkerProvider = 'codex'

type AiWorkerPreflightStatus = 'ready' | 'checking' | 'sign_in_required' | 'unavailable'

type AiWorkerFailureCode =
  | 'auth_missing'
  | 'auth_expired'
  | 'runtime_missing'
  | 'launch_failed'
  | 'healthcheck_failed'

type AiWorkerPreflightReady = {
  status: 'ready'
  provider: AiWorkerProvider
  canResumeGeneration: true
  message: string
}

type AiWorkerPreflightChecking = {
  status: 'checking'
  provider: AiWorkerProvider
  canResumeGeneration: false
  message: string
}

type AiWorkerPreflightSignInRequired = {
  status: 'sign_in_required'
  provider: AiWorkerProvider
  canResumeGeneration: boolean
  failureCode: 'auth_missing' | 'auth_expired'
  message: string
}

type AiWorkerPreflightUnavailable = {
  status: 'unavailable'
  provider: AiWorkerProvider
  canResumeGeneration: false
  failureCode: 'runtime_missing' | 'launch_failed' | 'healthcheck_failed'
  message: string
}

type AiWorkerPreflightResult =
  | AiWorkerPreflightReady
  | AiWorkerPreflightChecking
  | AiWorkerPreflightSignInRequired
  | AiWorkerPreflightUnavailable
```

Behavior rules:

- if status is `ready` during startup setup, route to `First Launch` or the last valid workspace state
- if status is `ready` during a generation retry, the generation command continues without extra UX
- if status is `sign_in_required` during startup setup, keep the user in setup and set `canResumeGeneration` to `false`
- if status is `sign_in_required` during a generation retry, the queued generation remains pending until auth completes or the user cancels; in this case `canResumeGeneration` must be `true`
- if status is `unavailable` during startup setup, keep the user in setup until local setup is repaired
- if status is `unavailable` during a generation retry, vacancy input remains intact and the user can retry after local setup is repaired
- preflight should not discard the currently selected original CV, vacancy URL, or pasted description when a generation command already exists
- the `checking` probe timeout must be a runtime-configurable value, not a compile-time constant
- resolve the effective `checking` timeout in the main process by first reading the runtime environment variable `CHECKING_TIMEOUT_MS`, then persisted app config/API field `checkingTimeout`, then the default
- default `checkingTimeout` / `CHECKING_TIMEOUT_MS` to `12000` ms
- the same resolved timeout value must drive the non-cancellable checking probe flow and the transition to `failureCode: 'healthcheck_failed'`

### 7.8 AI worker IPC surface

Recommended preload-facing API:

```ts
interface AiWorkerOnboardingApi {
  getAiWorkerPreflight(): Promise<AiWorkerPreflightResult>
  startAiWorkerSignIn(): Promise<AiWorkerPreflightResult>
  retryAiWorkerPreflight(): Promise<AiWorkerPreflightResult>
  openAiWorkerSetupGuide(): Promise<void>
}
```

Runtime config shape for the preflight probe:

```ts
interface AiWorkerRuntimeConfig {
  provider: AiWorkerProvider
  checkingTimeout: number
}
```

Generation-facing API shape:

```ts
interface CreateTailoredApplicationCommand {
  originalCvId: string
  vacancyInputType: 'url' | 'pasted_text'
  vacancyUrl?: string
  vacancyPastedText?: string
}

type CreateTailoredApplicationResponse =
  | { kind: 'started'; tailoredApplicationId: string; generationRunId: string }
  | { kind: 'blocked'; preflight: AiWorkerPreflightResult }
```

Critical rule:

- the renderer does not infer worker state from logs or process output
- the main process owns provider probing, auth flow orchestration, retry decisions, and resumability
- the renderer only renders the state returned by typed IPC
- `CreateTailoredApplicationCommand` should prefix vacancy intake fields with `vacancy*` to distinguish them from the selected original CV; downstream persistence may still normalize these values into the `Vacancy` entity fields `inputType` and `url`

### 7.9 Resume, cancellation, and interruption semantics

If the user clicks `Adapt CV` and the run is blocked on worker setup:

- persist the normalized vacancy draft first
- persist the selected original CV id first
- create a resumable pending command record
- after successful sign in or retry, resume the exact pending generation command instead of forcing the user to re-enter data

If the user cancels from the sign-in-required state:

- keep the vacancy draft in the UI
- do not create a failed tailored application record
- record only a cancelled preflight event if diagnostics mode is enabled

Generation jobs should run one at a time in v1. Cancelling an active generation should terminate the worker subprocess, mark the run as cancelled, delete partial tailored-application artifacts, keep the original CV and vacancy draft/snapshot, and return the user to the workspace.

If the app crashes or quits during generation, do not auto-resume generation on next launch. Mark the interrupted run as failed or cancelled with reason `interrupted`, delete partial output artifacts, and preserve the original CV plus any completed vacancy snapshot or draft.

If generation succeeds but the app exits before deterministic PDF rendering finishes, rerun rendering automatically on next launch before showing the tailored application as ready.

## 8. Vacancy Ingestion Architecture

### 8.1 Intake modes

The app should support:

1. live URL fetch
2. pasted text

Live URL fetch is the primary path. Pasted text is the resilience path and may include an optional URL for reference. Do not support saved page, HTML, TXT, PDF, or DOCX vacancy imports in v1.

### 8.2 Fetch pipeline

Use a layered ingestion strategy:

```text
1. URL classification
2. Deterministic fetch adapter
3. Browser-assisted fetch when needed
4. Text extraction and cleanup
5. AI-worker-assisted structuring for URL captures and pasted descriptions
6. Persist snapshot and structured vacancy model
```

### 8.3 Vacancy fetch adapters

```text
VacancyFetcherPort
├── GreenhouseFetcher
├── LinkedInFetcher
├── IndeedFetcher
└── GenericFetcher
```

### 8.4 Fetch strategy by vacancy site

#### Greenhouse

Use deterministic HTTP fetch and DOM parsing first.

#### LinkedIn and Indeed

Use a browser-backed fetch path when static retrieval is incomplete or blocked.

Recommended implementation:

- app-managed browser session controlled by the main process
- visible browser window when authentication or user interaction is needed
- hidden/automated browser context only after the user has an authenticated app-managed session and the URL can be fetched reliably
- persistent local profile support for authenticated sessions
- page snapshot persisted after successful extraction
- current domain shown clearly; do not hard-block cross-domain auth redirects in v1
- extraction allowed only when the final page is classified as a supported or generic vacancy source

External browser fallback may open the URL in Safari/Chrome for the user to view or copy manually, but extraction must never depend on reading external browser cookies or sessions.

#### Generic fallback

Use:

- standard HTTP fetch
- readability / article extraction
- DOM text extraction
- AI-worker-assisted field normalization for every successful URL review
- AI-worker-assisted field normalization for pasted job descriptions

### 8.5 Failure and cancellation behavior

If URL review fails because fetch, browser capture, AI normalization, or semantic validation cannot produce a trustworthy vacancy, do not proceed to generation. Keep the entered URL in the intake draft, do not persist reviewed vacancy artifacts, throw through the existing review-failure path, and offer internal browser sign-in for LinkedIn/Indeed or pasted job text fallback.

Browser-navigation failures such as never reaching the requested LinkedIn/Indeed vacancy URL or closing off-target remain incomplete-review states instead of thrown errors. The browser session only decides whether the requested vacancy page was actually observed; AI normalization owns field extraction.

Generation requires a minimum useful vacancy model: substantive responsibilities or requirements text, plus title/employer/location when available.

The user should review a compact normalized vacancy preview before `Adapt CV` is enabled. Do not allow editing normalized vacancy fields in v1; if extraction is wrong, the fallback is pasted job text.

URL normalization persists only semantically validated vacancy output. The app trims whitespace, removes trivial empties, deduplicates exact duplicate bullets, rejects obvious cookie/sign-in/feed junk, and derives language checks from the canonical normalized `bodyText`.

Browser vacancy fetch jobs should run one at a time in v1. Cancelling an active fetch should stop the page/fetch job, keep the URL in the intake field, discard incomplete vacancy artifacts, and return to the vacancy intake state.

### 8.6 Persisted vacancy artifacts

Always persist:

- original URL
- final resolved URL
- job board classification
- fetch timestamp
- page title when available
- raw HTML or sanitized browser DOM snapshot
- extracted text derived from the canonical normalized vacancy `bodyText`
- normalized vacancy JSON

Do not persist cookies, localStorage, session tokens, or screenshots in vacancy records. Keep the authenticated browser profile separately under app-managed storage.

This matters because job listings disappear, mutate, and sometimes return different HTML on later requests.

## 9. Original CV Import Architecture

### 9.1 Supported formats

v1 original CV inputs:

- PDF
- DOCX

Scanned/image-only PDFs are not supported in v1. Detect likely image-only or garbled extraction and ask the user for a text-based PDF or DOCX.

### 9.2 Import pipeline

```text
1. Extract deterministic PDF or DOCX text and page metadata
2. Reject unreadable or garbled extraction before AI normalization
3. Submit extracted text plus import metadata to the provider-neutral original-CV normalization service
4. Receive the canonical CV JSON including explicit contact fields plus writing-style profile from the configured AI worker
5. Deterministically validate normalization output into approved failure modes
6. Persist the source file, extracted text, normalized CV JSON, writing-style profile JSON, and active snapshot metadata
```

Future imports use the AI-backed normalization path exclusively. The app does not keep a deterministic heading parser or deterministic writing-style heuristic as a fallback import path.

Require successful text extraction with enough usable content to justify AI normalization. Do not rely on the AI worker to reconstruct a broken or image-only CV.

Deterministic validation maps failures into three internal import codes:

- `unreadable_extraction`
- `invalid_normalization`
- `weak_normalization`

The visible UI treatment stays the same, but the user-facing copy distinguishes unreadable extraction from normalization that could not organise the CV reliably.

DOCX import should extract and normalize content only. The app renderer owns output layout and formatting.

### 9.3 Canonical CV model

Use the stored normalized original-CV JSON as the authoritative import output consumed by later tailored-application generation.

The shipped v1 import model is consumed directly by later tailored-application generation:

- `fullName`
- `headline`
- `summary`
- `experience`
- `skills`
- `contact`
  - `location`
  - `phone`
  - `email`
  - `professionalLink`

Missing-value conventions remain unchanged:

- blank strings for missing scalar fields
- empty arrays for missing list fields

Existing imported snapshots are not migrated. Old and new snapshots remain generation-compatible as long as the expected stored artifacts are present. Missing artifacts remain `incomplete or unavailable`; the app does not repair them automatically.

Imported original CVs should be English. v1 output is always British English. Contact details should remain exactly as imported except for `location`, which should be normalised to `location, country` when the CV clearly provides a location. If the source CV provides a location but omits the country, the country may be inferred from grounded geographic evidence in the CV; otherwise `location` should remain blank. Prose and confident date rendering should follow British English conventions.

The app must not heuristically reconstruct CV header contact details during tailored-application generation. Those values must come from the stored AI-normalized original-CV model and be deterministically validated against the extracted source text before persistence.

### 9.4 Style fingerprint

Because cover letters must match the original CV style, every imported CV also stores a `WritingStyleProfile` alongside the normalized original-CV JSON.

The shipped v1 profile shape is:

- `averageSentenceLength`
- `clicheDetections`
- `firstPersonUsage`
- `formality`

The AI worker now produces this profile during original-CV normalization. Tailored-application generation consumes the stored profile unchanged.

## 10. Canonical Domain Model

### `OriginalCv`

- id
- originalFilename
- originalFilePath
- originalFileType
- importedAt
- checksum
- pageCount
- extractedTextPath
- normalizedCvPath
- writingStyleProfilePath
- parserVersion
- isDefault

### `Vacancy`

- id
- inputType: `url | pasted_text`
- url
- jobBoard: `linkedin | indeed | greenhouse | generic | unknown`
- rawHtmlPath
- rawTextPath
- normalizedVacancyPath
- title
- employer
- location
- fetchedAt

### `TailoredApplication`

- id
- originalCvId
- vacancyId
- status: `queued | fetching | generating | rendering | ready | failed | cancelled`
- createdAt
- updatedAt
- adaptationStrategyVersion
- coverLetterStrategyVersion
- renderTemplateVersion
- changeSummaryPath
- adaptedCvPath
- coverLetterPath
- coverLetterPlainTextPath
- cvPdfPath
- coverLetterPdfPath

### `GenerationRun`

- id
- tailoredApplicationId
- runWorkspacePath
- workerProvider
- workerAdapterVersion
- taskSchemaVersion
- outputSchemaVersion
- startedAt
- finishedAt
- status
- logPath
- failureReason

## 11. Persistence Strategy

Use:

- SQLCipher-backed SQLite for metadata
- encrypted local filesystem artifacts for large and sensitive content

Artifact encryption should live at the storage adapter layer. Services read/write logical artifacts; the storage adapter encrypts/decrypts bytes using a key from Keychain. Use opaque ID-based internal paths and filenames so employer names, roles, and CV filenames do not leak through the filesystem.

Suggested local storage shape:

```text
app-data/
├── app.db
├── original-cvs/
│   └── {originalCvId}/
│       ├── original.pdf
│       ├── extracted.txt
│       ├── normalized.json
│       └── style-profile.json
├── vacancies/
│   └── {vacancyId}/
│       ├── snapshot.html
│       ├── extracted.txt
│       └── normalized.json
├── tailored-applications/
│   └── {tailoredApplicationId}/
│       ├── adapted-cv.json
│       ├── cover-letter.json
│       ├── cover-letter.txt
│       ├── cv.pdf
│       └── cover-letter.pdf
└── runs/
    └── {runId}/
        ├── input/        # transient plaintext only while active
        ├── output/       # transient plaintext only while active
        └── run.log       # transient or redacted on failure
```

Do not persist rendered HTML long-term unless diagnostics mode requires it. HTML can be recreated deterministically from the render model and template version; delete it after successful PDF creation.

Hard deletion rules:

- deleting a tailored application deletes its generated CV, cover letter, PDFs, vacancy snapshot if unreferenced, and generation run artifacts from app-managed storage
- exported PDFs outside app storage are never tracked or deleted by the app
- deleting original CV snapshots is not exposed as a v1 library action; old snapshots remain while referenced by tailored applications and may be garbage-collected later when unreferenced
- deletion means deleted from CV Maxxing local storage, not forensic secure erase on SSDs

## 12. CV Adaptation Pipeline

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
- unsupported salary, availability, visa, or location claims

When the vacancy asks for skills not evidenced in the original CV, the adapted CV and cover letter may reframe adjacent evidence and emphasize transferable experience, but they must not add missing tools, certifications, industries, metrics, responsibilities, or years of experience.

Do not ask fact-collection questions in v1. If a match is weak, generate from original CV evidence only and surface the gap in the adaptation summary.

### 12.2 Pipeline stages

```text
1. Normalize original CV and writing-style profile through the original-CV import worker contract
3. Fetch and normalize vacancy
4. Extract vacancy priority signals
5. Map original CV evidence to vacancy priorities
6. Generate adapted CV JSON
7. Generate cover-letter JSON
8. Validate JSON contract
9. Render CV HTML
10. Render cover-letter HTML
11. Export CV PDF
12. Export cover-letter PDF
13. Persist immutable tailored application
```

### 12.3 Style-preserving cover-letter generation

The cover-letter generator should be guided by prompt instructions rather than app-side prose validation.

Cover-letter rules:

- generate a cover letter for every tailored application
- use British English
- use first person naturally but avoid generic enthusiasm
- include contact details from the original CV header
- include the generation date in British format and persist it immutably
- use `Dear Hiring Manager,` only when no named recipient is available
- sign off with the user's name only
- do not invent hiring manager names, company addresses, salary, availability, or visa statements
- produce both a structured render model and plain text from the same canonical cover-letter content

### 12.4 Immutable output model

Since the user does not want manual edits:

- every tailored application is immutable
- there is no explicit `Regenerate` action in v1
- if the user dislikes an output, they delete it and create a new tailored application
- no in-place edits are allowed
- generated cover-letter plain text is copyable but not editable in the app
- exports always map to a specific immutable tailored application id
- multiple tailored applications may exist for the same original CV and vacancy
- failed tailored applications are not retained in the saved list in v1; delete partial sensitive artifacts and keep only redacted diagnostics if diagnostics mode is enabled

### 12.5 Adaptation summary

After generation, show a compact in-app adaptation summary:

- what was emphasized
- what was omitted or compressed
- vacancy requirements not evidenced in the original CV

Do not show confidence scores. Do not export the adaptation summary or include it in final PDFs.

## 13. Rendering and PDF Export

### 13.1 CV rendering reference

Use:

- `design/cv.pen` for visual validation
- `design/cv.html` for the implementation skeleton

### 13.1.1 Cover-letter rendering reference

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
Adapted CV JSON
-> render view model
-> HTML string matching cv.html structure
-> hidden BrowserWindow
-> printToPDF()
-> preview final PDF artifact in renderer
```

This keeps preview and exported PDF aligned.

For cover letters, use the same rule:

- generate structured cover-letter data
- render to HTML
- produce PDF through the shared Chromium pipeline
- preview the generated PDF in-app before export
- expose plain text for copy/paste from the same canonical cover-letter content

Production PDF rendering must not depend on Google Fonts or any font CDN. Bundle Manrope locally.

Exported filenames are intentionally user-visible and should use sanitized metadata, for example:

- `Employer - Role - CV.pdf`
- `Employer - Role - Cover Letter.pdf`

The app may remember the last export directory in encrypted settings. It must not silently overwrite existing user files.

### 13.3 Page handling

The renderer must own pagination.

The AI worker should not decide page breaks directly.

The AI worker produces structured content. The renderer decides:

- what lands on page 1
- how content flows across page 2 and later
- how sections split across pages
- when a continued section heading should render as `{SECTION NAME} (CONTINUED)`
- when output should show a non-blocking long-document warning
- when layout validation fails because content is clipped, overlapping, or otherwise not renderable

There is no fixed two-page limit. The CV and cover letter both support dynamic pagination. If a CV exceeds 3 pages or a cover letter exceeds 1 page, show a non-blocking “longer than usual” warning and still allow export.

### 13.4 Preview controls

The preview should show the actual generated PDF artifact, not an HTML approximation.

Minimum controls:

- document switcher for adapted CV and cover letter
- page navigation
- zoom in/out/reset
- export
- copy cover-letter text when the cover letter is selected

Do not add annotation, search, direct print, or editing tools in v1.

## 14. UI Architecture

Map the renderer directly to `design/app.pen`.

### Screens and states

#### First Launch

- import first original CV
- explain supported formats
- explain next steps
- reachable only after startup AI worker preflight returns `ready`
- explain that the local AI worker is already connected on this Mac

#### Original CV

- current active original CV
- imported filename and import date
- replace original CV

The UI should not expose full original CV library management in v1. Existing tailored applications still reference the original CV snapshot used at generation time.

#### Workspace Active

- left sidebar: saved tailored applications
- main control strip: job intake and generation summary
- preview stage: current CV preview
- right rail: vacancy details and export actions
- cover-letter PDF preview and copyable cover-letter plain text

#### Loading / Processing

- show tailored application state transitions from the main process job engine

#### AI Worker Setup States

These states now exist in `design/app.pen` and should be implemented as first-class renderer routes or screen modes:

- `CV Maxxing / AI Worker Setup / Checking`
- `CV Maxxing / AI Worker Setup / Sign In Required`
- `CV Maxxing / AI Worker Setup / Unavailable`

State intent:

- `Checking`: lightweight preflight state shown at startup before first launch and again before any blocked generation retry when the app is probing the configured local AI worker; v1 should treat this as non-cancellable to avoid abandoning an in-flight probe halfway through, but it must use a runtime-configurable timeout window so the user is not trapped on an indefinite probe. The effective timeout should come from the runtime env var `CHECKING_TIMEOUT_MS`, then the persisted `checkingTimeout` setting, then the default `12000` ms without requiring a rebuild.
- `Sign In Required`: blocking state shown when the runtime exists but a usable sign-in is missing or expired; this state must support retry after failed sign-in, startup exit/setup-guide paths when no workspace is available yet, and cancel back to the workspace with the vacancy draft preserved during generation retry flows
- `Unavailable`: blocking state shown when the local AI worker runtime cannot be launched or verified; this state must support repeated retry attempts and may remain in place if retry fails again

Transition rules:

- `App Startup` -> `AI Worker Setup / Checking` on every launch until worker readiness is verified for the current session
- `AI Worker Setup / Checking` -> `First Launch` when startup preflight returns `ready` and no original CV exists yet
- `AI Worker Setup / Checking` -> `Workspace / Empty` when startup preflight returns `ready` and an active original CV exists but no tailored application is selected
- `AI Worker Setup / Checking` -> `Workspace / Active` when startup preflight returns `ready` and the last selected tailored application/workspace state can be restored
- `First Launch` -> `Workspace / Empty` after first original CV import succeeds
- `Workspace / Empty` -> `AI Worker Setup / Checking` after `Adapt CV` only if worker readiness was lost, auth expired, or the runtime requires a fresh check
- `AI Worker Setup / Checking` -> `Workspace / Loading` when generation retry preflight returns `ready`
- `AI Worker Setup / Checking` -> `AI Worker Setup / Sign In Required` when preflight returns `sign_in_required`
- `AI Worker Setup / Checking` -> `AI Worker Setup / Unavailable` when preflight returns `unavailable`
- `AI Worker Setup / Checking` -> `AI Worker Setup / Unavailable` when the configurable preflight timeout elapses; emit `failureCode: 'healthcheck_failed'` and show timeout-aware recovery messaging
- `AI Worker Setup / Sign In Required` -> `AI Worker Setup / Checking` after successful sign-in
- `AI Worker Setup / Sign In Required` -> app exit or setup guide when reached during startup setup and the user declines sign-in
- `AI Worker Setup / Sign In Required` -> `Workspace / Empty` when the user cancels during a generation retry; preserve the vacancy draft per section 7.9
- `AI Worker Setup / Sign In Required` -> `AI Worker Setup / Sign In Required` when sign-in fails and the dialog remains open with an error message
- `AI Worker Setup / Unavailable` -> `AI Worker Setup / Checking` after `Retry check` starts a new preflight attempt
- `AI Worker Setup / Unavailable` -> `AI Worker Setup / Unavailable` when `Retry check` fails again and the app stays blocked on local setup
- `Workspace / Loading` -> `Workspace / Active` when generation and rendering succeed

Preflight and retry notes:

- `AI Worker Setup / Checking` does not support user-initiated cancel in v1; the app should wait for a terminal preflight result and then route accordingly
- `AI Worker Setup / Checking` should fail closed on timeout instead of spinning forever; default the timeout to the runtime-configurable `12000` ms value and map timeout expiry to `failureCode: 'healthcheck_failed'`
- expose that timeout through both `CHECKING_TIMEOUT_MS` and the persisted config/API field `checkingTimeout` so developers or operators can tune the probe without recompiling; a CLI or UI setting can be added later if user-facing adjustment is desired
- `Retry check` should always route through `AI Worker Setup / Checking` first, not jump directly to success or failure UI without a fresh probe
- failed sign-in attempts should keep the user in `AI Worker Setup / Sign In Required` with a specific inline error, not bounce them to `Unavailable`

Copy guidance:

- startup copy should frame the local AI worker as a required readiness step before the workspace opens
- sign-in copy should use provider-neutral language by default and mention Codex only in provider-specific setup details for the v1 adapter
- unavailable copy should focus on local repair and safe retry, not on vague backend failure wording
- when `Unavailable` is reached from `Checking` because `failureCode: 'healthcheck_failed'`, the user-facing message should say the local AI worker health check timed out and should offer a visible `Retry check` action

#### Settings

V1 should include a minimal settings screen:

- AI worker status and retry
- provider-specific setup guide access
- clear job-site browser data
- reset local app data
- app version

`Clear job-site browser data` clears only CV Maxxing's internal job-site browser profile.

`Reset local app data` should close active jobs, delete encrypted app storage, clear the app encryption key from Keychain, clear job-site browser data, and restart to setup/first launch. Require a destructive confirmation phrase such as `RESET`. Do not provide bulk backup/export before reset.

### UI rule

The renderer never performs generation or fetch logic directly.

The renderer only:

- submits commands
- queries tailored application state
- renders previews

## 15. Electron Process Boundaries

### Main process owns

- filesystem access
- SQLCipher/SQLite access
- encryption key access through OS keychain
- encrypted artifact storage
- AI worker process execution
- AI worker preflight and resumable onboarding state
- browser-assisted vacancy fetch
- HTML rendering for PDF export
- secure settings storage

### Preload owns

- typed API surface
- input validation at boundary
- typed AI worker onboarding and retry commands

### Renderer owns

- React state
- screen composition
- immutable tailored application browsing
- preview presentation
- TanStack Query-backed IPC query/mutation state where useful
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

- original CVs
- vacancy snapshots
- tailored applications
- cover letters

If the v1 Codex adapter needs auth secrets, store them in the OS keychain rather than plain app config.

If future non-Codex providers require API keys, store those secrets in the OS keychain and add provider-specific disclosure before use.

### Encryption at rest

Sensitive app data must be encrypted at rest:

- use a Keychain-backed encryption key
- prefer SQLCipher for SQLite metadata
- encrypt large artifacts at the storage adapter layer
- use opaque ID-based internal paths and filenames
- fail closed when the key cannot be unlocked

If app data is copied to another Mac without the key, the app should show a local data unlock failure state with retry/help/reset. Do not add recovery keys or encrypted whole-app backup/export in v1.

### Browser session handling

For LinkedIn or Indeed paths that need authenticated viewing:

- use a dedicated local browser profile
- keep the profile under app-managed local storage
- never surface raw session tokens to the renderer
- provide a `Clear job-site browser data` action
- preserve the session between launches unless the user clears it

### Network policy

V1 should make no hidden background network calls.

Allowed network activity:

- configured local AI worker behavior, disclosed during setup
- user-initiated vacancy URL access
- provider-specific setup/sign-in flows

Not allowed in v1:

- telemetry
- analytics
- crash reporting
- remote config
- automatic update checks
- production font CDN calls

The packaging/release architecture should not block future GitHub Releases auto-update, but v1 should not perform update checks.

## 17. Suggested Codebase Structure

```text
src/
├── main/
│   ├── bootstrap/
│   ├── ipc/
│   ├── services/
│   │   ├── ai-worker/
│   │   ├── vacancy/
│   │   ├── original-cv/
│   │   ├── tailored-applications/
│   │   └── render/
│   └── infrastructure/
│       ├── encryption/
│       ├── storage/
│       └── sqlite/
├── preload/
├── renderer/
│   ├── app/
│   ├── routes/
│   ├── features/
│   │   ├── ai-worker-setup/
│   │   ├── original-cvs/
│   │   ├── vacancies/
│   │   ├── tailored-applications/
│   │   ├── settings/
│   │   └── preview/
│   └── shared/
├── domain/
│   ├── ai-worker/
│   ├── original-cv/
│   ├── vacancy/
│   ├── tailored-application/
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
- SQLCipher-compatible SQLite
- Drizzle ORM
- Zod
- Tailwind CSS with CSS-variable tokens
- Radix primitives where accessible low-level UI primitives are useful
- TanStack Query for IPC-backed async renderer state
- ESLint
- Prettier-compatible formatting via repository tooling
- Vitest
- Playwright

Do not use MUI or Redux.

## 19. Repository Bootstrap and Delivery Architecture

### 19.1 Initial repository scaffold

The first implementation tasks must establish a production-shaped baseline rather than a throwaway prototype.

Bootstrap the repo as:

- `pnpm` workspace, even if v1 ships as one desktop app package, so app code, shared packages, and test utilities can evolve without a structural rewrite
- Electron + React + TypeScript + Vite scaffold with separate `main`, `preload`, and `renderer` entry points
- Tailwind configured for the app UI with CSS-variable tokens and future dark-mode compatibility
- shared TypeScript project references or equivalent build separation so the Electron process boundaries remain explicit
- path aliases only where they reflect architecture boundaries clearly; avoid alias sprawl
- `.env.example` and runtime config loading for non-secret local configuration such as `CHECKING_TIMEOUT_MS`
- deterministic app-data path resolution for dev, test, and packaged modes
- packaging choices that do not block future GitHub Releases auto-update after v1

### 19.2 Baseline package scripts

The scaffold should expose explicit scripts for:

- local development
- type-checking
- linting
- unit tests
- integration tests
- end-to-end tests
- production build
- packaged desktop builds for macOS Intel and Apple Silicon

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
- tests must not depend on a globally installed AI worker runtime unless the specific suite is marked as an opt-in environment test

### 19.4 Test environment strategy

Split test responsibility deliberately:

- unit tests for domain logic, normalization, validators, and render view-model logic
- integration tests for SQLite adapters, filesystem-backed services, IPC handlers, and render/export orchestration
- end-to-end tests for Electron user journeys and screen-state transitions
- optional environment tests for Codex CLI availability and live-site fetch compatibility, excluded from required CI unless explicitly enabled later

Test harness requirements:

- injectable app-data root
- injectable database path
- fake or fixture-backed AI worker adapter for deterministic non-environment tests
- fixture-backed vacancy snapshots and original CV inputs
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

The architecture should anticipate distributable macOS Intel and Apple Silicon builds early.

Baseline packaging requirements:

- signed notarization is not required for the first local-development milestone unless distribution work explicitly starts
- the build system must still produce runnable packaged app artifacts for macOS Intel and Apple Silicon
- preload hardening and asset path resolution must work in both dev and packaged modes
- app versioning should be disciplined from the start so GitHub Releases auto-update can be added after v1
- v1 should not include automatic update checks, but release packaging should not make a future updater hard to introduce

## 20. Implementation Plan

### Phase 0. Repo foundation and delivery platform

- scaffold `pnpm` workspace and Electron + React + TypeScript app shell
- configure linting, formatting, and type-checking
- configure Vitest and Playwright harnesses
- establish CI workflow for lint, type-check, tests, and build verification
- establish packaged-build paths for macOS Intel and Apple Silicon

### Phase 1. Foundation

- establish main/preload/renderer boundaries
- create SQLCipher-backed SQLite schema
- implement encrypted local app-data layout
- implement Keychain-backed encryption key management
- reproduce the main `design/app.pen` states
- implement startup AI worker readiness gate and setup-state routing

### Phase 2. Original CV

- import PDF and DOCX
- store originals as encrypted artifacts
- extract text deterministically
- normalize into canonical CV JSON through the AI-backed original-CV normalization service
- deterministically validate unreadable, invalid, and weak normalization failures
- store the returned writing-style profile without changing its persisted shape
- build one-active-original-CV UI with replace behavior

### Phase 3. Vacancy ingestion

- classify job board by URL
- implement Greenhouse deterministic fetcher
- implement LinkedIn and Indeed browser-backed fetchers
- implement generic fallback fetcher
- persist vacancy snapshots and normalized vacancy models
- implement pasted job text fallback with optional URL reference
- implement vacancy preview before `Adapt CV`

### Phase 4. AI worker generation engine

- implement provider-neutral AI worker port
- implement Codex CLI adapter as the only v1 adapter
- implement generation-time AI worker preflight and resumable setup flow for expired auth or lost runtime readiness
- define task JSON schema
- define output JSON schema
- implement transient plaintext generation-run workspace
- add JSON-contract validation
- add generation cancellation and interrupted-run cleanup

### Phase 5. Rendering and export

- implement `cv.html`-compatible renderer
- implement dynamic CV pagination with continued headers
- wire preview surface to actual generated PDFs
- export CV to PDF
- export cover letter to PDF
- attach exported artifacts to immutable tailored application

### Phase 6. Cover letters

- add cover-letter generation contract
- implement dedicated cover-letter HTML renderer
- surface in-app cover-letter PDF preview
- export cover letters as PDF from inside the app
- surface copyable cover-letter plain text

### Phase 7. Hardening

- retry logic
- better failure reporting
- authenticated browser session management
- clear job-site browser data
- reset local app data
- hard deletion semantics

## 21. Testing Strategy

### Unit tests

- vacancy normalization
- CV normalization
- style profile generation
- prompt/task assembly
- generation contract validation
- render view-model pagination logic

### Integration tests

- import original CV -> fetch vacancy -> generate tailored application -> render -> export PDF
- generate multiple tailored applications for one original CV
- reopen an existing tailored application and export the exact same PDF again
- IPC command/query coverage for tailored application browsing, AI worker preflight, and resumable pending commands
- SQLCipher, encryption, and filesystem adapter tests against isolated temporary app-data roots

### End-to-end tests

- startup AI worker setup flow when the runtime is already ready
- startup AI worker setup flow when sign-in is required
- startup AI worker setup flow when the runtime is unavailable
- first launch import flow
- first `Adapt CV` flow when AI worker readiness is still valid
- `Adapt CV` retry flow when sign-in is required after readiness was lost
- retry from AI worker unavailable state after local repair
- create tailored application from Greenhouse URL
- create tailored application from LinkedIn or Indeed with browser-assisted fetch
- browse saved tailored applications
- download a specific PDF on demand
- hard-delete a tailored application
- reset local app data

### Visual regression tests

- validate rendered preview against `design/cv.html`-aligned snapshots
- check A4 sizing and dynamic pagination constraints
- verify major `design/app.pen` screen states remain visually aligned during UI iteration

## 22. CI and Release Baseline

### Required CI checks for v1 development

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- build verification command
- Playwright Electron smoke coverage for the core happy path

### Recommended optional CI checks

- packaging verification for macOS Intel and Apple Silicon on protected branches

### Release baseline

- local developer builds must be reproducible from a clean clone
- packaged builds must resolve preload, renderer assets, and app-data paths correctly
- release automation may remain manual in v1 as long as the packaging process is documented and repeatable

## 23. Final Recommendation

Build v1 as:

- a macOS Intel and Apple Silicon Electron desktop app
- React + TypeScript + pnpm
- SQLCipher-backed SQLite + encrypted local filesystem artifacts
- no required backend
- no required Docker
- provider-neutral AI worker generation with Codex CLI as the only v1 adapter
- browser-capable live vacancy fetching
- pasted job description fallback
- immutable tailored application history
- shared HTML-to-PDF export path based on `design/cv.html`
- dynamic single-template CV pagination
- style-matched cover-letter generation
- in-app cover-letter PDF preview
- in-app cover-letter PDF export
- copyable cover-letter plain text
- PDF-only exports
- no telemetry, analytics, crash reporting, remote config, or v1 automatic update checks

## 24. References

- Local UI design reference: `design/app.pen`
- CV visual reference: `design/cv.pen`
- CV HTML reference: `design/cv.html`
- OpenClaw OpenAI/Codex provider docs: https://docs.openclaw.ai/providers/openai
- OpenAI local shell docs: https://developers.openai.com/api/docs/guides/tools-local-shell/
- OpenAI Codex app docs: https://developers.openai.com/codex/app/
