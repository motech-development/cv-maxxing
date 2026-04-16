import type { ReactNode } from 'react'
import { Briefcase, FileText, LoaderCircle, Settings, Sparkles } from 'lucide-react'

import { StatusPill } from '../ui/status-pill.js'

export type RailItemId = 'job_vacancies' | 'original_cv' | 'settings' | 'setup'

interface DesktopShellProperties {
  activeRailItem: RailItemId
  appOverlay?: ReactNode
  ambientActivityLabel?: string | null
  children: ReactNode
  onSelectRailItem?: (item: RailItemId) => void
  sidebar: ReactNode
  subtitle: string
  workspaceOverlay?: ReactNode
  workerTone: 'danger' | 'muted' | 'ready' | 'warning'
  workerLabel: string
}

interface RailButtonProperties {
  icon: RailItemId
  isActive: boolean
  label: string
  onSelect?: (item: RailItemId) => void
}

function RailIcon({ icon, isActive }: Pick<RailButtonProperties, 'icon' | 'isActive'>) {
  const stroke = isActive ? '#F7F8F6' : '#93A29A'
  const commonProperties = { 'aria-hidden': true, size: 20, stroke, strokeWidth: 2 } as const

  if (icon === 'setup') {
    return <Sparkles {...commonProperties} />
  }

  if (icon === 'job_vacancies') {
    return <Briefcase {...commonProperties} />
  }

  if (icon === 'original_cv') {
    return <FileText {...commonProperties} />
  }

  return <Settings {...commonProperties} />
}

function RailButton({ icon, isActive, label, onSelect }: RailButtonProperties) {
  return (
    <button
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className={`flex h-11 w-11 items-center justify-center rounded-[8px] border border-transparent text-[11px] font-bold ${
        isActive
          ? 'bg-[var(--color-rail-active)] text-[var(--color-surface-0)]'
          : 'bg-[var(--color-rail-idle)] text-[var(--color-copy-subtle)]'
      }`}
      onClick={() => {
        onSelect?.(icon)
      }}
      title={label}
      type="button"
    >
      <RailIcon icon={icon} isActive={isActive} />
    </button>
  )
}

function AmbientActivityIndicator({ label }: { label: string }) {
  return (
    <div
      aria-label={label}
      className="flex h-[14px] w-[14px] items-center justify-center text-[var(--color-copy-subtle)]"
      role="status"
      title={label}
    >
      <LoaderCircle
        aria-hidden="true"
        className="h-[14px] w-[14px] animate-[spin_2.4s_linear_infinite]"
        strokeWidth={2.1}
      />
    </div>
  )
}

export function DesktopShell({
  activeRailItem,
  appOverlay,
  ambientActivityLabel,
  children,
  onSelectRailItem,
  sidebar,
  subtitle,
  workspaceOverlay,
  workerLabel,
  workerTone,
}: DesktopShellProperties) {
  return (
    <main className="h-screen overflow-hidden bg-[var(--color-shell-topbar)] text-[var(--color-copy-strong)]">
      <section className="relative flex h-screen w-full flex-col overflow-hidden bg-[var(--color-shell-canvas)]">
        <header className="flex h-[52px] items-center gap-[14px] bg-[var(--color-shell-topbar)] pl-[84px] pr-[18px] [-webkit-app-region:drag]">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-[var(--color-surface-3)]">CV Maxxing</p>
            <p className="m-0 text-[11px] font-medium text-[var(--color-copy-subtle)]">
              {subtitle}
            </p>
          </div>
          <div className="flex items-center gap-[10px]">
            {ambientActivityLabel ? (
              <AmbientActivityIndicator label={ambientActivityLabel} />
            ) : null}
            <StatusPill label={workerLabel} tone={workerTone} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-[var(--color-shell-canvas)]">
          <nav
            aria-label="Primary"
            className="flex w-16 flex-col items-center justify-between bg-[var(--color-shell-rail)] px-[10px] py-4"
          >
            <div className="flex flex-col items-center gap-[14px]">
              <RailButton
                icon="setup"
                isActive={activeRailItem === 'setup'}
                label="AI worker"
                onSelect={onSelectRailItem}
              />
              <RailButton
                icon="job_vacancies"
                isActive={activeRailItem === 'job_vacancies'}
                label="Job vacancies"
                onSelect={onSelectRailItem}
              />
              <RailButton
                icon="original_cv"
                isActive={activeRailItem === 'original_cv'}
                label="Original CV"
                onSelect={onSelectRailItem}
              />
            </div>
            <div className="flex flex-col items-center gap-[14px]">
              <RailButton
                icon="settings"
                isActive={activeRailItem === 'settings'}
                label="Settings"
                onSelect={onSelectRailItem}
              />
            </div>
          </nav>

          <div className="relative flex min-h-0 min-w-0 flex-1">
            <aside className="flex min-h-0 shrink-0">{sidebar}</aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-surface-0)] p-7">
              {children}
            </div>

            {workspaceOverlay ? (
              <div className="absolute inset-0 z-10">{workspaceOverlay}</div>
            ) : null}
          </div>
        </div>

        {appOverlay ? <div className="absolute inset-0 z-20">{appOverlay}</div> : null}
      </section>
    </main>
  )
}
