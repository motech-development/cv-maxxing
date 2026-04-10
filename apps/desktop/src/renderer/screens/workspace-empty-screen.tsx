import type { ChangeEvent } from 'react'

import type { OriginalCvSummary } from '../../shared/original-cv.js'
import type { TailoredApplicationListItem } from '../../shared/tailored-application.js'
import type { VacancySummary } from '../../shared/vacancy.js'
import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { Button } from '../ui/button.js'
import { OriginalCvReplacementCard } from '../ui/original-cv-replacement-card.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'
import { VacancyPreviewCard } from '../ui/vacancy-preview-card.js'

interface WorkspaceEmptyScreenProperties {
  activeOriginalCv: OriginalCvSummary | null
  applications: TailoredApplicationListItem[]
  importError: string | null
  isImportingOriginalCv: boolean
  isAdaptingCv: boolean
  isOpeningVacancyBrowser: boolean
  isReviewingVacancy: boolean
  onAdaptCv: () => void
  onOpenVacancyBrowserSession: () => void
  onOriginalCvFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onReplaceOriginalCv: () => void
  onResetDrafts: () => void
  onSelectApplication: (tailoredApplicationId: string) => void
  onReviewPastedVacancy: () => void
  onReviewVacancyUrl: () => void
  onSelectRailItem?: (item: RailItemId) => void
  onTextDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onUrlDraftChange: (event: ChangeEvent<HTMLInputElement>) => void
  originalCvFile: File | null
  textDraft: string
  urlDraft: string
  vacancyPreview: VacancySummary | null
  vacancyReviewError: string | null
  workspaceError: string | null
}

const fieldClassName =
  'mt-2 w-full rounded-[8px] border border-[var(--color-border)] bg-white px-[14px] py-3 text-[13px] font-medium text-[var(--color-copy-strong)] outline-none transition placeholder:text-[var(--color-copy-subtle)] focus:border-[var(--color-ink-900)]'

export function WorkspaceEmptyScreen({
  activeOriginalCv,
  applications,
  importError,
  isImportingOriginalCv,
  isAdaptingCv,
  isOpeningVacancyBrowser,
  isReviewingVacancy,
  onAdaptCv,
  onOpenVacancyBrowserSession,
  onOriginalCvFileSelection,
  onReplaceOriginalCv,
  onResetDrafts,
  onSelectApplication,
  onReviewPastedVacancy,
  onReviewVacancyUrl,
  onSelectRailItem,
  onTextDraftChange,
  onUrlDraftChange,
  originalCvFile,
  textDraft,
  urlDraft,
  vacancyPreview,
  vacancyReviewError,
  workspaceError,
}: WorkspaceEmptyScreenProperties) {
  const hasSavedApplications = applications.length > 0
  const isUrlSubmissionDisabled = isReviewingVacancy || isAdaptingCv || urlDraft.trim() === ''
  const isTextSubmissionDisabled = isReviewingVacancy || isAdaptingCv || textDraft.trim() === ''

  return (
    <DesktopShell
      activeRailItem="job_vacancies"
      onSelectRailItem={onSelectRailItem}
      sidebar={
        <>
          <SectionLabel>Job vacancies</SectionLabel>
          <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
            {hasSavedApplications ? 'Saved tailored applications' : 'No tailored applications yet'}
          </h2>
          <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
            {hasSavedApplications
              ? 'Start a fresh vacancy draft or reopen one of your saved tailored applications.'
              : 'Start with a job vacancy URL or paste the vacancy text. Saved tailored applications will appear here.'}
          </p>
          <Button onClick={onResetDrafts} tone="primary">
            New vacancy
          </Button>
          {hasSavedApplications ? (
            <div className="flex flex-col gap-[10px]">
              {applications.map((application) => {
                return (
                  <PanelCard className="bg-white p-3" key={application.id}>
                    <button
                      aria-label={`Open tailored application ${application.vacancyTitle ?? application.title}`}
                      className="w-full text-left"
                      onClick={() => {
                        onSelectApplication(application.id)
                      }}
                      type="button"
                    >
                      <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
                        {application.vacancyTitle ?? application.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">
                        {application.employer ? `${application.employer} · ` : ''}immutable PDF
                        outputs
                      </p>
                    </button>
                  </PanelCard>
                )
              })}
            </div>
          ) : null}
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
      {workspaceError ? (
        <div className="mt-4 max-w-4xl rounded-[var(--radius-card)] border border-[var(--color-status-danger)]/20 bg-[var(--color-surface-danger)] px-4 py-3 text-sm leading-6 text-[var(--color-status-danger)]">
          {workspaceError}
        </div>
      ) : null}

      <div className="mt-6 grid gap-[18px] md:grid-cols-2">
        <PanelCard className="flex min-h-[278px] flex-col p-5">
          <p className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">
            Open vacancy URL
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
            Paste one role URL to fetch and normalize the role first. The vacancy preview must be
            reviewed before tailoring can begin.
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
          <Button disabled={isUrlSubmissionDisabled} onClick={onReviewVacancyUrl} tone="primary">
            Review vacancy from URL
          </Button>
        </PanelCard>

        <PanelCard className="flex min-h-[278px] flex-col p-5">
          <p className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">
            Paste job text
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
            Use pasted vacancy text when the page is blocked or the role has no stable URL. The same
            preview contract is applied before `Adapt CV` becomes available.
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
          <Button
            disabled={isTextSubmissionDisabled}
            onClick={onReviewPastedVacancy}
            tone="primary"
          >
            Review pasted vacancy
          </Button>
        </PanelCard>
      </div>

      <VacancyPreviewCard
        isAdaptingCv={isAdaptingCv}
        isOpeningBrowserSession={isOpeningVacancyBrowser}
        onAdaptCv={onAdaptCv}
        onOpenBrowserSession={onOpenVacancyBrowserSession}
        preview={vacancyPreview}
        reviewError={vacancyReviewError}
      />
    </DesktopShell>
  )
}
