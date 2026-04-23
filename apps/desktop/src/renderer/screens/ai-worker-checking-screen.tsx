import type { ReactNode } from 'react'

import type { ReadinessRouteViewModel } from '../../readiness/readiness-route.js'
import type { RuntimeAlert } from '../runtime-alerts.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { RuntimeAlertBanner } from '../ui/runtime-alert.js'
import { SectionLabel } from '../ui/section-label.js'

interface AiWorkerCheckingScreenProperties {
  onOpenSetupGuide: () => void
  runtimeAlert: RuntimeAlert | null
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
        <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">AI check</p>
        <p className="mt-2 text-xs leading-5 text-[var(--color-copy-muted)]">
          Your CV and job details stay on hold until AI is ready.
        </p>
      </PanelCard>
    </>
  )
}

export function AiWorkerCheckingScreen({
  onOpenSetupGuide,
  runtimeAlert,
  viewModel,
}: AiWorkerCheckingScreenProperties) {
  return (
    <DesktopShell
      activeRailItem="setup"
      pageAlert={runtimeAlert ? <RuntimeAlertBanner alert={runtimeAlert} /> : undefined}
      pageHeaderActions={
        <Button onClick={onOpenSetupGuide} tone="primary">
          Get help
        </Button>
      }
      pageIntro="We'll open the app as soon as AI is ready on this Mac."
      pageTitle="Getting AI ready"
      railItems={['setup']}
      sidebar={
        <SidebarContainer>
          <SetupSidebar body={viewModel.body} title={viewModel.heading}>
            <PanelCard className="bg-[var(--color-surface-success)] p-2.5">
              <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">
                Check AI on this Mac
              </p>
            </PanelCard>
            <PanelCard className="bg-[var(--color-surface-0)] p-2.5">
              <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">
                Confirm you can continue
              </p>
            </PanelCard>
          </SetupSidebar>
        </SidebarContainer>
      }
      subtitle="Connect AI"
      statusPill={{
        label: 'Checking',
        tone: 'muted',
      }}
    >
      <PanelCard className="p-6">
        <div className="flex items-center gap-4">
          <div className="rounded-[8px] bg-[var(--color-surface-success)] p-2 text-[var(--color-copy-strong)]">
            ✓
          </div>
          <div className="flex-1">
            <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
              Checking AI
            </p>
            <p className="mt-1 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
              We&apos;re checking your AI connection and whether you&apos;re ready to continue.
            </p>
          </div>
        </div>
        <div className="mt-5 h-2 rounded-full bg-[var(--color-border)]">
          <div className="h-full w-1/2 rounded-full bg-[var(--color-status-muted)]" />
        </div>
      </PanelCard>

      <PanelCard className="mt-4 min-h-[24rem] bg-[var(--color-shell-topbar)] p-[18px]">
        <p className="m-0 text-[13px] font-extrabold text-[var(--color-surface-0)]">
          Setup details
        </p>
        <div className="mt-3 space-y-2 text-xs leading-5 text-[var(--color-copy-subtle)]">
          <p className="m-0">09:41 Looking for AI on this Mac</p>
          <p className="m-0">09:41 Checking sign-in</p>
          <p className="m-0">09:41 Getting AI ready</p>
        </div>
      </PanelCard>
    </DesktopShell>
  )
}
