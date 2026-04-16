import type { ChangeEvent } from 'react'

import type { VacancySummary } from '../../shared/vacancy.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { VacancyPreviewCard } from '../ui/vacancy-preview-card.js'

interface WorkspaceDraftViewProperties {
  isAdaptingCv: boolean
  isCurrentDraftMeaningful: boolean
  isOpeningVacancyBrowser: boolean
  isReviewingVacancy: boolean
  onAdaptCv: () => void
  onOpenVacancyBrowserSession: () => void
  onReviewPastedVacancy: () => void
  onReviewVacancyUrl: () => void
  onTextDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onUrlDraftChange: (event: ChangeEvent<HTMLInputElement>) => void
  textDraft: string
  urlDraft: string
  vacancyPreview: VacancySummary | null
  vacancyReviewError: string | null
  workspaceError: string | null
}

const fieldClassName =
  'mt-2 w-full rounded-[8px] border border-[var(--color-border)] bg-white px-[14px] py-3 text-[13px] font-medium text-[var(--color-copy-strong)] outline-none transition placeholder:text-[var(--color-copy-subtle)] focus:border-[var(--color-ink-900)]'

export function WorkspaceDraftView({
  isAdaptingCv,
  isCurrentDraftMeaningful,
  isOpeningVacancyBrowser,
  isReviewingVacancy,
  onAdaptCv,
  onOpenVacancyBrowserSession,
  onReviewPastedVacancy,
  onReviewVacancyUrl,
  onTextDraftChange,
  onUrlDraftChange,
  textDraft,
  urlDraft,
  vacancyPreview,
  vacancyReviewError,
  workspaceError,
}: WorkspaceDraftViewProperties) {
  const isUrlSubmissionDisabled = isReviewingVacancy || isAdaptingCv || urlDraft.trim() === ''
  const isTextSubmissionDisabled = isReviewingVacancy || isAdaptingCv || textDraft.trim() === ''

  return (
    <>
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        {isCurrentDraftMeaningful ? 'Current vacancy draft' : 'Create a tailored application'}
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
        {isCurrentDraftMeaningful
          ? 'Current vacancy source content stays here until you review and generate a tailored application.'
          : 'Add one job vacancy, review the extracted role details, then generate an adapted CV and cover letter.'}
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
    </>
  )
}
