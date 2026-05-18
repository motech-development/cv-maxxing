import type { ChangeEvent, ReactNode } from 'react';
import type {
  TailoredApplicationListItem,
  TailoredApplicationPreview,
} from '../../shared/tailored-application.js';
import type { VacancyReviewState, VacancySummary } from '../../shared/vacancy.js';
import type { RuntimeAlert } from '../runtime-alerts.js';
import { DesktopShell, type RailItemId } from '../shell/desktop-shell.js';
import { SidebarContainer } from '../shell/sidebar-container.js';
import { Button } from '../ui/button.js';
import { PanelCard } from '../ui/panel-card.js';
import { RuntimeAlertBanner } from '../ui/runtime-alert.js';
import { SectionLabel } from '../ui/section-label.js';
import { WorkspaceApplicationView } from './workspace-active-screen.js';
import { WorkspaceDraftView } from './workspace-empty-screen.js';

type PreviewDocumentKind = 'adapted_cv' | 'cover_letter';
type WorkspaceSelectionKind = 'draft' | 'tailored_application';

interface WorkspaceScreenProperties {
  activeRailItem?: Extract<RailItemId, 'job_vacancies' | 'original_cv'>;
  ambientActivityLabel?: string | null;
  applicationTitle: string | null;
  applications: TailoredApplicationListItem[];
  applicationRuntimeAlert: RuntimeAlert | null;
  draftReviewState: VacancyReviewState;
  draftRuntimeAlert: RuntimeAlert | null;
  isAdaptingCv: boolean;
  isCopyingCoverLetterText: boolean;
  isCurrentDraftMeaningful: boolean;
  isExportingPdf: boolean;
  isOpeningVacancyBrowser: boolean;
  isReviewingVacancy: boolean;
  onAdaptCv: () => void;
  onCopyCoverLetterText: () => void;
  onCreateVacancy: () => void;
  onDeleteTailoredApplication: () => void;
  onExportPdf: () => void;
  onOpenVacancyBrowserSession: () => void;
  onPreviewErrorChange?: (message: string | null) => void;
  onReviewPastedVacancy: () => void;
  onReviewVacancyUrl: () => void;
  onSelectApplication: (tailoredApplicationId: string) => void;
  onSelectDraft: () => void;
  onSelectPreviewDocument: (kind: PreviewDocumentKind) => void;
  onSelectRailItem?: (item: RailItemId) => void;
  onTextDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onUrlDraftChange: (event: ChangeEvent<HTMLInputElement>) => void;
  preview: TailoredApplicationPreview | null;
  previewDocumentKind: PreviewDocumentKind;
  selectedTailoredApplicationId: string | null;
  selectedWorkspaceItem: WorkspaceSelectionKind;
  textDraft: string;
  urlDraft: string;
  vacancyPreview: VacancySummary | null;
  workspaceOverlay?: ReactNode;
}

