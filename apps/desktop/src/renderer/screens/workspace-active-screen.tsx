import type { ChangeEvent } from 'react'

import type { OriginalCvSummary } from '../../shared/original-cv.js'
import type {
  TailoredApplicationListItem,
  TailoredApplicationPreview,
} from '../../shared/tailored-application.js'
import { Button } from '../ui/button.js'
import { DesktopShell } from '../shell/desktop-shell.js'
import { OriginalCvReplacementCard } from '../ui/original-cv-replacement-card.js'
import { PanelCard } from '../ui/panel-card.js'
import { PdfPreviewCard } from '../ui/pdf-preview-card.js'
import { SectionLabel } from '../ui/section-label.js'

interface WorkspaceActiveScreenProperties {
  activeOriginalCv: OriginalCvSummary | null
  applicationTitle: string | null
  applications: TailoredApplicationListItem[]
  isExportingAdaptedCv: boolean
  importError: string | null
  isImportingOriginalCv: boolean
  onExportAdaptedCvPdf: () => void
  onOriginalCvFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onReplaceOriginalCv: () => void
  preview: TailoredApplicationPreview | null
  originalCvFile: File | null
}

export function WorkspaceActiveScreen({
  activeOriginalCv,
  applicationTitle,
  applications,
  isExportingAdaptedCv,
  importError,
  isImportingOriginalCv,
  onExportAdaptedCvPdf,
  onOriginalCvFileSelection,
  onReplaceOriginalCv,
  preview,
  originalCvFile,
}: WorkspaceActiveScreenProperties) {
  const resolvedApplicationTitle = preview?.title ?? applicationTitle ?? 'Tailored application'
  const resolvedVacancySubtitle =
    preview?.vacancyTitle ?? preview?.employer ?? resolvedApplicationTitle
  const pdfStatusCopy = preview
    ? `${String(preview.pageCount)} rendered page${preview.pageCount === 1 ? '' : 's'} stored as the encrypted preview artifact.`
    : 'The adapted CV PDF preview appears here after generation completes.'

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
                    {application.employer ? `${application.employer} · ` : ''}immutable PDF output
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
            Adapted CV PDF generated from the active original CV snapshot.
          </p>
        </div>
        <Button
          disabled={preview === null || isExportingAdaptedCv}
          onClick={onExportAdaptedCvPdf}
          tone="primary"
        >
          Export PDF
        </Button>
      </div>

      <div className="mt-4 flex gap-4">
        <PanelCard className="flex min-h-[620px] flex-1 flex-col gap-3 p-[18px]">
          <div className="inline-flex rounded-[8px] bg-[var(--color-ink-900)] px-3 py-2 text-[12px] font-extrabold text-white">
            Adapted CV
          </div>
          <PdfPreviewCard preview={preview} />
        </PanelCard>

        <PanelCard className="flex w-[300px] flex-col gap-3 p-[18px]">
          <h2 className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
            Vacancy details
          </h2>
          <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
            {resolvedVacancySubtitle}
          </p>
          <div className="h-px bg-[var(--color-border)]" />
          <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
            PDF status
          </p>
          <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">{pdfStatusCopy}</p>
          <Button disabled tone="secondary">
            Copy cover letter text
          </Button>
        </PanelCard>
      </div>
    </DesktopShell>
  )
}
