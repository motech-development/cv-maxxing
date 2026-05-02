import type { VacancySummary } from '../../shared/vacancy.js'
import { Button } from './button.js'
import { PanelCard } from './panel-card.js'
import { SectionLabel } from './section-label.js'
import { StatusPill } from './status-pill.js'

interface VacancyPreviewCardProperties {
  isDraftReviewed: boolean
  isAdaptingCv: boolean
  isOpeningBrowserSession: boolean
  onAdaptCv: () => void
  onOpenBrowserSession: () => void
  preview: VacancySummary | null
}

export function VacancyPreviewCard({
  isDraftReviewed,
  isAdaptingCv,
  isOpeningBrowserSession,
  onAdaptCv,
  onOpenBrowserSession,
  preview,
}: VacancyPreviewCardProperties) {
  if (preview === null) {
    return (
      <PanelCard className="mt-6 flex min-h-[256px] flex-col justify-between p-5">
        <div className="flex flex-col gap-3">
          <SectionLabel>Job details</SectionLabel>
          <h2 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
            Check this job before tailoring your CV
          </h2>
          <p className="m-0 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
            Use the job link or pasted description above to pull together the key details. Tailor
            your CV is disabled until the job is ready.
          </p>
        </div>
        <div className="mt-5 grid gap-3 text-sm leading-6 text-[var(--color-copy-muted)] md:grid-cols-3">
          <PreviewHint
            body="You can review everything in one place before you tailor your CV."
            title="One place to check"
          />
          <PreviewHint
            body="If something goes wrong, we keep what you entered so you can try again."
            title="We keep your draft"
          />
          <PreviewHint
            body="If the job page needs more access, open it and come back here."
            title="Open the job page"
          />
        </div>
      </PanelCard>
    )
  }

  const statusPill = getPreviewStatusPill(preview)
  const browserSessionAvailable = isBrowserSessionAvailable(preview)
  const resolvedUrl = preview.resolvedUrl ?? preview.originalUrl
  const previewLines = [preview.employer, preview.location].filter((line): line is string => {
    return line !== null
  })

  return (
    <PanelCard className="mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <SectionLabel>Job details</SectionLabel>
            {isDraftReviewed ? null : (
              <StatusPill label={statusPill.label} tone={statusPill.tone} />
            )}
          </div>
          <h2 className="mt-3 text-[24px] font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
            {preview.title ?? 'Untitled job'}
          </h2>
          {previewLines.length > 0 ? (
            <p className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
              {previewLines.join(' · ')}
            </p>
          ) : null}
          {resolvedUrl ? (
            <p className="mt-2 truncate text-xs leading-5 text-[var(--color-copy-muted)]">
              {resolvedUrl}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-[224px] flex-col gap-2">
          <Button
            disabled={!preview.canGenerate || isAdaptingCv}
            onClick={onAdaptCv}
            tone="primary"
          >
            Tailor your CV
          </Button>
          {browserSessionAvailable ? (
            <Button
              disabled={isOpeningBrowserSession}
              onClick={onOpenBrowserSession}
              tone="secondary"
            >
              Open the job page
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4">
          <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
            About the job
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--color-copy-strong)]">
            {preview.textPreview === '' ? 'The job details will appear here.' : preview.textPreview}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <PreviewList
            items={preview.responsibilities}
            title="What you'll be doing"
            emptyState="What you'll be doing will appear here."
          />
          <PreviewList
            items={preview.requirements}
            title="What they're looking for"
            emptyState="What they're looking for will appear here."
          />
        </div>
      </div>
    </PanelCard>
  )
}

interface PreviewHintProperties {
  body: string
  title: string
}

function PreviewHint({ body, title }: PreviewHintProperties) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white px-4 py-3">
      <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">{title}</p>
      <p className="m-0 mt-2">{body}</p>
    </div>
  )
}

interface PreviewListProperties {
  emptyState: string
  items: string[]
  title: string
}

function PreviewList({ emptyState, items, title }: PreviewListProperties) {
  const visibleItems = items.slice(0, 3)

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4">
      <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
        {title}
      </p>
      {visibleItems.length > 0 ? (
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-6 text-[var(--color-copy-strong)]">
          {visibleItems.map((item) => {
            return <li key={item}>{item}</li>
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[var(--color-copy-muted)]">{emptyState}</p>
      )}
    </div>
  )
}

function isBrowserSessionAvailable(preview: VacancySummary): boolean {
  return preview.inputType === 'url' && preview.originalUrl !== null && !preview.canGenerate
}

function getPreviewStatusPill(preview: VacancySummary): {
  label: string
  tone: 'danger' | 'muted' | 'ready' | 'warning'
} {
  if (preview.canGenerate) {
    return {
      label: 'Ready to tailor',
      tone: 'ready',
    }
  }

  if (isBrowserSessionAvailable(preview)) {
    return {
      label: 'Open the job page',
      tone: 'warning',
    }
  }

  return {
    label: 'Needs more detail',
    tone: 'warning',
  }
}
