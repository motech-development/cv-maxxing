# Ubiquitous Language

## CV and application lifecycle

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Original CV** | The candidate's imported CV used as the truthful evidence base for adaptations. | Source CV, base CV, master CV |
| **Active Original CV** | The single original CV currently selected for creating new tailored applications. | Current source, selected version |
| **Original CV Snapshot** | An immutable stored copy of an original CV as it existed when a tailored application was generated. | Version, copy, backup |
| **Adapted CV** | A generated CV tailored to one job vacancy while remaining grounded in the original CV. | Generated CV, tailored CV, version |
| **Cover Letter** | A generated letter tailored to one job vacancy and style-matched to the original CV. | Letter, application letter |
| **Tailored Application** | The immutable saved output set for one original CV snapshot and one job vacancy. | Package, version, application package |
| **Adaptation Summary** | A compact explanation of emphasis, compression, omissions, and vacancy gaps for a tailored application. | Change log, confidence report, comparison |
| **Exported PDF** | A user-visible PDF file written outside app storage from a specific tailored application. | Download, document export, editable export |

## Vacancy intake

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Job Vacancy** | A role opportunity whose content is used to tailor an original CV and cover letter. | Job description, listing, advert, posting |
| **Vacancy Input** | The user-provided URL or pasted job text used to start vacancy ingestion. | Job input, intake payload |
| **Vacancy Draft** | In-progress vacancy input preserved while setup, sign-in, fetch, or generation is blocked. | Unsaved vacancy, form data |
| **Vacancy Snapshot** | The persisted vacancy evidence captured from a live URL or pasted job text. | Page cache, scrape, import |
| **Normalized Vacancy** | The structured vacancy model extracted from a vacancy snapshot. | Parsed job, structured job description |
| **Job Board** | The classified source type for a vacancy, such as LinkedIn, Indeed, Greenhouse, or generic. | Source, provider, site |
| **Browser-Assisted Vacancy Ingestion** | Vacancy ingestion that uses the app-managed browser session when direct fetching is blocked or incomplete. | Browser scraping, saved page import |
| **Pasted Job Text** | User-pasted vacancy content used when live URL extraction is unavailable or incomplete. | Manual job description, pasted description |

## AI worker and generation

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **AI Worker** | The local provider-neutral generation runtime required before CV import, vacancy drafting, or generation can proceed. | AI, LLM, Codex, backend |
| **Codex CLI Adapter** | The v1 provider-specific adapter that connects the AI worker boundary to a bring-your-own Codex CLI installation. | Codex worker, OpenAI worker |
| **AI Worker Setup** | The blocking startup flow that verifies the local AI worker before the workspace opens. | Onboarding, model setup |
| **Preflight** | The readiness check that verifies the configured AI worker is installed, launchable, authenticated, and healthy. | Health check, startup check |
| **Pending Generation Command** | A persisted generation request that can resume after AI worker sign-in or local setup repair. | Retry job, queued prompt |
| **Generation Run** | A single attempt to produce adapted CV and cover-letter structured outputs for a tailored application. | Prompt run, worker job |
| **Transient Worker Workspace** | A short-lived plaintext run directory containing bounded input and output artifacts for a generation run. | Temp folder, scratch space |
| **Writing Style Profile** | The structured description of an original CV's tone, vocabulary, punctuation, and phrasing constraints. | Style fingerprint, tone profile |
| **Factual Consistency** | The rule that generated content must remain supported by original CV evidence and vacancy grounding. | Truthfulness, accuracy |

## Rendering and documents

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Canonical CV Model** | The structured CV JSON used as the authoritative source for generation and rendering. | CV data, parsed CV |
| **Cover-Letter Model** | The structured cover-letter content used to produce both PDF and plain text outputs. | Letter JSON, text draft |
| **Render Model** | The structured document view model consumed by the HTML-to-PDF renderer. | Template data, view data |
| **Dynamic CV Template Family** | The single v1 CV visual system that supports single-page and multi-page CVs. | Template library, theme, layout set |
| **Continued Header** | The reduced header used on CV pages after page 1. | Repeated header, page 2 header |
| **Generated PDF Artifact** | The immutable in-app PDF created by the renderer for preview and export. | HTML preview, rendered document |
| **PDF Preview** | The in-app view of the actual generated PDF artifact. | HTML preview, mock preview |
| **Cover-Letter Plain Text** | The copyable text derived from the same canonical cover-letter content as the PDF. | Editable cover letter, draft text |

