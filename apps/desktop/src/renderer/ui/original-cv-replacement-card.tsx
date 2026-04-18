import type { ChangeEvent } from 'react'

import type { OriginalCvSummary } from '../../shared/original-cv.js'
import { Button } from './button.js'
import { PanelCard } from './panel-card.js'

interface OriginalCvReplacementCardProperties {
  activeOriginalCv: OriginalCvSummary
  importError: string | null
  inputId: string
  isImportingOriginalCv: boolean
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onImportOriginalCv: () => void
  originalCvFile: File | null
}

export function OriginalCvReplacementCard({
  activeOriginalCv,
  importError,
  inputId,
  isImportingOriginalCv,
  onFileSelection,
  onImportOriginalCv,
  originalCvFile,
}: OriginalCvReplacementCardProperties) {
  const savedCvLabel =
    activeOriginalCv.snapshotCount === 1
      ? '1 CV saved'
      : `${String(activeOriginalCv.snapshotCount)} CVs saved`

  return (
    <PanelCard className="bg-[var(--color-surface-3)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">Your CV</p>
          <p className="mt-1 truncate text-xs leading-5 text-[var(--color-copy-muted)]">
            {activeOriginalCv.originalFilename}
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
          {savedCvLabel}
        </span>
      </div>

      <p className="mt-3 text-xs leading-5 text-[var(--color-copy-muted)]">
        Choose a different CV for new jobs. Your saved jobs won't change.
      </p>

      <input
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="Replacement CV file"
        className="sr-only"
        id={inputId}
        onChange={onFileSelection}
        type="file"
      />

      <label
        className="mt-3 inline-flex cursor-pointer items-center justify-center rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white px-[14px] py-[10px] text-[13px] font-extrabold text-[var(--color-copy-strong)] transition hover:bg-[var(--color-surface-1)]"
        htmlFor={inputId}
      >
        Choose a new PDF or DOCX
      </label>

      {originalCvFile ? (
        <p className="mt-3 text-xs leading-5 text-[var(--color-copy-strong)]">
          Selected: {originalCvFile.name}
        </p>
      ) : null}

      {importError ? (
        <p className="mt-3 text-xs leading-5 text-[var(--color-status-danger)]">{importError}</p>
      ) : null}

      <div className="mt-3">
        <Button
          disabled={originalCvFile === null || isImportingOriginalCv}
          onClick={onImportOriginalCv}
          tone="secondary"
        >
          {isImportingOriginalCv ? 'Updating your CV...' : 'Update your CV'}
        </Button>
      </div>
    </PanelCard>
  )
}
