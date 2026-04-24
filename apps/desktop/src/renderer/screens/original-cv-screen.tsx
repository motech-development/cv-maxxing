import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react'

import type { OriginalCvDetail, OriginalCvSummary } from '../../shared/original-cv.js'
import type { RuntimeAlert } from '../runtime-alerts.js'
import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { OriginalCvPreviewCard } from '../ui/original-cv-preview-card.js'
import { PanelCard } from '../ui/panel-card.js'
import { RuntimeAlertBanner } from '../ui/runtime-alert.js'
import { SectionLabel } from '../ui/section-label.js'

type OriginalCvScreenMode = 'detail' | 'replace'

interface OriginalCvScreenProperties {
  activeOriginalCvDetail?: OriginalCvDetail | null
  activeOriginalCv: OriginalCvSummary | null
  activeView?: OriginalCvScreenMode
  ambientActivityLabel?: string | null
  isImportingOriginalCv: boolean
  onDetailPreviewErrorChange?: (message: string | null) => void
  onFileDrop: (event: DragEvent<HTMLElement>) => void
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onImportOriginalCv: () => void
  onSelectOriginalCv?: () => void
  onSelectRailItem?: (item: RailItemId) => void
  onStartAddCv?: () => void
  originalCvFile: File | null
  runtimeAlert: RuntimeAlert | null
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
  activeView = 'detail',
  ambientActivityLabel,
  isImportingOriginalCv,
  onDetailPreviewErrorChange,
  onFileDrop,
  onFileSelection,
  onImportOriginalCv,
  onSelectOriginalCv,
  onSelectRailItem,
  onStartAddCv,
  originalCvFile,
  runtimeAlert,
  workspaceOverlay,
}: OriginalCvScreenProperties) {
  const handleSidebarAction = (): void => {
    if (isImportingOriginalCv) {
      return
    }

    if (activeOriginalCv !== null && activeView === 'detail') {
      onStartAddCv?.()

      return
    }

    if (originalCvFile === null) {
      document.querySelector<HTMLInputElement>(`#${originalCvFileInputId}`)?.click()

      return
    }

    onImportOriginalCv()
  }

  let content: ReactNode
  let pageIntro: string | undefined
  let pageTitle: string

  if (activeOriginalCv === null) {
    pageTitle = 'Add a CV'
    pageIntro = "Choose the PDF or DOCX copy of your CV you'd like to tailor for jobs."
    content = <OriginalCvEmptyState onFileDrop={onFileDrop} originalCvFile={originalCvFile} />
  } else if (activeView === 'replace') {
    pageTitle = 'Add a CV'
    pageIntro =
      "Choose the PDF or DOCX copy of your CV you'd like to use from now on. Your saved jobs won't change."
    content = <OriginalCvReplaceState onFileDrop={onFileDrop} originalCvFile={originalCvFile} />
  } else {
    pageTitle = 'Your CV'
    pageIntro = "Add a CV to use a different one for future jobs. Your saved jobs won't change."
    content = (
      <OriginalCvActiveState
        onPreviewErrorChange={onDetailPreviewErrorChange}
        originalCv={activeOriginalCv}
        originalCvDetail={activeOriginalCvDetail}
      />
    )
  }

  return (
    <DesktopShell
      activeRailItem="original_cv"
      ambientActivityLabel={ambientActivityLabel}
      onSelectRailItem={onSelectRailItem}
      pageAlert={runtimeAlert ? <RuntimeAlertBanner alert={runtimeAlert} /> : undefined}
      pageIntro={pageIntro}
      pageTitle={pageTitle}
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
                No CV yet
              </h2>
              <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
                Add a CV to tailor it for future jobs.
              </p>
            </>
          ) : (
            <OriginalCvSidebarItem
              isSelected={activeView === 'detail'}
              onSelect={onSelectOriginalCv}
              originalCv={activeOriginalCv}
            />
          )}
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
      {content}
    </DesktopShell>
  )
}