export function WorkspaceScreen({
  activeRailItem = 'job_vacancies',
  ambientActivityLabel,
  applicationTitle,
  applications,
  applicationRuntimeAlert,
  draftReviewState,
  draftRuntimeAlert,
  isAdaptingCv,
  isCopyingCoverLetterText,
  isCurrentDraftMeaningful,
  isExportingPdf,
  isOpeningVacancyBrowser,
  isReviewingVacancy,
  onAdaptCv,
  onCopyCoverLetterText,
  onCreateVacancy,
  onDeleteTailoredApplication,
  onExportPdf,
  onOpenVacancyBrowserSession,
  onPreviewErrorChange,
  onReviewPastedVacancy,
  onReviewVacancyUrl,
  onSelectApplication,
  onSelectDraft,
  onSelectPreviewDocument,
  onSelectRailItem,
  onTextDraftChange,
  onUrlDraftChange,
  preview,
  previewDocumentKind,
  selectedTailoredApplicationId,
  selectedWorkspaceItem,
  textDraft,
  urlDraft,
  vacancyPreview,
  workspaceOverlay,
}: WorkspaceScreenProperties) {
  const hasVacancyItems = isCurrentDraftMeaningful || applications.length > 0;
  const pageAlert = selectedWorkspaceItem === 'draft' ? draftRuntimeAlert : applicationRuntimeAlert;
  let draftPageIntro = 'Start with a job link, or paste the job description if you need to.';

  if (draftReviewState === 'reviewed') {
    draftPageIntro = 'These job details are locked until you add another job.';
  } else if (isCurrentDraftMeaningful) {
    draftPageIntro = 'Check the job details before tailoring your CV and cover letter.';
  }
  const pageHeaderActions =
    selectedWorkspaceItem === 'tailored_application' ? (
      <Button disabled={preview === null || isExportingPdf} onClick={onExportPdf} tone="primary">
        Save CV and cover letter
      </Button>
    ) : undefined;
  const pageIntro =
    selectedWorkspaceItem === 'tailored_application'
      ? (preview?.employer ?? preview?.vacancyTitle ?? applicationTitle ?? undefined)
      : draftPageIntro;
  const pageTitle =
    selectedWorkspaceItem === 'tailored_application'
      ? (preview?.vacancyTitle ?? preview?.title ?? applicationTitle ?? 'Saved job')
      : 'Add a job';

  return (
    <DesktopShell
      activeRailItem={activeRailItem}
      ambientActivityLabel={ambientActivityLabel}
      onSelectRailItem={onSelectRailItem}
      pageAlert={pageAlert ? <RuntimeAlertBanner alert={pageAlert} /> : undefined}
      pageHeaderActions={pageHeaderActions}
      pageIntro={pageIntro}
      pageTitle={pageTitle}
      railItems={['job_vacancies', 'original_cv', 'settings']}
      sidebar={
        <SidebarContainer>
          <SectionLabel>Jobs</SectionLabel>
          <Button onClick={onCreateVacancy} tone="primary">
            Add a job
          </Button>
          {hasVacancyItems ? null : (
            <>
              <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
                No jobs yet
              </h2>
              <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">
                Start with a job link, or paste the job description if you need to. Your current
                draft appears here, then saved jobs stay below it.
              </p>
            </>
          )}
          {isCurrentDraftMeaningful ? (
            <WorkspaceSidebarItem
              description={resolveDraftDescription(vacancyPreview)}
              isSelected={selectedWorkspaceItem === 'draft'}
              label="Add a job"
              onClick={onSelectDraft}
            />
          ) : null}
          {applications.map((application) => {
            const isSelected =
              selectedWorkspaceItem === 'tailored_application' &&
              selectedTailoredApplicationId === application.id;

            return (
              <WorkspaceSidebarItem
                description={application.employer ?? 'CV and cover letter ready'}
                isSelected={isSelected}
                key={application.id}
                label={application.vacancyTitle ?? application.title}
                onClick={() => {
                  onSelectApplication(application.id);
                }}
              />
            );
          })}
          <div className="flex-1" />
        </SidebarContainer>
      }
      workspaceOverlay={workspaceOverlay}
    >
      {selectedWorkspaceItem === 'tailored_application' ? (
        <WorkspaceApplicationView
          applicationTitle={applicationTitle}
          isCopyingCoverLetterText={isCopyingCoverLetterText}
          isExportingPdf={isExportingPdf}
          onDeleteTailoredApplication={onDeleteTailoredApplication}
          onCopyCoverLetterText={onCopyCoverLetterText}
          onPreviewErrorChange={onPreviewErrorChange}
          onSelectPreviewDocument={onSelectPreviewDocument}
          preview={preview}
          previewDocumentKind={previewDocumentKind}
        />
      ) : (
        <WorkspaceDraftView
          draftReviewState={draftReviewState}
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
        />
      )}
    </DesktopShell>
  );
}

function WorkspaceSidebarItem({
  description,
  isSelected,
  label,
  onClick,
}: {
  description: string;
  isSelected: boolean;
  label: string;
  onClick: () => void;
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
  );
}

function resolveDraftDescription(vacancyPreview: VacancySummary | null) {
  if (vacancyPreview?.canGenerate === true) {
    return 'Ready to tailor';
  }

  return 'Draft in progress';
}
