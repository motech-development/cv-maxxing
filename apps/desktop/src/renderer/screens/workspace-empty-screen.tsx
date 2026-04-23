import type { ChangeEvent } from 'react'

import type { VacancyReviewState, VacancySummary } from '../../shared/vacancy.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { VacancyPreviewCard } from '../ui/vacancy-preview-card.js'

interface WorkspaceDraftViewProperties {
  draftReviewState: VacancyReviewState
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
}

const fieldClassName =
  'w-full rounded-[8px] border border-[var(--color-border)] bg-white px-[14px] py-3 text-[13px] font-medium text-[var(--color-copy-strong)] outline-none transition placeholder:text-[var(--color-copy-subtle)] focus:border-[var(--color-ink-900)]'

export function WorkspaceDraftView({
  draftReviewState,
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
}: WorkspaceDraftViewProperties) {
  const isDraftReviewed = draftReviewState === 'reviewed'
  const isUrlSubmissionDisabled =
    isDraftReviewed || isReviewingVacancy || isAdaptingCv || urlDraft.trim() === ''
  const isTextSubmissionDisabled =
    isDraftReviewed || isReviewingVacancy || isAdaptingCv || textDraft.trim() === ''
  const sourceFieldClassName = isDraftReviewed
    ? `${fieldClassName} bg-[var(--color-surface-2)] text-[var(--color-copy-muted)]`
    : fieldClassName
  let subtitle = 'Start with a job link, or paste the job description if you need to.'

  if (isCurrentDraftMeaningful) {
    subtitle = 'Check the job details before tailoring your CV and cover letter.'
  }

  if (isDraftReviewed) {
    subtitle = 'These job details are locked until you add another job.'
  }

  return (
    <>
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Add a job
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">{subtitle}</p>

      <div className="mt-6 grid gap-[18px] md:grid-cols-2">
        <PanelCard className="flex min-h-[278px] flex-col gap-3 p-5">
          <p className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">Job link</p>
          <p className="text-sm leading-6 text-[var(--color-copy-muted)]">
            {isDraftReviewed
              ? 'This job link is locked. Add another job if you want to change it.'
              : 'Paste the job link first. We’ll pull together the details before you tailor your CV.'}
          </p>
          <label
            className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]"
            htmlFor="workspace-vacancy-url"
          >
            Job link
          </label>
          <input
            aria-label="Job link"
            className={sourceFieldClassName}
            id="workspace-vacancy-url"
            onChange={onUrlDraftChange}
            placeholder="https://jobs.example.com/roles/123"
            readOnly={isDraftReviewed}
            type="url"
            value={urlDraft}
          />
          <div aria-hidden="true" className="flex-1" />
          <Button disabled={isUrlSubmissionDisabled} onClick={onReviewVacancyUrl} tone="primary">
            Check job details
          </Button>
        </PanelCard>

        <PanelCard className="flex min-h-[278px] flex-col gap-3 p-5">
          <p className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">
            Paste job description
          </p>
          <p className="text-sm leading-6 text-[var(--color-copy-muted)]">
            {isDraftReviewed
              ? 'This stays here for reference until you add another job.'
              : 'If the job link does not work, paste the job description instead.'}
          </p>
          <label
            className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]"
            htmlFor="workspace-vacancy-text"
          >
            Job description
          </label>
          <textarea
            aria-label="Job description"
            className={`${sourceFieldClassName} min-h-[108px] resize-none`.trim()}
            id="workspace-vacancy-text"
            onChange={onTextDraftChange}
            placeholder={
              'Senior platform engineer\nBuild reliable desktop tooling for technical users.'
            }
            readOnly={isDraftReviewed}
            value={textDraft}
          />
          <div aria-hidden="true" className="flex-1" />
          <Button
            disabled={isTextSubmissionDisabled}
            onClick={onReviewPastedVacancy}
            tone="primary"
          >
            Check job details
          </Button>
        </PanelCard>
      </div>

      <VacancyPreviewCard
        isDraftReviewed={isDraftReviewed}
        isAdaptingCv={isAdaptingCv}
        isOpeningBrowserSession={isOpeningVacancyBrowser}
        onAdaptCv={onAdaptCv}
        onOpenBrowserSession={onOpenVacancyBrowserSession}
        preview={vacancyPreview}
      />
    </>
  )
}
