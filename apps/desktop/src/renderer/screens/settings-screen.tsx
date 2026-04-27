import type { ReactNode } from 'react'
import { Shield, Sparkles } from 'lucide-react'

import type { AiWorkerPreflightStatus } from '../../shared/ai-worker-preflight.js'
import { formatAiWorkerProviderName } from '../../shared/ai-worker-provider-display.js'
import type { SettingsSnapshot } from '../../shared/settings.js'
import type { RuntimeAlert } from '../runtime-alerts.js'
import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { RuntimeAlertBanner } from '../ui/runtime-alert.js'
import { SectionLabel } from '../ui/section-label.js'
import { StatusPill } from '../ui/status-pill.js'

export type SettingsSection = 'ai_worker' | 'local_data'

interface SettingsScreenProperties {
  activeSection: SettingsSection
  appOverlay?: ReactNode
  ambientActivityLabel?: string | null
  isClearingJobSiteBrowserData: boolean
  isOpeningSetupGuide: boolean
  isResettingLocalAppData: boolean
  isRetryingAiWorker: boolean
  onClearJobSiteBrowserData: () => void
  onOpenSetupGuide: () => void
  onResetLocalAppData: () => void
  onRetryAiWorker: () => void
  onSelectRailItem: (item: RailItemId) => void
  onSelectSection: (section: SettingsSection) => void
  runtimeAlert: RuntimeAlert | null
  snapshot: SettingsSnapshot
  workerStatus: AiWorkerPreflightStatus
  workerStatusLabel: string
  workerStatusTone: 'danger' | 'muted' | 'ready' | 'warning'
}

const privacyRows = [
  'Telemetry',
  'Analytics',
  'Crash reporting',
  'Remote config',
  'Runtime font CDN calls',
  'Automatic update checks',
] as const

export function SettingsScreen({
  activeSection,
  appOverlay,
  ambientActivityLabel,
  isClearingJobSiteBrowserData,
  isOpeningSetupGuide,
  isResettingLocalAppData,
  isRetryingAiWorker,
  onClearJobSiteBrowserData,
  onOpenSetupGuide,
  onResetLocalAppData,
  onRetryAiWorker,
  onSelectRailItem,
  onSelectSection,
  runtimeAlert,
  snapshot,
  workerStatus,
  workerStatusLabel,
  workerStatusTone,
}: SettingsScreenProperties) {
  const pageTitle = activeSection === 'ai_worker' ? 'AI' : 'Local data'
  const pageIntro =
    activeSection === 'ai_worker'
      ? 'Check the AI connection CV Maxxing uses for tailoring.'
      : 'Manage saved sign-ins for job pages and fully reset the app on this Mac.'

  return (
    <DesktopShell
      activeRailItem="settings"
      appOverlay={appOverlay}
      ambientActivityLabel={ambientActivityLabel}
      onSelectRailItem={onSelectRailItem}
      pageAlert={runtimeAlert ? <RuntimeAlertBanner alert={runtimeAlert} /> : undefined}
      pageIntro={pageIntro}
      pageTitle={pageTitle}
      railItems={['job_vacancies', 'original_cv', 'settings']}
      sidebar={
        <SidebarContainer>
          <SectionLabel>Settings</SectionLabel>
          <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
            Local app settings
          </h2>
          <div className="flex flex-col gap-[10px]">
            <SettingsSectionButton
              icon={<Sparkles aria-hidden="true" size={16} strokeWidth={2.1} />}
              isActive={activeSection === 'ai_worker'}
              label="AI"
              onClick={() => {
                onSelectSection('ai_worker')
              }}
            />
            <SettingsSectionButton
              icon={<Shield aria-hidden="true" size={16} strokeWidth={2.1} />}
              isActive={activeSection === 'local_data'}
              label="Local data"
              onClick={() => {
                onSelectSection('local_data')
              }}
            />
          </div>
          <div className="flex-1" />
        </SidebarContainer>
      }
    >
      {activeSection === 'ai_worker' ? (
        <AiWorkerSettingsSection
          isOpeningSetupGuide={isOpeningSetupGuide}
          isRetryingAiWorker={isRetryingAiWorker}
          onOpenSetupGuide={onOpenSetupGuide}
          onRetryAiWorker={onRetryAiWorker}
          snapshot={snapshot}
          workerStatus={workerStatus}
          workerStatusLabel={workerStatusLabel}
          workerStatusTone={workerStatusTone}
        />
      ) : (
        <LocalDataSettingsSection
          isClearingJobSiteBrowserData={isClearingJobSiteBrowserData}
          isResettingLocalAppData={isResettingLocalAppData}
          onClearJobSiteBrowserData={onClearJobSiteBrowserData}
          onResetLocalAppData={onResetLocalAppData}
          snapshot={snapshot}
        />
      )}
    </DesktopShell>
  )
}