## Local storage and privacy

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **App Storage** | CV Maxxing's local encrypted storage for metadata and sensitive artifacts. | Database, cache, filesystem |
| **Encrypted Artifact** | A sensitive stored file encrypted at the storage adapter layer. | File, blob, attachment |
| **Metadata Store** | The SQLCipher-backed SQLite store for app records and references. | Database, registry |
| **Encryption Key** | The Keychain-backed key used to encrypt and decrypt local app data. | Secret, password, token |
| **Job-Site Browser Data** | The app-managed browser profile data used for authenticated vacancy access. | Cookies, browser cache, session data |
| **Reset Local App Data** | The destructive action that removes app storage, the encryption key, and job-site browser data. | Clear cache, delete account, wipe data |
| **Hard Deletion** | Removal of a record and its app-managed artifacts from CV Maxxing local storage. | Secure erase, purge |

## Relationships

- An **Active Original CV** points to exactly one **Original CV Snapshot** for new **Tailored Applications**.
- Replacing an **Active Original CV** creates a new **Original CV Snapshot**; existing **Tailored Applications** keep their previous snapshot reference.
- A **Tailored Application** belongs to exactly one **Original CV Snapshot** and exactly one **Vacancy Snapshot**.
- A **Tailored Application** contains exactly one **Adapted CV**, exactly one **Cover Letter**, one **Adaptation Summary**, and generated PDF artifacts.
- A **Job Vacancy** can be captured from one **Vacancy Input** as one **Vacancy Snapshot**.
- A **Normalized Vacancy** is derived from one **Vacancy Snapshot**.
- A **Generation Run** produces structured **Adapted CV** and **Cover-Letter Model** outputs, but the renderer produces the final **Generated PDF Artifacts**.
- The **AI Worker** never decides page breaks; the renderer owns pagination for the **Dynamic CV Template Family**.
- A **PDF Preview** must show the **Generated PDF Artifact**, not an HTML approximation.
- An **Exported PDF** is copied from a **Generated PDF Artifact** and is not tracked or deleted after it leaves **App Storage**.
- **Job-Site Browser Data** is separate from **Vacancy Snapshots** and must not be exposed to the renderer.
- **Hard Deletion** applies to CV Maxxing local storage and does not mean forensic secure erase on SSDs.

## Example dialogue

> **Dev:** "When the user replaces their **Active Original CV**, should old **Tailored Applications** point to the new file?"
> **Domain expert:** "No. Replacing it creates a new **Original CV Snapshot**. Existing **Tailored Applications** keep the snapshot used when they were generated."
> **Dev:** "If LinkedIn blocks direct extraction, do we create a **Vacancy Snapshot** from a saved HTML file?"
> **Domain expert:** "No. Use **Browser-Assisted Vacancy Ingestion** through the app-managed session, or fall back to **Pasted Job Text**."
> **Dev:** "Can the **AI Worker** return a final PDF if it already knows the vacancy?"
> **Domain expert:** "No. The **AI Worker** returns structured **Adapted CV** and **Cover-Letter Model** outputs. The renderer creates the **Generated PDF Artifacts**."
> **Dev:** "If the user dislikes the result, do we let them regenerate the same **Tailored Application**?"
> **Domain expert:** "No. A **Tailored Application** is immutable. They delete it and create a new one from the **Original CV Snapshot** and **Job Vacancy**."

## Flagged ambiguities

- "source CV", "base CV", and "master CV" all refer to **Original CV**; use **Original CV** in product and domain language.
- "version" is overloaded between generated output and stored CV history; use **Original CV Snapshot** for imported CV history and **Tailored Application** for a generated output set.
- "package" can imply editable or bundled files; use **Tailored Application** for the saved output set.
- "job description", "job listing", "advert", and "posting" should be normalized to **Job Vacancy** unless specifically referring to **Pasted Job Text**.
- "AI", "LLM", "Codex", and "backend" blur the provider-neutral boundary; use **AI Worker** in product flow and **Codex CLI Adapter** only for v1 provider-specific setup.
- "preview" is ambiguous if it means HTML; use **PDF Preview** for the in-app view of the actual **Generated PDF Artifact**.
- "regenerate" conflicts with v1 immutability; use "create a new **Tailored Application**" instead.
- "delete" can sound like forensic erasure; use **Hard Deletion** for app-managed deletion and state that exported PDFs outside app storage are not tracked.
