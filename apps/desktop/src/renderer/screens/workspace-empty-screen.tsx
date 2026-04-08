import type { OriginalCvSummary } from '../../shared/original-cv.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface WorkspaceEmptyScreenProperties {
  activeOriginalCv: OriginalCvSummary | null
}

export function WorkspaceEmptyScreen({ activeOriginalCv }: WorkspaceEmptyScreenProperties) {
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
          <Button disabled tone="primary">
            New vacancy
          </Button>
          <div className="flex-1" />
          {activeOriginalCv ? (
            <PanelCard className="bg-[var(--color-surface-3)] p-4">
              <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
                Active original CV
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">
                {activeOriginalCv.originalFilename}
              </p>
            </PanelCard>
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
        <PanelCard className="min-h-[230px] p-5">
          <p className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">
            Open vacancy URL
          </p>
          <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--color-copy-muted)]">
            Use the internal browser for authenticated LinkedIn or Indeed pages.
          </p>
        </PanelCard>

        <PanelCard className="min-h-[230px] p-5">
          <p className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">
            Paste job text
          </p>
          <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--color-copy-muted)]">
            Fallback for blocked pages or vacancy posts without a stable URL.
          </p>
        </PanelCard>
      </div>
    </DesktopShell>
  )
}
