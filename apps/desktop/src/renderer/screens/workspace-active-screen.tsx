import { DesktopShell } from '../shell/desktop-shell.js'

export function WorkspaceActiveScreen() {
  return (
    <DesktopShell
      activeRailItem="job_vacancies"
      sidebar={<div className="flex-1" />}
      subtitle="Workspace"
      workerLabel="Ready"
      workerTone="ready"
    >
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Tailored application
      </h1>
    </DesktopShell>
  )
}
