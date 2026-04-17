# Ubiquitous Language

## Core product language

| Term                     | Definition                                                                             | Aliases to avoid                                    |
| ------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Your CV**              | The currently active imported CV the user manages and uses for new tailoring.          | Original CV in product copy, source CV, base CV     |
| **CV Snapshot**          | An immutable stored copy of **Your CV** as it existed when a tailored application ran. | Version, backup, copy                               |
| **Job**                  | A role opportunity being reviewed, saved, or tailored in the app.                      | Vacancy, job vacancy, listing, advert, posting      |
| **Job Draft**            | In-progress job input preserved before the app has confirmed the job details.          | Vacancy draft, unsaved vacancy, form data           |
| **Job Details**          | The reviewed structured job content shown before tailoring can proceed.                | Vacancy preview, parsed vacancy, normalized vacancy |
| **Tailored Application** | The immutable saved output set produced for one **CV Snapshot** and one **Job**.       | Package, version, saved result                      |
| **Adapted CV**           | A generated CV tailored to one **Job** while staying grounded in **Your CV**.          | Generated CV, tailored CV version, edited CV        |
| **Cover Letter**         | A generated letter tailored to the same **Job** and style-matched to **Your CV**.      | Letter, application letter                          |
| **Adaptation Summary**   | A compact explanation of emphasis, omissions, and gaps for a **Tailored Application**. | Change log, confidence report, comparison           |

## Job intake and review

| Term                             | Definition                                                                                           | Aliases to avoid                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Job Link**                     | A user-provided URL used to capture a **Job** from a live page.                                      | Vacancy URL, posting link             |
| **Pasted Job Description**       | User-pasted job content used when live capture is unavailable or incomplete.                         | Manual vacancy, pasted vacancy text   |
| **Browser-Assisted Job Capture** | Job capture that uses the app-managed browser session when direct fetching is blocked or incomplete. | Browser scraping, saved page import   |
| **Job Board**                    | The classified source type for a **Job**, such as LinkedIn, Indeed, Greenhouse, or a generic page.   | Source, provider, site                |
| **Ready to Tailor**              | The state where **Job Details** are complete enough to enable the tailoring flow.                    | Ready to generate, reviewed vacancy   |
| **Open the Job Page**            | The user action that opens the job in the internal browser session for capture or review.            | Open vacancy browser, resume scraping |

## AI and generation

| Term                           | Definition                                                                                                   | Aliases to avoid            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------- |
| **AI Worker**                  | The local provider-neutral generation runtime required before the app can open normal work.                  | AI, LLM, backend, Codex     |
| **AI Repair**                  | The blocking setup or recovery flow used when the **AI Worker** is missing, signed out, or unhealthy.        | Worker onboarding, fix flow |
| **Pending Generation Command** | A persisted generation request that can resume after **AI Repair**.                                          | Retry job, queued prompt    |
| **Generation Run**             | A single attempt to produce the structured outputs for one **Tailored Application**.                         | Prompt run, worker job      |
| **Codex CLI Adapter**          | The v1 provider-specific adapter that connects the **AI Worker** boundary to a bring-your-own Codex install. | Codex worker, OpenAI worker |
| **Factual Consistency**        | The rule that generated content must remain supported by **Your CV** evidence and the reviewed **Job**.      | Truthfulness, accuracy      |

## Documents, preview, and storage

| Term                        | Definition                                                                                      | Aliases to avoid                       |
| --------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| **PDF Preview**             | The in-app view of the actual generated PDF artifact.                                           | HTML preview, mock preview, preview    |
| **Exported PDF**            | A user-visible PDF file written outside app storage from a specific **Tailored Application**.   | Download, document export              |
| **Cover-Letter Plain Text** | The copyable text derived from the same canonical **Cover Letter** content as the PDF.          | Editable cover letter, draft text      |
| **App Storage**             | CV Maxxing's local encrypted storage for metadata and sensitive artifacts.                      | Database, cache, filesystem            |
| **Job-Site Browser Data**   | The app-managed browser profile data used for authenticated job access.                         | Cookies, browser cache, session data   |
| **Reset Local App Data**    | The destructive action that removes app storage, the encryption key, and job-site browser data. | Clear cache, delete account, wipe data |

## Relationships

- **Your CV** points to exactly one active **CV Snapshot** for new **Tailored Applications**.
- Replacing **Your CV** creates a new **CV Snapshot**; existing **Tailored Applications** keep their previous snapshot reference.
- A **Job Draft** becomes **Job Details** only after the app has checked and structured the input.
- A **Tailored Application** belongs to exactly one **CV Snapshot** and exactly one **Job**.
- A **Tailored Application** contains exactly one **Adapted CV**, exactly one **Cover Letter**, one **Adaptation Summary**, and generated PDF artifacts.
- A **Generation Run** produces structured content, but the renderer creates the **PDF Preview** and any **Exported PDF**.
- **Job-Site Browser Data** is separate from stored **Job** content and must not be exposed to the renderer.

## Example dialogue

> **Dev:** "When the user updates **Your CV**, should older **Jobs** start using the new file too?"
>
> **Domain expert:** "No. Updating **Your CV** creates a new **CV Snapshot**. Existing **Tailored Applications** stay tied to the snapshot they were created from."
>
> **Dev:** "If the pasted text is incomplete, do we already call that **Job Details**?"
>
> **Domain expert:** "No. That is still a **Job Draft**. It becomes **Job Details** only after the app checks and structures it."
>
> **Dev:** "In the shell, do we say **Job** or **Tailored Application**?"
>
> **Domain expert:** "Use **Job** in user-facing navigation. Use **Tailored Application** only when we need the precise immutable output concept."
>
> **Dev:** "Does the **AI Worker** generate the PDF too?"
>
> **Domain expert:** "No. The **AI Worker** returns structured content. The renderer creates the **PDF Preview** and any **Exported PDF**."

## Flagged ambiguities

- "Original CV" and "Your CV" were both used for the active user document; use **Your CV** in product copy and reserve **CV Snapshot** for immutable history.
- "Job", "job vacancy", "vacancy preview", and "saved job" were used for overlapping concepts; use **Job** in product copy, **Job Draft** before review, and **Job Details** after review.
- "Workspace" was used as a shell label for the normal connected state; avoid it in product language and use **Jobs** or **Your CV** instead.
- "AI" can mean either the shell section label or the underlying runtime; use **AI Worker** when discussing readiness, health, or generation behavior.
- "Preview" is ambiguous between job review and document rendering; use **Job Details** for the reviewed job content and **PDF Preview** for generated documents.
- "Version" is overloaded between CV history and generated outputs; use **CV Snapshot** for historical CV copies and **Tailored Application** for immutable generated results.
