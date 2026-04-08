import { DesktopShell } from '../shell/desktop-shell.js'

export function WorkspaceLoadingScreen() {
  return (
    <DesktopShell
      activeRailItem="job_vacancies"
      sidebar={<div className="flex-1" />}
      subtitle="Workspace"
      workerLabel="Generating"
      workerTone="warning"
    >
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Generating tailored application
      </h1>
    </DesktopShell>
  )
}
