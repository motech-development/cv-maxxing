import type { ChangeEvent } from 'react'

import type { OriginalCvSummary } from '../../shared/original-cv.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { Button } from '../ui/button.js'
import { OriginalCvReplacementCard } from '../ui/original-cv-replacement-card.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface WorkspaceEmptyScreenProperties {
  activeOriginalCv: OriginalCvSummary | null
  importError: string | null
  isImportingOriginalCv: boolean
  isStartingGeneration: boolean
  onOriginalCvFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onReplaceOriginalCv: () => void
  onResetDrafts: () => void
  onStartFromText: () => void
  onStartFromUrl: () => void
  onTextDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onUrlDraftChange: (event: ChangeEvent<HTMLInputElement>) => void
  originalCvFile: File | null
  textDraft: string
  urlDraft: string
}

const fieldClassName =
  'mt-2 w-full rounded-[8px] border border-[var(--color-border)] bg-white px-[14px] py-3 text-[13px] font-medium text-[var(--color-copy-strong)] outline-none transition placeholder:text-[var(--color-copy-subtle)] focus:border-[var(--color-ink-900)]'

export function WorkspaceEmptyScreen({
  activeOriginalCv,
  importError,
  isImportingOriginalCv,
  isStartingGeneration,
  onOriginalCvFileSelection,
  onReplaceOriginalCv,
  onResetDrafts,
  onStartFromText,
  onStartFromUrl,
  onTextDraftChange,
  onUrlDraftChange,
  originalCvFile,
  textDraft,
  urlDraft,
}: WorkspaceEmptyScreenProperties) {
  const isUrlSubmissionDisabled = isStartingGeneration || urlDraft.trim() === ''
  const isTextSubmissionDisabled = isStartingGeneration || textDraft.trim() === ''

  return (
    <DesktopShell
      activeRailItem="job_vacancies"
      sidebar={
        <>
          <SectionLabel>Job vacancies</SectionLabel>
          <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
            No tailored applications yet
          </h2>
          <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
            Start with a job vacancy URL or paste the vacancy text. Saved tailored applications will
            appear here.
          </p>
          <Button onClick={onResetDrafts} tone="primary">
            New vacancy
          </Button>
          <div className="flex-1" />
          {activeOriginalCv ? (
            <OriginalCvReplacementCard
              activeOriginalCv={activeOriginalCv}
              importError={importError}
              inputId="workspace-empty-original-cv-file-input"
              isImportingOriginalCv={isImportingOriginalCv}
              onFileSelection={onOriginalCvFileSelection}
              onImportOriginalCv={onReplaceOriginalCv}
              originalCvFile={originalCvFile}
            />
          ) : null}
        </>
      }
      subtitle="Workspace"
      workerLabel="Ready"
      workerTone="ready"
    >
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Create a tailored application
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
        Add one job vacancy, review the extracted role details, then generate an adapted CV and
        cover letter.
      </p>

      <div className="mt-6 grid gap-[18px] md:grid-cols-2">
        <PanelCard className="flex min-h-[278px] flex-col p-5">
          <p className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">
            Open vacancy URL
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
            Paste one role URL to start tailoring immediately. If the AI worker needs repair, this
            draft stays attached to the active original CV.
          </p>
          <label
            className="mt-3 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]"
            htmlFor="workspace-vacancy-url"
          >
            Vacancy URL
          </label>
          <input
            aria-label="Vacancy URL"
            className={fieldClassName}
            id="workspace-vacancy-url"
            onChange={onUrlDraftChange}
            placeholder="https://jobs.example.com/roles/123"
            type="url"
            value={urlDraft}
          />
          <div className="mt-auto" />
          <Button disabled={isUrlSubmissionDisabled} onClick={onStartFromUrl} tone="primary">
            Start tailoring from URL
          </Button>
        </PanelCard>

        <PanelCard className="flex min-h-[278px] flex-col p-5">
          <p className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">
            Paste job text
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
            Use pasted vacancy text when the page is blocked or the role has no stable URL. The
            draft is preserved if tailoring has to pause for AI worker repair.
          </p>
          <label
            className="mt-3 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]"
            htmlFor="workspace-vacancy-text"
          >
            Job vacancy text
          </label>
          <textarea
            aria-label="Job vacancy text"
            className={`${fieldClassName} min-h-[108px] resize-none`.trim()}
            id="workspace-vacancy-text"
            onChange={onTextDraftChange}
            placeholder={
              'Senior platform engineer\nBuild reliable desktop tooling for technical users.'
            }
            value={textDraft}
          />
          <div className="mt-auto" />
          <Button disabled={isTextSubmissionDisabled} onClick={onStartFromText} tone="primary">
            Start tailoring from text
          </Button>
        </PanelCard>
      </div>
    </DesktopShell>
  )
}
