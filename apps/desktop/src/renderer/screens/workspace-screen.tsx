import type { ChangeEvent, ReactNode } from 'react'

import type { OriginalCvSummary } from '../../shared/original-cv.js'
import type {
  TailoredApplicationListItem,
  TailoredApplicationPreview,
} from '../../shared/tailored-application.js'
import type { VacancySummary } from '../../shared/vacancy.js'
import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js'
import { SidebarContainer } from '../shell/sidebar-container.js'
import { Button } from '../ui/button.js'
import { OriginalCvReplacementCard } from '../ui/original-cv-replacement-card.js'
import { PanelCard } from '../ui/panel-card.js'
import { SectionLabel } from '../ui/section-label.js'
import { WorkspaceApplicationView } from './workspace-active-screen.js'
import { WorkspaceDraftView } from './workspace-empty-screen.js'

type PreviewDocumentKind = 'adapted_cv' | 'cover_letter'
type WorkspaceSelectionKind = 'draft' | 'tailored_application'

interface WorkspaceScreenProperties {
  activeOriginalCv: OriginalCvSummary | null
  ambientActivityLabel?: string | null
  applicationTitle: string | null
  applications: TailoredApplicationListItem[]
  importError: string | null
  isAdaptingCv: boolean
  isConfirmingDeleteTailoredApplication: boolean
  isCopyingCoverLetterText: boolean
  isCurrentDraftMeaningful: boolean
  isExportingPdf: boolean
  isImportingOriginalCv: boolean
  isOpeningVacancyBrowser: boolean
  isReviewingVacancy: boolean
  onAdaptCv: () => void
  onCopyCoverLetterText: () => void
  onCreateVacancy: () => void
  onDeleteTailoredApplication: () => void
  onExportPdf: () => void
  onOpenVacancyBrowserSession: () => void
  onOriginalCvFileSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onReplaceOriginalCv: () => void
  onReviewPastedVacancy: () => void
  onReviewVacancyUrl: () => void
  onSelectApplication: (tailoredApplicationId: string) => void
  onSelectDraft: () => void
  onSelectPreviewDocument: (kind: PreviewDocumentKind) => void
  onSelectRailItem?: (item: RailItemId) => void
  onTextDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onUrlDraftChange: (event: ChangeEvent<HTMLInputElement>) => void
  originalCvFile: File | null
  preview: TailoredApplicationPreview | null
  previewDocumentKind: PreviewDocumentKind
  selectedTailoredApplicationId: string | null
  selectedWorkspaceItem: WorkspaceSelectionKind
  textDraft: string
  urlDraft: string
  vacancyPreview: VacancySummary | null
  vacancyReviewError: string | null
  workspaceError: string | null
  workspaceOverlay?: ReactNode
}

