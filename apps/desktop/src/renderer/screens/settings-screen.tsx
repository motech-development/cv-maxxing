import type { ReactNode } from 'react'
import { Shield, Sparkles } from 'lucide-react'

import type { SettingsSnapshot } from '../../shared/settings.js'
import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../../shared/settings.js'
import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
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
  onChangeResetConfirmationPhrase: (value: string) => void
  onClearJobSiteBrowserData: () => void
  onOpenSetupGuide: () => void
  onResetLocalAppData: () => void
  onRetryAiWorker: () => void
  onSelectRailItem: (item: RailItemId) => void
  onSelectSection: (section: SettingsSection) => void
  resetConfirmationPhrase: string
  settingsMessage: string | null
  snapshot: SettingsSnapshot
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
  onChangeResetConfirmationPhrase,
  onClearJobSiteBrowserData,
  onOpenSetupGuide,
  onResetLocalAppData,
  onRetryAiWorker,
  onSelectRailItem,
  onSelectSection,
  resetConfirmationPhrase,
  settingsMessage,
  snapshot,
  workerStatusLabel,
  workerStatusTone,
}: SettingsScreenProperties) {
  return (
    <DesktopShell
      activeRailItem="settings"
      appOverlay={appOverlay}
      ambientActivityLabel={ambientActivityLabel}
      onSelectRailItem={onSelectRailItem}
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
              label="AI worker"
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
      subtitle="Settings"
      workerLabel={workerStatusLabel}
      workerTone={workerStatusTone}
    >
      {activeSection === 'ai_worker' ? (
        <AiWorkerSettingsSection
          isOpeningSetupGuide={isOpeningSetupGuide}
          isRetryingAiWorker={isRetryingAiWorker}
          onOpenSetupGuide={onOpenSetupGuide}
          onRetryAiWorker={onRetryAiWorker}
          settingsMessage={settingsMessage}
          snapshot={snapshot}
          workerStatusLabel={workerStatusLabel}
          workerStatusTone={workerStatusTone}
        />
      ) : (
        <LocalDataSettingsSection
          isClearingJobSiteBrowserData={isClearingJobSiteBrowserData}
          isResettingLocalAppData={isResettingLocalAppData}
          onChangeResetConfirmationPhrase={onChangeResetConfirmationPhrase}
          onClearJobSiteBrowserData={onClearJobSiteBrowserData}
          onResetLocalAppData={onResetLocalAppData}
          resetConfirmationPhrase={resetConfirmationPhrase}
          settingsMessage={settingsMessage}
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
  settingsMessage,
  snapshot,
  workerStatusLabel,
  workerStatusTone,
}: {
  isOpeningSetupGuide: boolean
  isRetryingAiWorker: boolean
  onOpenSetupGuide: () => void
  onRetryAiWorker: () => void
  settingsMessage: string | null
  snapshot: SettingsSnapshot
  workerStatusLabel: string
  workerStatusTone: 'danger' | 'muted' | 'ready' | 'warning'
}) {
  return (
    <>
      <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        AI worker
      </h1>
      <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
        Configure the local worker adapter used for CV adaptation and cover-letter generation.
        Background work surfaces in the shell without blocking the current view.
      </p>

      <PanelCard className="mt-6 p-6">
        <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
          Provider-neutral worker
        </p>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
          V1 uses a bring-your-own Codex CLI adapter while the app UI keeps provider-neutral AI
          worker language.
        </p>
        <div className="mt-4 grid gap-3">
          <SettingsValueRow label="Worker command" value={snapshot.workerCommand} />
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 text-[13px] font-extrabold text-[var(--color-copy-strong)]">
                Current status
              </p>
              <StatusPill label={workerStatusLabel} tone={workerStatusTone} />
            </div>
          </div>
        </div>
        {settingsMessage ? (
          <p className="mt-3 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
            {settingsMessage}
          </p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <Button disabled={isRetryingAiWorker} onClick={onRetryAiWorker} tone="primary">
            {isRetryingAiWorker ? 'Retrying status check...' : 'Retry status check'}
          </Button>
          <Button disabled={isOpeningSetupGuide} onClick={onOpenSetupGuide} tone="secondary">
            {isOpeningSetupGuide ? 'Opening setup guide...' : 'Open setup guide'}
          </Button>
        </div>
      </PanelCard>
    </>
  )
}

function LocalDataSettingsSection({
  isClearingJobSiteBrowserData,
  isResettingLocalAppData,
  onChangeResetConfirmationPhrase,
  onClearJobSiteBrowserData,
  onResetLocalAppData,
  resetConfirmationPhrase,
  settingsMessage,
  snapshot,
}: {
  isClearingJobSiteBrowserData: boolean
  isResettingLocalAppData: boolean
  onChangeResetConfirmationPhrase: (value: string) => void
  onClearJobSiteBrowserData: () => void
  onResetLocalAppData: () => void
  resetConfirmationPhrase: string
  settingsMessage: string | null
  snapshot: SettingsSnapshot
}) {
  const isResetEnabled = resetConfirmationPhrase === SETTINGS_RESET_CONFIRMATION_PHRASE

  return (
    <>
      <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Local data
      </h1>
      <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
        Control app-managed browser sessions and destructive local resets for this machine.
      </p>

      <div className="mt-6 grid gap-4">
        <PanelCard className="p-6">
          <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
            Job-site browser data
          </p>
          <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
            Clear the internal LinkedIn and Indeed browser profile without deleting original CVs,
            vacancies, tailored applications, or app settings.
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
            This permanently removes encrypted metadata, app-managed artifacts, run workspaces, and
            browser session data. Bulk backup or export is not available in v1.
          </p>
          <label
            className="mt-4 block text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-status-danger)]"
            htmlFor="reset-local-app-data-confirmation"
          >
            Type RESET to confirm destructive reset
          </label>
          <input
            aria-label="Type RESET to confirm destructive reset"
            className="mt-2 w-full rounded-[8px] border border-[var(--color-border)] bg-white px-[14px] py-3 text-[13px] font-medium text-[var(--color-copy-strong)] outline-none transition focus:border-[var(--color-ink-900)]"
            id="reset-local-app-data-confirmation"
            onChange={(event) => {
              onChangeResetConfirmationPhrase(event.target.value)
            }}
            type="text"
            value={resetConfirmationPhrase}
          />
          <div className="mt-5">
            <Button
              disabled={!isResetEnabled || isResettingLocalAppData}
              onClick={onResetLocalAppData}
              tone="primary"
            >
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

        {settingsMessage ? (
          <p className="m-0 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
            {settingsMessage}
          </p>
        ) : null}
      </div>
    </>
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