function SettingsSectionButton({
  icon,
  isActive,
  label,
  onClick,
}: {
  icon: ReactNode
  isActive: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={`Show ${label} settings`}
      className={`flex w-full items-center gap-[10px] rounded-[8px] px-[10px] py-[10px] text-left text-[13px] font-extrabold ${
        isActive
          ? 'bg-[var(--color-surface-3)] text-[var(--color-copy-strong)]'
          : 'bg-white text-[var(--color-copy-strong)]'
      }`}
      onClick={onClick}
      type="button"
    >
      <span className={isActive ? 'text-[#4d6258]' : 'text-[var(--color-copy-subtle)]'}>
        {icon}
      </span>
      {label}
    </button>
  )
}

function AiWorkerSettingsSection({
  isOpeningSetupGuide,
  isRetryingAiWorker,
  onOpenSetupGuide,
  onRetryAiWorker,
  snapshot,
  workerStatus,
  workerStatusLabel,
  workerStatusTone,
}: {
  isOpeningSetupGuide: boolean
  isRetryingAiWorker: boolean
  onOpenSetupGuide: () => void
  onRetryAiWorker: () => void
  snapshot: SettingsSnapshot
  workerStatus: AiWorkerPreflightStatus
  workerStatusLabel: string
  workerStatusTone: 'danger' | 'muted' | 'ready' | 'warning'
}) {
  const shouldShowRecoveryActions = workerStatus !== 'ready'

  return (
    <PanelCard className="p-6">
      <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
        AI connection
      </p>
      <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
        CV Maxxing uses this connection to tailor your CV and cover letter.
      </p>
      <div className="mt-4 grid gap-3">
        <SettingsValueRow
          label="Using"
          value={formatAiWorkerProviderName(snapshot.workerProvider)}
        />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">
              Current status
            </p>
            <StatusPill label={workerStatusLabel} tone={workerStatusTone} />
          </div>
        </div>
      </div>
      {shouldShowRecoveryActions ? (
        <div className="mt-5 flex gap-3">
          <Button disabled={isRetryingAiWorker} onClick={onRetryAiWorker} tone="primary">
            {isRetryingAiWorker ? 'Trying again...' : 'Try again'}
          </Button>
          <Button disabled={isOpeningSetupGuide} onClick={onOpenSetupGuide} tone="secondary">
            {isOpeningSetupGuide ? 'Opening help...' : 'Get help'}
          </Button>
        </div>
      ) : null}
    </PanelCard>
  )
}

function LocalDataSettingsSection({
  isClearingJobSiteBrowserData,
  isResettingLocalAppData,
  onClearJobSiteBrowserData,
  onResetLocalAppData,
  snapshot,
}: {
  isClearingJobSiteBrowserData: boolean
  isResettingLocalAppData: boolean
  onClearJobSiteBrowserData: () => void
  onResetLocalAppData: () => void
  snapshot: SettingsSnapshot
}) {
  return (
    <div className="grid gap-4">
      <PanelCard className="p-6">
        <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
          Job-site browser data
        </p>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
          Clear saved sign-ins and browsing data for job pages without deleting your CV, saved jobs,
          or app settings.
        </p>
        <div className="mt-5">
          <Button
            disabled={isClearingJobSiteBrowserData}
            onClick={onClearJobSiteBrowserData}
            tone="secondary"
          >
            {isClearingJobSiteBrowserData ? 'Clearing browser data...' : 'Clear browser data'}
          </Button>
        </div>
      </PanelCard>

      <PanelCard className="border-[var(--color-status-danger)] bg-[var(--color-surface-danger)] p-6">
        <p className="m-0 text-[18px] font-extrabold text-[var(--color-status-danger)]">
          Reset local app data
        </p>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-status-danger)]">
          This permanently removes your CV, saved jobs, documents, settings, and sign-ins from this
          Mac. Bulk backup or export is not available in v1.
        </p>
        <div className="mt-5">
          <Button disabled={isResettingLocalAppData} onClick={onResetLocalAppData} tone="primary">
            {isResettingLocalAppData ? 'Resetting local app data...' : 'Reset local app data'}
          </Button>
        </div>
      </PanelCard>

      <PanelCard className="p-6">
        <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
          Privacy guardrails
        </p>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
          CV Maxxing stays local-first in v1 and blocks hidden background integrations.
        </p>
        <div className="mt-4 grid gap-2">
          <SettingsValueRow label="App version" value={snapshot.appVersion} />
          {privacyRows.map((label) => {
            return <SettingsValueRow key={label} label={label} value="Blocked" />
          })}
        </div>
      </PanelCard>
    </div>
  )
}

function SettingsValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">{label}</p>
        <p className="m-0 text-[13px] text-[var(--color-copy-muted)]">{value}</p>
      </div>
    </div>
  )
}
