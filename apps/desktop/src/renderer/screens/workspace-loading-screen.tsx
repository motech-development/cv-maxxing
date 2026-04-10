import type { PendingGenerationCommand } from '../../shared/pending-generation.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface WorkspaceLoadingScreenProperties {
  isPendingAction: boolean
  onAbandonDraft: () => void
  onOpenTailoredApplication: () => void
  pendingGenerationCommand: PendingGenerationCommand | null
  workspaceError: string | null
}

export function WorkspaceLoadingScreen({
  isPendingAction,
  onAbandonDraft,
  onOpenTailoredApplication,
  pendingGenerationCommand,
  workspaceError,
}: WorkspaceLoadingScreenProperties) {
  const loadingTitle = buildPendingGenerationTitle(pendingGenerationCommand)
  const loadingMeta = buildPendingGenerationMeta(pendingGenerationCommand)

  return (
    <DesktopShell
      activeRailItem="job_vacancies"
      sidebar={
        <>
          <SectionLabel>Job vacancies</SectionLabel>
          <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
            Tailoring in progress
          </h2>
          <PanelCard className="bg-[var(--color-surface-3)] p-3">
            <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
              {loadingTitle}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">{loadingMeta}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
              <div className="h-full w-[52%] rounded-full bg-[var(--color-copy-muted)]" />
            </div>
          </PanelCard>
          <div className="flex-1" />
        </>
      }
      subtitle="Workspace"
      workerLabel="Generating"
      workerTone="warning"
    >
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Generating tailored application
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
        Your vacancy draft stays available here until the tailored application is completed or
        abandoned.
      </p>
      {workspaceError ? (
        <div className="mt-4 max-w-4xl rounded-[var(--radius-card)] border border-[var(--color-status-danger)]/20 bg-[var(--color-surface-danger)] px-4 py-3 text-sm leading-6 text-[var(--color-status-danger)]">
          {workspaceError}
        </div>
      ) : null}
      <PanelCard className="mt-6 max-w-4xl gap-4 p-6">
        <p className="m-0 text-xl font-extrabold text-[var(--color-copy-strong)]">
          Local AI worker is adapting the CV
        </p>
        <p className="m-0 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
          The local AI worker is generating the adapted CV and cover letter now. Prompts enforce
          British English and British-style cover-letter dates before the PDF previews are created.
          If setup repair interrupts the run, this screen restores the saved vacancy draft.
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div className="h-full w-[58%] rounded-full bg-[var(--color-border)]" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isPendingAction || pendingGenerationCommand === null}
            onClick={onOpenTailoredApplication}
            tone="primary"
          >
            Open tailored application
          </Button>
          <Button disabled={isPendingAction} onClick={onAbandonDraft} tone="secondary">
            Abandon draft
          </Button>
        </div>
      </PanelCard>
      <PanelCard className="mt-4 max-w-4xl gap-4 bg-white p-5">
        <div className="h-6 rounded-[6px] bg-[var(--color-surface-3)]" />
        <div className="h-[420px] rounded-[6px] bg-[var(--color-surface-1)]" />
      </PanelCard>
    </DesktopShell>
  )
}

function buildPendingGenerationTitle(
  pendingGenerationCommand: PendingGenerationCommand | null,
): string {
  const vacancyTitle = extractVacancyDraftTitle(pendingGenerationCommand)

  if (vacancyTitle !== null) {
    return vacancyTitle
  }

  return (
    tryFormatHostname(pendingGenerationCommand?.vacancyDraft.url ?? '') ?? 'Tailored application'
  )
}

function buildPendingGenerationMeta(
  pendingGenerationCommand: PendingGenerationCommand | null,
): string {
  const hostname = tryFormatHostname(pendingGenerationCommand?.vacancyDraft.url ?? '')

  if (hostname === null) {
    return 'processing'
  }

  return `${hostname} · processing`
}

function tryFormatHostname(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./u, '')

    if (hostname === '') {
      return null
    }

    return hostname
  } catch {
    return null
  }
}

function extractVacancyDraftTitle(
  pendingGenerationCommand: PendingGenerationCommand | null,
): string | null {
  const firstLine = pendingGenerationCommand?.vacancyDraft.text
    .split('\n')
    .map((line) => {
      return line.trim()
    })
    .find((line) => {
      return line !== ''
    })

  if (firstLine === undefined) {
    return null
  }

  return firstLine
}
