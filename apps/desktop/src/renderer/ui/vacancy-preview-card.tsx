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
  reviewError: string | null
}

export function VacancyPreviewCard({
  isDraftReviewed,
  isAdaptingCv,
  isOpeningBrowserSession,
  onAdaptCv,
  onOpenBrowserSession,
  preview,
  reviewError,
}: VacancyPreviewCardProperties) {
  if (preview === null) {
    return (
      <PanelCard className="mt-6 flex min-h-[256px] flex-col justify-between p-5">
        <div className="flex flex-col gap-3">
          <SectionLabel>Vacancy preview</SectionLabel>
          <h2 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
            Review a vacancy before adapting
          </h2>
          <p className="m-0 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
            Use the URL or pasted-text intake above to lock a compact vacancy preview. `Adapt CV`
            stays disabled until the role details are reviewable.
          </p>
          {reviewError ? (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-status-danger)]/20 bg-[var(--color-surface-danger)] px-4 py-3 text-sm leading-6 text-[var(--color-status-danger)]">
              {reviewError}
            </div>
          ) : null}
        </div>
        <div className="mt-5 grid gap-3 text-sm leading-6 text-[var(--color-copy-muted)] md:grid-cols-3">
          <PreviewHint
            body="Deterministic URL fetches and pasted text both land in the same preview contract."
            title="Single review surface"
          />
          <PreviewHint
            body="Incomplete extraction keeps the entered URL or pasted text intact for the next attempt."
            title="Draft preservation"
          />
          <PreviewHint
            body="Authenticated LinkedIn and Indeed roles can hand off to the internal browser session."
            title="Browser fallback"
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
            <SectionLabel>{isDraftReviewed ? 'Reviewed vacancy' : 'Vacancy preview'}</SectionLabel>
            {isDraftReviewed ? null : (
              <StatusPill label={statusPill.label} tone={statusPill.tone} />
            )}
          </div>
          <h2 className="mt-3 text-[24px] font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
            {preview.title ?? 'Untitled vacancy'}
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
            Adapt CV
          </Button>
          {browserSessionAvailable ? (
            <Button
              disabled={isOpeningBrowserSession}
              onClick={onOpenBrowserSession}
              tone="secondary"
            >
              Open internal browser session
            </Button>
          ) : null}
        </div>
      </div>

      {preview.blockingReason ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-status-warning)]/30 bg-[var(--color-surface-warning)] px-4 py-3 text-sm leading-6 text-[var(--color-copy-strong)]">
          {preview.blockingReason}
        </div>
      ) : null}

      {reviewError ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-status-danger)]/20 bg-[var(--color-surface-danger)] px-4 py-3 text-sm leading-6 text-[var(--color-status-danger)]">
          {reviewError}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-4">
          <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
            Normalized summary
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--color-copy-strong)]">
            {preview.textPreview === '' ? 'No extracted summary yet.' : preview.textPreview}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <PreviewList
            items={preview.responsibilities}
            title="Responsibilities"
            emptyState="No reviewable responsibilities were extracted yet."
          />
          <PreviewList
            items={preview.requirements}
            title="Requirements"
            emptyState="No reviewable requirements were extracted yet."
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
  return (
    preview.originalUrl !== null &&
    !preview.canGenerate &&
    (preview.source === 'indeed' || preview.source === 'linkedin')
  )
}

function getPreviewStatusPill(preview: VacancySummary): {
  label: string
  tone: 'danger' | 'muted' | 'ready' | 'warning'
} {
  if (preview.canGenerate) {
    return {
      label: 'Ready to adapt',
      tone: 'ready',
    }
  }

  if (isBrowserSessionAvailable(preview)) {
    return {
      label: 'Browser sign-in required',
      tone: 'warning',
    }
  }

  return {
    label: 'Needs more detail',
    tone: 'warning',
  }
}
