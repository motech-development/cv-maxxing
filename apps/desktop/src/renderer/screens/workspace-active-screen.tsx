import type { ChangeEvent } from 'react'

import type { OriginalCvSummary } from '../../shared/original-cv.js'
import type {
  TailoredApplicationListItem,
  TailoredApplicationPreview,
} from '../../shared/tailored-application.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { Button } from '../ui/button.js'
import { OriginalCvReplacementCard } from '../ui/original-cv-replacement-card.js'
import { PanelCard } from '../ui/panel-card.js'
import { PdfPreviewCard } from '../ui/pdf-preview-card.js'
import { SectionLabel } from '../ui/section-label.js'

type PreviewDocumentKind = 'adapted_cv' | 'cover_letter'

interface WorkspaceActiveScreenProperties {
  activeOriginalCv: OriginalCvSummary | null
  applicationTitle: string | null
  applications: TailoredApplicationListItem[]
  importError: string | null
  isCopyingCoverLetterText: boolean
  isExportingPdf: boolean
  isImportingOriginalCv: boolean
  onCopyCoverLetterText: () => void
  onExportPdf: () => void
  onOriginalCvFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onReplaceOriginalCv: () => void
  onSelectPreviewDocument: (kind: PreviewDocumentKind) => void
  preview: TailoredApplicationPreview | null
  previewDocumentKind: PreviewDocumentKind
  originalCvFile: File | null
}

export function WorkspaceActiveScreen({
  activeOriginalCv,
  applicationTitle,
  applications,
  importError,
  isCopyingCoverLetterText,
  isExportingPdf,
  isImportingOriginalCv,
  onCopyCoverLetterText,
  onExportPdf,
  onOriginalCvFileSelection,
  onReplaceOriginalCv,
  onSelectPreviewDocument,
  preview,
  previewDocumentKind,
  originalCvFile,
}: WorkspaceActiveScreenProperties) {
  const resolvedApplicationTitle = preview?.title ?? applicationTitle ?? 'Tailored application'
  const resolvedVacancySubtitle =
    preview?.vacancyTitle ?? preview?.employer ?? resolvedApplicationTitle
  let activeDocumentPreview = null

  if (preview !== null) {
    activeDocumentPreview =
      previewDocumentKind === 'adapted_cv' ? preview.adaptedCv : preview.coverLetter
  }
  const documentTitle = previewDocumentKind === 'adapted_cv' ? 'Adapted CV' : 'Cover letter'
  const documentEmptyStateCopy =
    previewDocumentKind === 'adapted_cv'
      ? 'Generate an adapted CV to preview the PDF artifact here.'
      : 'Generate a cover letter to preview the PDF artifact here.'
  const previewStatusTags =
    preview === null
      ? []
      : [
          `Adapted CV · ${String(preview.adaptedCv.pageCount)} page${preview.adaptedCv.pageCount === 1 ? '' : 's'}`,
          `Cover letter · ${String(preview.coverLetter.pageCount)} page${preview.coverLetter.pageCount === 1 ? '' : 's'}`,
        ]

  return (
    <DesktopShell
      activeRailItem="job_vacancies"
      sidebar={
        <>
          <SectionLabel>Job vacancies</SectionLabel>
          <Button tone="primary">New vacancy</Button>
          <div className="flex flex-col gap-[10px]">
            {applications.map((application, index) => {
              const isActiveApplication =
                preview === null ? index === 0 : preview.id === application.id

              return (
                <PanelCard
                  className={`${isActiveApplication ? 'bg-[var(--color-surface-3)]' : 'bg-white'} p-3`}
                  key={application.id}
                >
                  <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
                    {application.vacancyTitle ?? application.title}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">
                    {application.employer ? `${application.employer} · ` : ''}immutable PDF outputs
                  </p>
                </PanelCard>
              )
            })}
            {activeOriginalCv ? (
              <OriginalCvReplacementCard
                activeOriginalCv={activeOriginalCv}
                importError={importError}
                inputId="workspace-active-original-cv-file-input"
                isImportingOriginalCv={isImportingOriginalCv}
                onFileSelection={onOriginalCvFileSelection}
                onImportOriginalCv={onReplaceOriginalCv}
                originalCvFile={originalCvFile}
              />
            ) : null}
          </div>
          <div className="flex-1" />
        </>
      }
      subtitle="Workspace"
      workerLabel="Ready"
      workerTone="ready"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]">
            {resolvedApplicationTitle}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-copy-muted)]">
            Adapted CV and cover letter generated from the active original CV snapshot.
          </p>
        </div>
        <Button disabled={preview === null || isExportingPdf} onClick={onExportPdf} tone="primary">
          Export PDFs
        </Button>
      </div>

      <div className="mt-4 flex gap-4">
        <PanelCard className="flex min-h-[620px] flex-1 flex-col gap-3 p-[18px]">
          <div className="flex gap-2">
            <button
              className={`rounded-[8px] px-3 py-2 text-[12px] font-extrabold ${
                previewDocumentKind === 'adapted_cv'
                  ? 'bg-[var(--color-ink-900)] text-white'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-copy-strong)]'
              }`}
              onClick={() => {
                onSelectPreviewDocument('adapted_cv')
              }}
              type="button"
            >
              Adapted CV
            </button>
            <button
              className={`rounded-[8px] px-3 py-2 text-[12px] font-extrabold ${
                previewDocumentKind === 'cover_letter'
                  ? 'bg-[var(--color-ink-900)] text-white'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-copy-strong)]'
              }`}
              onClick={() => {
                onSelectPreviewDocument('cover_letter')
              }}
              type="button"
            >
              Cover letter
            </button>
          </div>
          <PdfPreviewCard
            emptyStateCopy={documentEmptyStateCopy}
            preview={activeDocumentPreview}
            previewKey={
              preview === null ? previewDocumentKind : `${preview.id}:${previewDocumentKind}`
            }
            title={documentTitle}
          />
        </PanelCard>

        <PanelCard className="flex w-[300px] flex-col gap-3 p-[18px]">
          <h2 className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
            Vacancy details
          </h2>
          <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
            {resolvedVacancySubtitle}
          </p>
          <div className="h-px bg-[var(--color-border)]" />
          <div className="flex flex-col gap-2">
            {previewStatusTags.map((tag) => {
              return (
                <div
                  className="rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2 text-xs font-extrabold text-[var(--color-copy-strong)]"
                  key={tag}
                >
                  {tag}
                </div>
              )
            })}
          </div>
          <Button
            disabled={preview === null || isCopyingCoverLetterText}
            onClick={onCopyCoverLetterText}
            tone="primary"
          >
            Copy cover letter text
          </Button>
        </PanelCard>
      </div>
    </DesktopShell>
  )
}
