import type { ReactNode } from 'react'

import type { ReadinessRouteViewModel } from '../../readiness/readiness-route.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface AiWorkerCheckingScreenProperties {
  onOpenSetupGuide: () => void
  readinessError: string | null
  viewModel: ReadinessRouteViewModel
}

interface SetupSidebarProperties {
  body: string
  children: ReactNode
  title: string
}

function SetupSidebar({ body, children, title }: SetupSidebarProperties) {
  return (
    <>
      <SectionLabel>Setup</SectionLabel>
      <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
        {title}
      </h2>
      <p className="m-0 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">{body}</p>
      <div className="flex flex-col gap-2">{children}</div>
      <div className="flex-1" />
      <PanelCard className="bg-[var(--color-surface-3)] p-3">
        <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">
          Local desktop gate
        </p>
        <p className="mt-2 text-xs leading-5 text-[var(--color-copy-muted)]">
          Sensitive CV and vacancy data stays blocked until the worker is ready.
        </p>
      </PanelCard>
    </>
  )
}

export function AiWorkerCheckingScreen({
  onOpenSetupGuide,
  readinessError,
  viewModel,
}: AiWorkerCheckingScreenProperties) {
  return (
    <DesktopShell
      activeRailItem="setup"
      sidebar={
        <SidebarContainer>
          <SetupSidebar body={viewModel.body} title="AI worker readiness">
            <PanelCard className="bg-[var(--color-surface-success)] p-2.5">
              <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">
                Find Codex CLI
              </p>
            </PanelCard>
            <PanelCard className="bg-[var(--color-surface-0)] p-2.5">
              <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">
                Verify signed-in session
              </p>
            </PanelCard>
          </SetupSidebar>
        </SidebarContainer>
      }
      subtitle="AI worker setup"
      workerLabel="Checking"
      workerTone="muted"
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
            Checking the local AI worker
          </h1>
          <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
            The workspace will unlock automatically when the required local worker is ready.
          </p>
        </div>
        <Button onClick={onOpenSetupGuide} tone="primary">
          Open setup help
        </Button>
      </div>

      <PanelCard className="mt-6 p-6">
        <div className="flex items-center gap-4">
          <div className="rounded-[8px] bg-[var(--color-surface-success)] p-2 text-[var(--color-copy-strong)]">
            ✓
          </div>
          <div className="flex-1">
            <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
              Readiness check in progress
            </p>
            <p className="mt-1 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
              Looking for the configured local worker, authentication state, and access to the
              readiness probe.
            </p>
          </div>
        </div>
        <div className="mt-5 h-2 rounded-full bg-[var(--color-border)]">
          <div className="h-full w-1/2 rounded-full bg-[var(--color-status-muted)]" />
        </div>
      </PanelCard>

      <PanelCard className="mt-4 min-h-[24rem] bg-[var(--color-shell-topbar)] p-[18px]">
        <p className="m-0 text-[13px] font-extrabold text-[var(--color-surface-0)]">
          Startup checks
        </p>
        <div className="mt-3 space-y-2 text-xs leading-5 text-[var(--color-copy-subtle)]">
          <p className="m-0">09:41 Codex CLI path detected</p>
          <p className="m-0">09:41 Reading local auth status</p>
          <p className="m-0">09:41 Preparing workspace readiness gate</p>
          {readinessError ? (
            <p className="m-0 text-[var(--color-status-danger)]">{readinessError}</p>
          ) : null}
        </div>
      </PanelCard>
    </DesktopShell>
  )
}
