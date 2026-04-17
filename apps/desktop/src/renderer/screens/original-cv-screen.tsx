import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react'

import type { OriginalCvSummary } from '../../shared/original-cv.js'
import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface OriginalCvScreenProperties {
  activeOriginalCv: OriginalCvSummary | null
  ambientActivityLabel?: string | null
  importError: string | null
  isImportingOriginalCv: boolean
  onFileDrop: (event: DragEvent<HTMLElement>) => void
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onImportOriginalCv: () => void
  onSelectRailItem?: (item: RailItemId) => void
  originalCvFile: File | null
  workspaceOverlay?: ReactNode
}

const originalCvFileInputId = 'original-cv-file-input'

function handleDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }

  event.preventDefault()
  document.querySelector<HTMLInputElement>(`#${originalCvFileInputId}`)?.click()
}

export function OriginalCvScreen({
  activeOriginalCv,
  ambientActivityLabel,
  importError,
  isImportingOriginalCv,
  onFileDrop,
  onFileSelection,
  onImportOriginalCv,
  onSelectRailItem,
  originalCvFile,
  workspaceOverlay,
}: OriginalCvScreenProperties) {
  const handleSidebarAction = (): void => {
    if (isImportingOriginalCv) {
      return
    }

    if (originalCvFile === null) {
      document.querySelector<HTMLInputElement>(`#${originalCvFileInputId}`)?.click()

      return
    }

    onImportOriginalCv()
  }

  return (
    <DesktopShell
      activeRailItem="original_cv"
      ambientActivityLabel={ambientActivityLabel}
      onSelectRailItem={onSelectRailItem}
      railItems={['job_vacancies', 'original_cv', 'settings']}
      sidebar={
        <SidebarContainer>
          <SectionLabel>Your CV</SectionLabel>
          <Button disabled={isImportingOriginalCv} onClick={handleSidebarAction} tone="primary">
            {isImportingOriginalCv ? 'Adding a CV...' : 'Add a CV'}
          </Button>
          {originalCvFile ? (
            <p className="m-0 text-xs leading-5 text-[var(--color-copy-strong)]">
              Selected: {originalCvFile.name}
            </p>
          ) : null}
          {activeOriginalCv === null ? (
            <>
              <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
                No original CV yet
              </h2>
              <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
                Add a CV to create the original CV snapshot used for future tailored applications.
              </p>
            </>
          ) : (
            <OriginalCvSidebarItem originalCv={activeOriginalCv} />
          )}
          {importError ? (
            <p className="m-0 text-xs leading-5 text-[var(--color-status-danger)]">{importError}</p>
          ) : null}
          <div className="flex-1" />
        </SidebarContainer>
      }
      workspaceOverlay={workspaceOverlay}
    >
      <input
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="Your CV file"
        className="sr-only"
        id={originalCvFileInputId}
        onChange={onFileSelection}
        type="file"
      />
      {activeOriginalCv === null ? (
        <OriginalCvEmptyState
          importError={importError}
          onFileDrop={onFileDrop}
          originalCvFile={originalCvFile}
        />
      ) : (
        <OriginalCvActiveState originalCv={activeOriginalCv} />
      )}
    </DesktopShell>
  )
}

function OriginalCvEmptyState({
  importError,
  onFileDrop,
  originalCvFile,
}: {
  importError: string | null
  onFileDrop: (event: DragEvent<HTMLElement>) => void
  originalCvFile: File | null
}) {
  return (
    <>
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Add a CV
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
        Choose the PDF or DOCX version of your CV that future tailored applications should start
        from.
      </p>

      <label className="mt-6 block cursor-pointer" htmlFor={originalCvFileInputId}>
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
            We&apos;ll use this as the original CV for future tailored applications.
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
    </>
  )
}

function OriginalCvActiveState({ originalCv }: { originalCv: OriginalCvSummary }) {
  return (
    <>
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Active original CV
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
        Add a CV to create a new snapshot. Existing tailored applications keep the snapshot they
        were generated from.
      </p>

      <PanelCard className="mt-6 max-w-3xl p-6">
        <div className="flex flex-col gap-5">
          <OriginalCvMetadataRow label="Original filename" value={originalCv.originalFilename} />
          <OriginalCvMetadataRow label="Headline" value={originalCv.headline} />
          <OriginalCvMetadataRow
            label="Imported"
            value={`${formatTimestamp(originalCv.importedAt)} · ${formatPageCount(originalCv.pageCount)}`}
          />
          <OriginalCvMetadataRow label="Summary" value={originalCv.summary} />
        </div>
      </PanelCard>
    </>
  )
}

function OriginalCvMetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-subtle)]">
        {label}
      </p>
      <p className="m-0 text-sm leading-6 text-[var(--color-copy-strong)]">{value}</p>
    </div>
  )
}

function OriginalCvSidebarItem({ originalCv }: { originalCv: OriginalCvSummary }) {
  return (
    <PanelCard className="bg-[var(--color-surface-3)] p-3">
      <div aria-current="page" aria-label="Open active original CV" className="w-full text-left">
        <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
          {originalCv.headline}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">
          Imported {formatTimestamp(originalCv.importedAt)} ·{' '}
          {formatPageCount(originalCv.pageCount)}
        </p>
      </div>
    </PanelCard>
  )
}

function formatPageCount(pageCount: number): string {
  return `${String(pageCount)} page${pageCount === 1 ? '' : 's'}`
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}
