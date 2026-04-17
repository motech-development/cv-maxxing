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
      railItems={['setup']}
      sidebar={
        <SidebarContainer>
          <>
            <SectionLabel>Setup</SectionLabel>
            <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
              {viewModel.heading}
            </h2>
            <p className="m-0 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
              Something needs attention before the app can continue.
            </p>
            <PanelCard className="bg-[var(--color-surface-danger)] p-3">
              <p className="m-0 text-sm font-bold text-[var(--color-status-danger)]">
                AI needs attention
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-status-danger)]">
                {viewModel.diagnostic ?? viewModel.body}
              </p>
            </PanelCard>
            <div className="flex-1" />
          </>
        </SidebarContainer>
      }
      subtitle="Connect AI"
      statusPill={{
        label: 'Needs attention',
        tone: 'danger',
      }}
    >
      <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        {viewModel.heading}
      </h1>
      <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
        Fix AI on this Mac, then try again.
      </p>

      <PanelCard className="mt-6 p-6">
        <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
          What needs fixing
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
            {isPrimaryActionPending ? 'Trying again...' : 'Try again'}
          </Button>
          <Button disabled={isSecondaryActionPending} onClick={onSecondaryAction} tone="secondary">
            {isSecondaryActionPending ? 'Opening help...' : 'Get help'}
          </Button>
        </div>
      </PanelCard>
    </DesktopShell>
  )
}
