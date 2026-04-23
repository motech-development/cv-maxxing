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
  pageAlert?: ReactNode
  pageHeaderActions?: ReactNode
  pageIntro?: string
  pageTitle?: string
  railItems?: RailItemId[]
  sidebar: ReactNode
  statusPill?: {
    label: string
    tone: 'danger' | 'muted' | 'ready' | 'warning'
  }
  subtitle?: string
  workspaceOverlay?: ReactNode
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
  const stateClasses = isActive
    ? 'bg-[var(--color-rail-active)] text-[var(--color-surface-0)]'
    : 'bg-transparent text-[var(--color-copy-subtle)]'

  return (
    <button
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className={`flex h-[60px] w-[60px] flex-col items-center justify-center gap-1.5 rounded-[10px] px-1.5 text-[10px] font-bold leading-none ${stateClasses}`}
      onClick={() => {
        onSelect?.(icon)
      }}
      title={label}
      type="button"
    >
      <RailIcon icon={icon} isActive={isActive} />
      <span>{label}</span>
    </button>
  )
}

function getRailLabel(icon: RailItemId): string {
  if (icon === 'setup') {
    return 'AI'
  }

  if (icon === 'job_vacancies') {
    return 'Jobs'
  }

  if (icon === 'original_cv') {
    return 'Your CV'
  }

  return 'Settings'
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
  pageAlert,
  pageHeaderActions,
  pageIntro,
  pageTitle,
  railItems = ['setup', 'job_vacancies', 'original_cv', 'settings'],
  sidebar,
  statusPill,
  subtitle,
  workspaceOverlay,
}: DesktopShellProperties) {
  const hasPageHeaderContent =
    pageHeaderActions !== undefined || pageIntro !== undefined || pageTitle !== undefined
  const hasPageHeader = pageAlert !== undefined || hasPageHeaderContent
  let pageAlertSlot: ReactNode = null

  if (pageAlert) {
    pageAlertSlot = hasPageHeaderContent ? <div className="mt-4">{pageAlert}</div> : pageAlert
  }

  const leadingRailItems = railItems.filter((item) => {
    return item !== 'settings'
  })
  const trailingRailItems = railItems.filter((item) => {
    return item === 'settings'
  })

  return (
    <main className="h-screen overflow-hidden bg-[var(--color-shell-topbar)] text-[var(--color-copy-strong)]">
      <section className="relative flex h-screen w-full flex-col overflow-hidden bg-[var(--color-shell-canvas)]">
        <header className="flex h-[52px] items-center gap-[14px] bg-[var(--color-shell-topbar)] pl-[100px] pr-[18px] [-webkit-app-region:drag]">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-[var(--color-surface-3)]">CV Maxxing</p>
            {subtitle ? (
              <p className="m-0 text-[11px] font-medium text-[var(--color-copy-subtle)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          {ambientActivityLabel || statusPill ? (
            <div className="flex items-center gap-[10px]">
              {ambientActivityLabel ? (
                <AmbientActivityIndicator label={ambientActivityLabel} />
              ) : null}
              {statusPill ? <StatusPill label={statusPill.label} tone={statusPill.tone} /> : null}
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 bg-[var(--color-shell-canvas)]">
          <nav
            aria-label="Primary"
            className="flex w-20 flex-col items-center justify-between bg-[var(--color-shell-rail)] px-[10px] py-4"
          >
            <div className="flex flex-col items-center gap-3">
              {leadingRailItems.map((item) => {
                return (
                  <RailButton
                    icon={item}
                    isActive={activeRailItem === item}
                    key={item}
                    label={getRailLabel(item)}
                    onSelect={onSelectRailItem}
                  />
                )
              })}
            </div>
            <div className="flex flex-col items-center gap-3">
              {trailingRailItems.map((item) => {
                return (
                  <RailButton
                    icon={item}
                    isActive={activeRailItem === item}
                    key={item}
                    label={getRailLabel(item)}
                    onSelect={onSelectRailItem}
                  />
                )
              })}
            </div>
          </nav>

          <div className="relative flex min-h-0 min-w-0 flex-1">
            <aside className="flex min-h-0 shrink-0">{sidebar}</aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-surface-0)] p-7">
              {hasPageHeader ? (
                <>
                  {hasPageHeaderContent ? (
                    <div className="flex items-start justify-between gap-6">
                      <div className="min-w-0 flex-1">
                        {pageTitle ? (
                          <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
                            {pageTitle}
                          </h1>
                        ) : null}
                        {pageIntro ? (
                          <p className="mt-2 max-w-3xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
                            {pageIntro}
                          </p>
                        ) : null}
                      </div>
                      {pageHeaderActions ? (
                        <div className="shrink-0">{pageHeaderActions}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {pageAlertSlot}
                </>
              ) : null}
              <div className={hasPageHeader ? 'mt-6' : undefined}>{children}</div>
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
