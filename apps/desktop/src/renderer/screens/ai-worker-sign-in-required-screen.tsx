import type { ReadinessRouteViewModel } from '../../readiness/readiness-route.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface AiWorkerSignInRequiredScreenProperties {
  isPrimaryActionPending: boolean
  isSecondaryActionPending: boolean
  onPrimaryAction: () => void
  onSecondaryAction: () => void
  readinessError: string | null
  viewModel: ReadinessRouteViewModel
}

export function AiWorkerSignInRequiredScreen({
  isPrimaryActionPending,
  isSecondaryActionPending,
  onPrimaryAction,
  onSecondaryAction,
  readinessError,
  viewModel,
}: AiWorkerSignInRequiredScreenProperties) {
  return (
    <DesktopShell
      activeRailItem="setup"
      sidebar={
        <SidebarContainer>
          <>
            <SectionLabel>Setup</SectionLabel>
            <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
              Sign in to the local worker
            </h2>
            <p className="m-0 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
              The app found the worker runtime, but generation remains locked until the local CLI
              session is authenticated.
            </p>
            <PanelCard className="bg-[var(--color-surface-warning)] p-2.5">
              <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">
                Continue with provider sign-in
              </p>
            </PanelCard>
            <div className="flex-1" />
          </>
        </SidebarContainer>
      }
      subtitle="AI worker setup"
      workerLabel="Sign in required"
      workerTone="warning"
    >
      <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Connect the local AI worker
      </h1>
      <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
        Open the provider-specific sign-in flow, then return here once the local CLI reports an
        active session.
      </p>

      <PanelCard className="mt-6 p-6">
        <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
          Codex CLI session
        </p>
        <p className="mt-2 max-w-2xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
          {viewModel.body}
        </p>
        {viewModel.diagnostic ? (
          <p className="mt-2 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
            {viewModel.diagnostic}
          </p>
        ) : null}
        {readinessError ? (
          <p className="mt-2 text-[13px] leading-[1.4] text-[var(--color-status-danger)]">
            {readinessError}
          </p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <Button disabled={isPrimaryActionPending} onClick={onPrimaryAction} tone="primary">
            {isPrimaryActionPending ? 'Continuing sign-in...' : 'Continue sign-in'}
          </Button>
          <Button disabled={isSecondaryActionPending} onClick={onSecondaryAction} tone="secondary">
            {isSecondaryActionPending ? 'Opening setup guide...' : 'Open setup guide'}
          </Button>
        </div>
      </PanelCard>

      <PanelCard className="mt-4 min-h-[18rem] bg-[var(--color-shell-topbar)] p-[18px]">
        <p className="m-0 text-[13px] font-extrabold text-[var(--color-surface-0)]">
          Waiting for authenticated local worker session
        </p>
      </PanelCard>
    </DesktopShell>
  )
}