function OriginalCvEmptyState({
  onFileDrop,
  originalCvFile,
}: {
  onFileDrop: (event: DragEvent<HTMLElement>) => void
  originalCvFile: File | null
}) {
  return (
    <>
      <OriginalCvImportDropzone
        className="min-h-[360px]"
        copy="We'll use this CV when you tailor it for a job."
        onFileDrop={onFileDrop}
        originalCvFile={originalCvFile}
        title="Drop a PDF or DOCX here or choose a file"
      />
    </>
  )
}

function OriginalCvReplaceState({
  onFileDrop,
  originalCvFile,
}: {
  onFileDrop: (event: DragEvent<HTMLElement>) => void
  originalCvFile: File | null
}) {
  return (
    <>
      <PanelCard className="w-full border border-[var(--color-border)] bg-[var(--color-surface-1)] p-[18px]">
        <div className="flex flex-col gap-[10px]">
          <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
            Replacing your CV changes the one you'll use for new jobs.
          </p>
          <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
            Your saved jobs keep the CV and cover letter you've already made.
          </p>
        </div>
      </PanelCard>

      <OriginalCvImportDropzone
        className="mt-5 min-h-[320px] flex-1"
        copy="We'll use this CV for new jobs. Your saved jobs stay the same."
        onFileDrop={onFileDrop}
        originalCvFile={originalCvFile}
        title="Drop a PDF or DOCX here or choose a file"
      />
    </>
  )
}

function OriginalCvImportDropzone({
  className,
  copy,
  onFileDrop,
  originalCvFile,
  title,
}: {
  className?: string
  copy: string
  onFileDrop: (event: DragEvent<HTMLElement>) => void
  originalCvFile: File | null
  title: string
}) {
  return (
    <label className="block cursor-pointer" htmlFor={originalCvFileInputId}>
      <div
        className={`flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] px-7 py-10 text-center ${className ?? ''}`}
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
        <span className="text-lg font-extrabold text-[var(--color-copy-strong)]">{title}</span>
        <span className="mt-2 max-w-[360px] text-sm leading-6 text-[var(--color-copy-muted)]">
          {copy}
        </span>
        {originalCvFile ? (
          <span className="mt-3 text-sm font-bold text-[var(--color-copy-strong)]">
            Selected: {originalCvFile.name}
          </span>
        ) : null}
      </div>
    </label>
  )
}

function OriginalCvActiveState({
  onPreviewErrorChange,
  originalCv,
  originalCvDetail,
}: {
  onPreviewErrorChange?: (message: string | null) => void
  originalCv: OriginalCvSummary
  originalCvDetail: OriginalCvDetail | null | undefined
}) {
  const previewEmptyStateCopy = 'Your CV preview will appear here.'

  return (
    <>
      {originalCvDetail === null || originalCvDetail === undefined ? (
        <PanelCard className="w-full p-6">
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
        <div className="flex min-h-0 min-w-0 flex-1 gap-4">
          <div className="flex min-h-0 min-w-0 flex-[1.7] flex-col gap-3">
            <OriginalCvPreviewCard
              emptyStateCopy={previewEmptyStateCopy}
              onPreviewErrorChange={onPreviewErrorChange}
              preview={originalCvDetail.preview}
              previewKey={originalCvDetail.originalCv.id}
              title="Your CV"
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
  isSelected,
  onSelect,
  originalCv,
}: {
  isSelected: boolean
  onSelect?: () => void
  originalCv: OriginalCvSummary
}) {
  return (
    <PanelCard className={`${isSelected ? 'bg-[var(--color-surface-3)]' : 'bg-white'} p-3`}>
      <button
        aria-current={isSelected ? 'page' : undefined}
        aria-label="Open your CV"
        className={`w-full rounded-[8px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ink-900)] focus-visible:ring-offset-2 ${isSelected ? 'focus-visible:ring-offset-[var(--color-surface-3)]' : 'focus-visible:ring-offset-white'}`}
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
