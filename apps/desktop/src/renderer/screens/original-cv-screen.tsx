import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react'

import type { OriginalCvDetail, OriginalCvSummary } from '../../shared/original-cv.js'
import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { OriginalCvPreviewCard } from '../ui/original-cv-preview-card.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface OriginalCvScreenProperties {
  activeOriginalCvDetail?: OriginalCvDetail | null
  activeOriginalCv: OriginalCvSummary | null
  ambientActivityLabel?: string | null
  importError: string | null
  isImportingOriginalCv: boolean
  onFileDrop: (event: DragEvent<HTMLElement>) => void
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onImportOriginalCv: () => void
  onSelectOriginalCv?: () => void
  onSelectRailItem?: (item: RailItemId) => void
  originalCvFile: File | null
  workspaceError?: string | null
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
  activeOriginalCvDetail,
  activeOriginalCv,
  ambientActivityLabel,
  importError,
  isImportingOriginalCv,
  onFileDrop,
  onFileSelection,
  onImportOriginalCv,
  onSelectOriginalCv,
  onSelectRailItem,
  originalCvFile,
  workspaceError,
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
            <OriginalCvSidebarItem onSelect={onSelectOriginalCv} originalCv={activeOriginalCv} />
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
        <OriginalCvActiveState
          originalCv={activeOriginalCv}
          originalCvDetail={activeOriginalCvDetail}
          workspaceError={workspaceError ?? null}
        />
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

function OriginalCvActiveState({
  originalCv,
  originalCvDetail,
  workspaceError,
}: {
  originalCv: OriginalCvSummary
  originalCvDetail: OriginalCvDetail | null | undefined
  workspaceError: string | null
}) {
  const resolvedName =
    originalCvDetail?.profile.fullName.trim() === ''
      ? originalCv.headline
      : (originalCvDetail?.profile.fullName ?? originalCv.headline)
  const previewEmptyStateCopy = 'Your original CV preview will appear here.'

  return (
    <>
      <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
        Active original CV
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-copy-muted)]">
        Add a CV to create a new snapshot. Existing tailored applications keep the snapshot they
        were generated from.
      </p>
      {workspaceError ? (
        <div
          aria-atomic="true"
          aria-live="assertive"
          className="mt-4 max-w-4xl rounded-[var(--radius-card)] border border-[var(--color-status-danger)]/20 bg-[var(--color-surface-danger)] px-4 py-3 text-sm leading-6 text-[var(--color-status-danger)]"
          role="alert"
        >
          {workspaceError}
        </div>
      ) : null}
      {originalCvDetail === null || originalCvDetail === undefined ? (
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
      ) : (
        <div className="mt-4 flex min-h-0 min-w-0 flex-1 gap-4">
          <div className="flex min-h-0 min-w-0 flex-[1.7] flex-col gap-3">
            <p className="m-0 text-2xl font-extrabold uppercase tracking-[-0.02em] text-[var(--color-copy-strong)]">
              {resolvedName}
            </p>
            <OriginalCvPreviewCard
              emptyStateCopy={previewEmptyStateCopy}
              preview={originalCvDetail.preview}
              previewKey={originalCvDetail.originalCv.id}
              title="Original CV"
            />
          </div>

          <section className="flex h-full w-[320px] shrink-0 flex-col gap-4 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-[18px]">
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-lg font-extrabold text-[var(--color-copy-strong)]">
                Extracted profile
              </h2>
              <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
                The app stores structured CV content, original writing style, and PDF artifacts as
                encrypted local data.
              </p>
            </div>
            <ProfileSection title="Summary">
              <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
                {originalCvDetail.profile.summary}
              </p>
            </ProfileSection>
            <ProfileSection title="Contact">
              <ProfileField label="Email" value={originalCvDetail.profile.contact.email} />
              <ProfileField label="Location" value={originalCvDetail.profile.contact.location} />
              <ProfileField label="Phone" value={originalCvDetail.profile.contact.phone} />
              <ProfileField
                label="Link"
                value={originalCvDetail.profile.contact.professionalLink}
              />
            </ProfileSection>
            <ProfileSection title="Skills">
              <div className="flex flex-wrap gap-2">
                {originalCvDetail.profile.skills.map((skill, index) => {
                  return (
                    <span
                      className="rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2 text-xs font-extrabold text-[var(--color-copy-strong)]"
                      key={`${skill}-${String(index)}`}
                    >
                      {skill}
                    </span>
                  )
                })}
              </div>
            </ProfileSection>
            <ProfileSection title="Experience">
              <div className="flex flex-col gap-3">
                {originalCvDetail.profile.experience.map((entry, index) => {
                  return (
                    <div
                      className="rounded-[8px] bg-white p-3"
                      key={`${entry.roleTitle}-${entry.employer}-${String(index)}`}
                    >
                      <p className="m-0 text-xs font-extrabold text-[var(--color-copy-strong)]">
                        {entry.roleTitle}
                      </p>
                      <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
                        {entry.employer}
                        {entry.dateRange === '' ? '' : ` · ${entry.dateRange}`}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-[var(--color-copy-muted)]">
                        {entry.summary}
                      </p>
                    </div>
                  )
                })}
              </div>
            </ProfileSection>
          </section>
        </div>
      )}
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

function OriginalCvSidebarItem({
  onSelect,
  originalCv,
}: {
  onSelect?: () => void
  originalCv: OriginalCvSummary
}) {
  return (
    <PanelCard className="bg-[var(--color-surface-3)] p-3">
      <button
        aria-current="page"
        aria-label="Open active original CV"
        className="w-full rounded-[8px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ink-900)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-3)]"
        onClick={onSelect}
        type="button"
      >
        <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
          {originalCv.originalFilename}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">
          Imported {formatTimestamp(originalCv.importedAt)} ·{' '}
          {formatPageCount(originalCv.pageCount)}
        </p>
      </button>
    </PanelCard>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  if (value.trim() === '') {
    return null
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-subtle)]">
        {label}
      </p>
      <p className="m-0 text-xs leading-5 text-[var(--color-copy-strong)]">{value}</p>
    </div>
  )
}

function ProfileSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-subtle)]">
        {title}
      </h3>
      {children}
    </section>
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
