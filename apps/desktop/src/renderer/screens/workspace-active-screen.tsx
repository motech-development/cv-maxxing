import type { ChangeEvent } from 'react'

import type { OriginalCvSummary } from '../../shared/original-cv.js'
import { Button } from '../ui/button.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { OriginalCvReplacementCard } from '../ui/original-cv-replacement-card.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface WorkspaceActiveScreenProperties {
  activeOriginalCv: OriginalCvSummary | null
  applicationTitle: string | null
  importError: string | null
  isImportingOriginalCv: boolean
  onOriginalCvFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onReplaceOriginalCv: () => void
  originalCvFile: File | null
}

export function WorkspaceActiveScreen({
  activeOriginalCv,
  applicationTitle,
  importError,
  isImportingOriginalCv,
  onOriginalCvFileSelection,
  onReplaceOriginalCv,
  originalCvFile,
}: WorkspaceActiveScreenProperties) {
  const resolvedApplicationTitle = applicationTitle ?? 'Tailored application'

  return (
    <DesktopShell
      activeRailItem="job_vacancies"
      sidebar={
        <>
          <SectionLabel>Job vacancies</SectionLabel>
          <Button tone="primary">New vacancy</Button>
          <div className="flex flex-col gap-[10px]">
            <PanelCard className="bg-[var(--color-surface-3)] p-3">
              <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
                {resolvedApplicationTitle}
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">
                Tailored application
              </p>
            </PanelCard>
            <PanelCard className="bg-white p-3">
              <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
                Previous application
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">
                Immutable PDF output
              </p>
            </PanelCard>
            {activeOriginalCv ? (
              <OriginalCvReplacementCard
                activeOriginalCv={activeOriginalCv}
                importError={importError}
                inputId="workspace-active-original-cv-file-input"
                isImportingOriginalCv={isImportingOriginalCv}
                onFileSelection={onOriginalCvFileSelection}
                onImportOriginalCv={onReplaceOriginalCv}
                originalCvFile={originalCvFile}
              />
            ) : null}
          </div>
          <div className="flex-1" />
        </>
      }
      subtitle="Workspace"
      workerLabel="Ready"
      workerTone="ready"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
            {resolvedApplicationTitle}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
            Adapted CV and cover letter generated from the active original CV snapshot.
          </p>
        </div>
        <Button tone="primary">Export PDF</Button>
      </div>

      <div className="mt-4 flex gap-4">
        <PanelCard className="flex min-h-[620px] flex-1 flex-col p-[18px]">
          <div className="mb-4 inline-flex rounded-[8px] bg-[var(--color-ink-900)] px-3 py-2 text-[12px] font-extrabold text-white">
            Adapted CV
          </div>
          <div className="mx-auto flex min-h-[520px] w-full max-w-[680px] flex-col rounded-[6px] bg-white p-8 shadow-[0_18px_48px_rgba(8,20,31,0.08)]">
            <div className="h-8 w-[220px] rounded-[6px] bg-[var(--color-surface-3)]" />
            <div className="mt-3 h-3 w-[180px] rounded-full bg-[var(--color-surface-2)]" />
            <div className="mt-6 h-20 rounded-[6px] bg-[var(--color-surface-1)]" />
            <div className="mt-4 h-32 rounded-[6px] bg-[var(--color-surface-1)]" />
          </div>
        </PanelCard>

        <PanelCard className="flex w-[300px] flex-col gap-3 p-[18px]">
          <h2 className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
            Vacancy details
          </h2>
          <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
            {resolvedApplicationTitle}
          </p>
          <div className="h-px bg-[var(--color-border)]" />
          <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
            Proof and style system
          </p>
          <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
            Truthfulness checks, British English, and source-style preservation stay locked into the
            output.
          </p>
          <Button tone="secondary">Copy cover letter text</Button>
        </PanelCard>
      </div>
    </DesktopShell>
  )
}
