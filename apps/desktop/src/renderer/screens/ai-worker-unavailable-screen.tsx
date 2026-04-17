import type { ReadinessRouteViewModel } from '../../readiness/readiness-route.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface AiWorkerUnavailableScreenProperties {
  isPrimaryActionPending: boolean
  isSecondaryActionPending: boolean
  onPrimaryAction: () => void
  onSecondaryAction: () => void
  readinessError: string | null
  viewModel: ReadinessRouteViewModel
}

export function AiWorkerUnavailableScreen({
  isPrimaryActionPending,
  isSecondaryActionPending,
  onPrimaryAction,
  onSecondaryAction,
  readinessError,
  viewModel,
}: AiWorkerUnavailableScreenProperties) {
  return (
    <DesktopShell
      activeRailItem="setup"
      sidebar={
        <SidebarContainer>
          <>
            <SectionLabel>Setup</SectionLabel>
            <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
              Worker unavailable
            </h2>
            <p className="m-0 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
              CV Maxxing cannot enter the workspace until the local AI worker can be started and
              verified.
            </p>
            <PanelCard className="bg-[var(--color-surface-danger)] p-3">
              <p className="m-0 text-sm font-bold text-[var(--color-status-danger)]">
                Startup failed
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-status-danger)]">
                {viewModel.diagnostic ?? viewModel.body}
              </p>
            </PanelCard>
            <div className="flex-1" />
          </>
        </SidebarContainer>
      }
      subtitle="AI worker setup"
      workerLabel="Unavailable"
      workerTone="danger"
    >
      <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Repair the local AI worker
      </h1>
      <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
        Install or configure the bring-your-own CLI adapter, then re-run the startup check.
      </p>

      <PanelCard className="mt-6 p-6">
        <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
          Required before workspace access
        </p>
        <p className="mt-2 max-w-2xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
          {viewModel.body}
        </p>
        {readinessError ? (
          <p className="mt-2 text-[13px] leading-[1.4] text-[var(--color-status-danger)]">
            {readinessError}
          </p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <Button disabled={isPrimaryActionPending} onClick={onPrimaryAction} tone="primary">
            {isPrimaryActionPending ? 'Retrying check...' : 'Retry check'}
          </Button>
          <Button disabled={isSecondaryActionPending} onClick={onSecondaryAction} tone="secondary">
            {isSecondaryActionPending ? 'Opening setup guide...' : 'Open setup guide'}
          </Button>
        </div>
      </PanelCard>
    </DesktopShell>
  )
}
