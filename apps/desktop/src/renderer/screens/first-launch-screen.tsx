import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react'

import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface FirstLaunchScreenProperties {
  importError: string | null
  isImportingOriginalCv: boolean
  onFileDrop: (event: DragEvent<HTMLElement>) => void
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onImportOriginalCv: () => void
  onSelectRailItem?: (item: RailItemId) => void
  originalCvFile: File | null
  workspaceOverlay?: ReactNode
}

function handleDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }

  event.preventDefault()
  document.querySelector<HTMLInputElement>('#original-cv-file-input')?.click()
}

function FirstLaunchSidebar() {
  return (
    <>
      <SectionLabel>Start</SectionLabel>
      <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
        Add your original CV
      </h2>
      <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
        One active original CV powers every tailored application. Replacing it later creates a new
        snapshot.
      </p>
      <div className="flex-1" />
    </>
  )
}

export function FirstLaunchScreen({
  importError,
  isImportingOriginalCv,
  onFileDrop,
  onFileSelection,
  onImportOriginalCv,
  onSelectRailItem,
  originalCvFile,
  workspaceOverlay,
}: FirstLaunchScreenProperties) {
  return (
    <DesktopShell
      activeRailItem="original_cv"
      onSelectRailItem={onSelectRailItem}
      sidebar={
        <SidebarContainer>
          <FirstLaunchSidebar />
        </SidebarContainer>
      }
      subtitle="First launch"
      workspaceOverlay={workspaceOverlay}
      workerLabel="Worker ready"
      workerTone="ready"
    >
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Import your original CV
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
        Choose the PDF or DOCX that should become the source for adapted CVs and cover letters.
      </p>

      <input
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="Original CV file"
        className="sr-only"
        id="original-cv-file-input"
        onChange={onFileSelection}
        type="file"
      />

      <label className="mt-6 block cursor-pointer" htmlFor="original-cv-file-input">
        <div
          className="flex min-h-[360px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] px-7 py-10 text-center"
          onDragOver={(event) => {
            event.preventDefault()
          }}
          onDrop={onFileDrop}
          onKeyDown={handleDropzoneKeyDown}
          role="button"
          tabIndex={0}
        >
          <span
            aria-hidden="true"
            className="mb-4 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--color-surface-success)] text-lg text-[var(--color-copy-strong)]"
          >
            ↑
          </span>
          <span className="text-lg font-extrabold text-[var(--color-copy-strong)]">
            Drop a PDF or DOCX here or browse
          </span>
          <span className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
            The imported CV becomes your active original CV snapshot.
          </span>
          {originalCvFile ? (
            <span className="mt-3 text-sm font-bold text-[var(--color-copy-strong)]">
              Selected: {originalCvFile.name}
            </span>
          ) : null}
        </div>
      </label>

      <PanelCard className="mt-4 bg-[var(--color-surface-3)] p-4">
        <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
          AI worker ready
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">
          Generation workflows can start after CV import.
        </p>
      </PanelCard>

      {importError ? (
        <p className="mt-4 text-sm leading-6 text-[var(--color-status-danger)]">{importError}</p>
      ) : null}

      <div className="mt-6">
        <Button
          disabled={originalCvFile === null || isImportingOriginalCv}
          onClick={onImportOriginalCv}
          tone="primary"
        >
          {isImportingOriginalCv ? 'Importing original CV...' : 'Import original CV'}
        </Button>
      </div>
    </DesktopShell>
  )
}