export function WorkspaceScreen({
  activeOriginalCv,
  ambientActivityLabel,
  applicationTitle,
  applications,
  importError,
  isAdaptingCv,
  isConfirmingDeleteTailoredApplication,
  isCopyingCoverLetterText,
  isCurrentDraftMeaningful,
  isExportingPdf,
  isImportingOriginalCv,
  isOpeningVacancyBrowser,
  isReviewingVacancy,
  onAdaptCv,
  onCopyCoverLetterText,
  onCreateVacancy,
  onDeleteTailoredApplication,
  onExportPdf,
  onOpenVacancyBrowserSession,
  onOriginalCvFileSelection,
  onReplaceOriginalCv,
  onReviewPastedVacancy,
  onReviewVacancyUrl,
  onSelectApplication,
  onSelectDraft,
  onSelectPreviewDocument,
  onSelectRailItem,
  onTextDraftChange,
  onUrlDraftChange,
  originalCvFile,
  preview,
  previewDocumentKind,
  selectedTailoredApplicationId,
  selectedWorkspaceItem,
  textDraft,
  urlDraft,
  vacancyPreview,
  vacancyReviewError,
  workspaceError,
  workspaceOverlay,
}: WorkspaceScreenProperties) {
  const hasVacancyItems = isCurrentDraftMeaningful || applications.length > 0

  return (
    <DesktopShell
      activeRailItem="job_vacancies"
      ambientActivityLabel={ambientActivityLabel}
      onSelectRailItem={onSelectRailItem}
      sidebar={
        <SidebarContainer>
          <SectionLabel>Job vacancies</SectionLabel>
          {hasVacancyItems ? null : (
            <>
              <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
                No vacancy items yet
              </h2>
              <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
                Start with a job vacancy URL or paste vacancy text. Current vacancy draft appears
                here once the draft feels meaningful. Saved tailored applications stay below it.
              </p>
            </>
          )}
          <Button onClick={onCreateVacancy} tone="primary">
            New vacancy
          </Button>
          {isCurrentDraftMeaningful ? (
            <WorkspaceSidebarItem
              description={resolveDraftDescription(vacancyPreview)}
              isSelected={selectedWorkspaceItem === 'draft'}
              label="Current vacancy draft"
              onClick={onSelectDraft}
            />
          ) : null}
          {applications.map((application) => {
            const isSelected =
              selectedWorkspaceItem === 'tailored_application' &&
              selectedTailoredApplicationId === application.id

            return (
              <WorkspaceSidebarItem
                description={`${application.employer ? `${application.employer} · ` : ''}immutable PDF outputs`}
                isSelected={isSelected}
                key={application.id}
                label={application.vacancyTitle ?? application.title}
                onClick={() => {
                  onSelectApplication(application.id)
                }}
              />
            )
          })}
          <div className="flex-1" />
          {activeOriginalCv ? (
            <OriginalCvReplacementCard
              activeOriginalCv={activeOriginalCv}
              importError={importError}
              inputId="workspace-original-cv-file-input"
              isImportingOriginalCv={isImportingOriginalCv}
              onFileSelection={onOriginalCvFileSelection}
              onImportOriginalCv={onReplaceOriginalCv}
              originalCvFile={originalCvFile}
            />
          ) : null}
        </SidebarContainer>
      }
      subtitle="Workspace"
      workspaceOverlay={workspaceOverlay}
      workerLabel="Ready"
      workerTone="ready"
    >
      {selectedWorkspaceItem === 'tailored_application' ? (
        <WorkspaceApplicationView
          applicationTitle={applicationTitle}
          isConfirmingDeleteTailoredApplication={isConfirmingDeleteTailoredApplication}
          isCopyingCoverLetterText={isCopyingCoverLetterText}
          isExportingPdf={isExportingPdf}
          onCopyCoverLetterText={onCopyCoverLetterText}
          onDeleteTailoredApplication={onDeleteTailoredApplication}
          onExportPdf={onExportPdf}
          onSelectPreviewDocument={onSelectPreviewDocument}
          preview={preview}
          previewDocumentKind={previewDocumentKind}
          workspaceError={workspaceError}
        />
      ) : (
        <WorkspaceDraftView
          isAdaptingCv={isAdaptingCv}
          isCurrentDraftMeaningful={isCurrentDraftMeaningful}
          isOpeningVacancyBrowser={isOpeningVacancyBrowser}
          isReviewingVacancy={isReviewingVacancy}
          onAdaptCv={onAdaptCv}
          onOpenVacancyBrowserSession={onOpenVacancyBrowserSession}
          onReviewPastedVacancy={onReviewPastedVacancy}
          onReviewVacancyUrl={onReviewVacancyUrl}
          onTextDraftChange={onTextDraftChange}
          onUrlDraftChange={onUrlDraftChange}
          textDraft={textDraft}
          urlDraft={urlDraft}
          vacancyPreview={vacancyPreview}
          vacancyReviewError={vacancyReviewError}
          workspaceError={workspaceError}
        />
      )}
    </DesktopShell>
  )
}

function WorkspaceSidebarItem({
  description,
  isSelected,
  label,
  onClick,
}: {
  description: string
  isSelected: boolean
  label: string
  onClick: () => void
}) {
  return (
    <PanelCard className={`${isSelected ? 'bg-[var(--color-surface-3)]' : 'bg-white'} p-3`}>
      <button
        aria-current={isSelected ? 'page' : undefined}
        aria-label={`Open ${label.toLowerCase()}`}
        className="w-full text-left"
        onClick={onClick}
        type="button"
      >
        <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">{label}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-copy-muted)]">{description}</p>
      </button>
    </PanelCard>
  )
}

function resolveDraftDescription(vacancyPreview: VacancySummary | null): string {
  if (vacancyPreview?.canGenerate === true) {
    return 'Ready to adapt'
  }

  return 'Draft in progress'
}
