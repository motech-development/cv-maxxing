import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react'

import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
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
      <SectionLabel>Your CV</SectionLabel>
      <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
        Get started
      </h2>
      <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
        This is the CV you'll tailor for each job. If you replace it later, your saved jobs stay the
        same.
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
      railItems={['job_vacancies', 'original_cv', 'settings']}
      sidebar={
        <SidebarContainer>
          <FirstLaunchSidebar />
        </SidebarContainer>
      }
      workspaceOverlay={workspaceOverlay}
    >
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Add your CV
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
        Choose the PDF or DOCX copy of your CV you'd like to tailor for jobs.
      </p>

      <input
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="Your CV file"
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
            Drop a PDF or DOCX here or choose a file
          </span>
          <span className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
            We'll use this CV when you tailor it for a job.
          </span>
          {originalCvFile ? (
            <span className="mt-3 text-sm font-bold text-[var(--color-copy-strong)]">
              Selected: {originalCvFile.name}
            </span>
          ) : null}
        </div>
      </label>

      {importError ? (
        <p className="mt-4 text-sm leading-6 text-[var(--color-status-danger)]">{importError}</p>
      ) : null}

      <div className="mt-6">
        <Button
          disabled={originalCvFile === null || isImportingOriginalCv}
          onClick={onImportOriginalCv}
          tone="primary"
        >
          {isImportingOriginalCv ? 'Adding your CV...' : 'Add your CV'}
        </Button>
      </div>
    </DesktopShell>
  )
}
