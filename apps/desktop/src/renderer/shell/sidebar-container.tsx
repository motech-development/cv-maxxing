import type { ReactNode } from 'react'

interface SidebarContainerProperties {
  children: ReactNode
}

export function SidebarContainer({ children }: SidebarContainerProperties) {
  return (
    <div className="flex min-h-0 w-[328px] flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-shell-sidebar)]">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">{children}</div>
    </div>
  )
}
