import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  mapReadinessRouteViewModel,
  type ReadinessRouteViewModel,
} from '../readiness/readiness-route.js';
import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js';
import type { OriginalCvImportResult, OriginalCvWorkspaceState } from '../shared/original-cv.js';
import type {
  CompletePendingGenerationResult,
  PendingGenerationCommand,
} from '../shared/pending-generation.js';
import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../shared/settings.js';
import type { StartupDestination } from '../shared/startup-destination.js';
import type { TailoredApplicationWorkspaceState } from '../shared/tailored-application.js';
import type { VacancyDraft, VacancyIngestResult, VacancySummary } from '../shared/vacancy.js';
import {
  createDefaultWorkspaceSelection,
  type JobsWorkspaceSelection,
  type WorkspaceSelection,
  type WorkspaceTopLevelSection,
} from '../shared/workspace-selection.js';
import {
  getActiveOriginalCvDetailQueryOptions,
  getOriginalCvWorkspaceStateQueryOptions,
  getPendingGenerationCommandQueryOptions,
  getReadinessViewModelQueryOptions,
  getSettingsSnapshotQueryOptions,
  getTailoredApplicationPreviewQueryOptions,
  getTailoredApplicationWorkspaceStateQueryOptions,
  getVacancyWorkspaceStateQueryOptions,
  getWorkspaceSelectionQueryOptions,
  rendererQueryKeys,
} from './app-queries.js';
import { resolveRendererLoadingState } from './loading/resolve-renderer-loading-state.js';
import { WorkspaceBlockingOverlay } from './loading/workspace-blocking-overlay.js';
import { type RendererScreenKind, resolveRendererScreen } from './routing/renderer-screen.js';
import {
  resolveTailoredApplicationId,
  resolveWorkspaceViewSelection,
  type WorkspaceSelectionOverride,
} from './routing/workspace-view-selection.js';
import {
  createRuntimeAlert,
  createSetupActionRuntimeAlert,
  createSetupStatusRuntimeAlert,
  pickHigherPriorityAlert,
  resolveNextRuntimeAlert,
  type RuntimeAlert,
  type RuntimeAlertItem,
} from './runtime-alerts.js';
import { AiWorkerCheckingScreen } from './screens/ai-worker-checking-screen.js';
import { AiWorkerSignInRequiredScreen } from './screens/ai-worker-sign-in-required-screen.js';
import { AiWorkerUnavailableScreen } from './screens/ai-worker-unavailable-screen.js';
import { OriginalCvScreen } from './screens/original-cv-screen.js';
import { SettingsScreen, type SettingsSection } from './screens/settings-screen.js';
import { WorkspaceScreen } from './screens/workspace-screen.js';
import { Button } from './ui/button.js';
import { Dialog } from './ui/dialog.js';

const initialReadinessViewModel: ReadinessRouteViewModel = {
  body: 'Getting AI ready before you enter the app.',
  canEnterWorkspace: false,
  diagnostic: 'Checking your AI connection on this Mac.',
  heading: 'Connect AI',
  primaryActionLabel: undefined,
  secondaryActionLabel: undefined,
  startupDestination: undefined,
  status: 'checking',
};

const initialOriginalCvWorkspaceState: OriginalCvWorkspaceState = {
  activeOriginalCv: null,
  snapshotCount: 0,
};

const initialTailoredApplicationWorkspaceState: TailoredApplicationWorkspaceState = {
  activeApplicationId: null,
  applications: [],
};

const initialVacancyDraft: VacancyDraft = {
  text: '',
  url: '',
};

const initialVacancyWorkspaceState = {
  draft: initialVacancyDraft,
  reviewState: 'editable' as const,
  vacancy: null,
};

const readinessErrorMessage = "We couldn't check AI.";
const readinessErrorAction = 'Restart the app or get help with AI setup on this Mac.';
const workspaceSelectionSaveErrorMessage = "We couldn't save where you left off.";
const exportPdfErrorMessage =
  "We couldn't save the PDF. Check that the destination folder is available on this Mac, then try again.";
const originalCvFileTypeErrorMessage = 'Choose a PDF or DOCX file.';

function isSupportedOriginalCvFile(file: File) {
  const normalizedName = file.name.toLowerCase();

  return (
    normalizedName.endsWith('.pdf') ||
    normalizedName.endsWith('.docx') ||
    file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

type OriginalCvImportDestination = 'workspace';
type OriginalCvImportTopLevelSection = Extract<
  WorkspaceTopLevelSection,
  'job_vacancies' | 'original_cv'
>;
type OriginalCvRuntimeAlertView = 'detail' | 'empty' | 'replace';
type OriginalCvSectionMode = 'detail' | 'replace';
type RendererStartupDestinationOverride = OriginalCvImportDestination;
type PreviewDocumentKind = 'adapted_cv' | 'cover_letter';
type ImportOriginalCvMutationResult = OriginalCvImportResult;
type RuntimeAlertOwnerView =
  | OriginalCvRuntimeAlertView
  | 'draft'
  | 'saved_application'
  | SettingsSection
  | 'delete_tailored_application_dialog'
  | 'draft_discard_dialog'
  | 'local_data_reset_dialog';
type OriginalCvRuntimeAlerts = Record<OriginalCvRuntimeAlertView, RuntimeAlert | null>;
type SettingsRuntimeAlerts = Record<SettingsSection, RuntimeAlert | null>;

function createEmptyOriginalCvRuntimeAlerts(): OriginalCvRuntimeAlerts {
  return {
    detail: null,
    empty: null,
    replace: null,
  };
}

export function clearOriginalCvRuntimeAlertsBySource(
  alerts: OriginalCvRuntimeAlerts,
  source: string,
): OriginalCvRuntimeAlerts {
  const nextAlerts = {
    detail: alerts.detail?.source === source ? null : alerts.detail,
    empty: alerts.empty?.source === source ? null : alerts.empty,
    replace: alerts.replace?.source === source ? null : alerts.replace,
  };

  if (
    nextAlerts.detail === alerts.detail &&
    nextAlerts.empty === alerts.empty &&
    nextAlerts.replace === alerts.replace
  ) {
    return alerts;
  }

  return nextAlerts;
}

function createEmptySettingsRuntimeAlerts(): SettingsRuntimeAlerts {
  return {
    ai_worker: null,
    local_data: null,
  };
}

function clearSettingsRuntimeAlertsBySource(
  alerts: SettingsRuntimeAlerts,
  source: string,
): SettingsRuntimeAlerts {
  const nextAlerts = {
    ai_worker: alerts.ai_worker?.source === source ? null : alerts.ai_worker,
    local_data: alerts.local_data?.source === source ? null : alerts.local_data,
  };

  if (nextAlerts.ai_worker === alerts.ai_worker && nextAlerts.local_data === alerts.local_data) {
    return alerts;
  }

  return nextAlerts;
}

function createScopedRuntimeAlert({
  message,
  owner,
  priority = 300,
  source,
  variant = 'error',
}: {
  message: string;
  owner: {
    scope: RuntimeAlert['owner']['scope'];
    view: RuntimeAlertOwnerView;
  };
  priority?: number;
  source: string;
  variant?: RuntimeAlert['variant'];
}): RuntimeAlert {
  return createRuntimeAlert({
    owner,
    priority,
    source,
    title: message,
    variant,
  });
}

function createOriginalCvRuntimeAlert({
  message,
  priority,
  source,
  view,
}: {
  message: string;
  priority?: number;
  source: string;
  view: OriginalCvRuntimeAlertView;
}): RuntimeAlert {
  return createScopedRuntimeAlert({
    message,
    owner: {
      scope: 'original_cv',
      view,
    },
    priority,
    source,
  });
}

function createSavedApplicationRuntimeAlert({
  message,
  priority = 300,
  source,
}: {
  message: string;
  priority?: number;
  source: string;
}): RuntimeAlert {
  return createScopedRuntimeAlert({
    message,
    owner: {
      scope: 'job_vacancies',
      view: 'saved_application',
    },
    priority,
    source,
  });
}

function createDraftRuntimeAlert({
  message,
  priority = 400,
  source,
}: {
  message: string;
  priority?: number;
  source: string;
}): RuntimeAlert {
  return createScopedRuntimeAlert({
    message,
    owner: {
      scope: 'job_vacancies',
      view: 'draft',
    },
    priority,
    source,
  });
}

function resolveActiveOriginalCvRuntimeAlertView({
  activeOriginalCv,
  activeView,
}: {
  activeOriginalCv: OriginalCvWorkspaceState['activeOriginalCv'];
  activeView: OriginalCvSectionMode;
}): OriginalCvRuntimeAlertView {
  if (activeOriginalCv === null) {
    return 'empty';
  }

  if (activeView === 'replace') {
    return 'replace';
  }

  return 'detail';
}

function resolveDraftFieldTargetId(inputType: VacancySummary['inputType']) {
  return inputType === 'url' ? 'workspace-vacancy-url' : 'workspace-vacancy-text';
}

function resolveDraftFieldLabel(inputType: VacancySummary['inputType']) {
  return inputType === 'url' ? 'Job link' : 'Job description';
}

function createDraftValidationItems(preview: VacancySummary): RuntimeAlertItem[] {
  if (preview.canGenerate) {
    return [];
  }

  const fieldLabel = resolveDraftFieldLabel(preview.inputType);
  const targetId = resolveDraftFieldTargetId(preview.inputType);
  const items: RuntimeAlertItem[] = [];

  if (preview.responsibilities.length === 0) {
    items.push({
      description: 'Add the main responsibilities.',
      id: 'responsibilities',
      label: fieldLabel,
      targetId,
    });
  }

  if (preview.requirements.length === 0) {
    items.push({
      description: "Add what they're looking for.",
      id: 'requirements',
      label: fieldLabel,
      targetId,
    });
  }

  return items;
}

function createDraftStatusRuntimeAlert(preview: VacancySummary | null): RuntimeAlert | null {
  if (preview?.blockingReason === null || preview === null) {
    return null;
  }

  const items = createDraftValidationItems(preview);

  return createRuntimeAlert({
    body: preview.blockingReason,
    items: items.length > 0 ? items : undefined,
    owner: {
      scope: 'job_vacancies',
      view: 'draft',
    },
    priority: items.length > 0 ? 200 : 100,
    source: items.length > 0 ? 'draft_validation' : 'draft_blocking_reason',
    title:
      items.length > 0
        ? 'Add a bit more detail before tailoring your CV.'
        : 'This job needs attention before you tailor your CV.',
    variant: 'warning',
  });
}

export function App() {
  const queryClient = useQueryClient();
  const [deleteTailoredApplicationDialogAlert, setDeleteTailoredApplicationDialogAlert] =
    useState<RuntimeAlert | null>(null);
  const [draftDiscardDialogAlert, setDraftDiscardDialogAlert] = useState<RuntimeAlert | null>(null);
  const [isDeleteTailoredApplicationDialogOpen, setIsDeleteTailoredApplicationDialogOpen] =
    useState(false);
  const [isConfirmingDraftDiscard, setIsConfirmingDraftDiscard] = useState(false);
  const [isCopyingCoverLetterText, setIsCopyingCoverLetterText] = useState(false);
  const [isResetLocalAppDataDialogOpen, setIsResetLocalAppDataDialogOpen] = useState(false);
  const [isSecondaryActionPending, setIsSecondaryActionPending] = useState(false);
  const [originalCvSectionFile, setOriginalCvSectionFile] = useState<File | null>(null);
  const [originalCvSectionMode, setOriginalCvSectionMode] =
    useState<OriginalCvSectionMode>('detail');
  const [originalCvRuntimeAlerts, setOriginalCvRuntimeAlerts] = useState<OriginalCvRuntimeAlerts>(
    createEmptyOriginalCvRuntimeAlerts,
  );
  const [previewDocumentKind, setPreviewDocumentKind] = useState<PreviewDocumentKind>('adapted_cv');
  const [draftWorkspaceAlert, setDraftWorkspaceAlertState] = useState<RuntimeAlert | null>(null);
  const [resetConfirmationPhrase, setResetConfirmationPhrase] = useState('');
  const [resetLocalAppDataDialogAlert, setResetLocalAppDataDialogAlert] =
    useState<RuntimeAlert | null>(null);
  const [savedApplicationRuntimeAlert, setSavedApplicationRuntimeAlertState] =
    useState<RuntimeAlert | null>(null);
  const [selectedTailoredApplicationId, setSelectedTailoredApplicationId] = useState<string | null>(
    null,
  );
  const [settingsRuntimeAlerts, setSettingsRuntimeAlerts] = useState<SettingsRuntimeAlerts>(
    createEmptySettingsRuntimeAlerts,
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('ai_worker');
  const [setupActionAlert, setSetupActionAlert] = useState<RuntimeAlert | null>(null);
  const [startupDestinationOverride, setStartupDestinationOverride] =
    useState<RendererStartupDestinationOverride | null>(null);
  const [workspaceSelectionOverride, setWorkspaceSelectionOverride] =
    useState<WorkspaceSelectionOverride>(null);
  const [vacancyDraft, setVacancyDraft] = useState(initialVacancyDraft);
  const [draftActionAlert, setDraftActionAlertState] = useState<RuntimeAlert | null>(null);
  const [vacancyPreviewOverride, setVacancyPreviewOverride] = useState<VacancySummary | null>(null);
  const isStartingOriginalCvImport = useRef(false);
  const isResumingPendingGeneration = useRef(false);
  const lastResumedCommandId = useRef<string | null>(null);

  const readinessQuery = useQuery({
    ...getReadinessViewModelQueryOptions(),
    placeholderData: initialReadinessViewModel,
  });
  const baseReadinessViewModel = readinessQuery.data ?? initialReadinessViewModel;
  const viewModel = applyStartupDestinationOverride({
    readinessViewModel: baseReadinessViewModel,
    startupDestinationOverride,
  });
  const setupStatusAlert = createSetupStatusRuntimeAlert({
    body: viewModel.body,
    diagnostic: viewModel.diagnostic,
    status: viewModel.status,
  });
  const setupRuntimeAlert = pickHigherPriorityAlert(setupStatusAlert, setupActionAlert);
  const settingsQuery = useQuery({
    ...getSettingsSnapshotQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
  });
  const settingsSnapshot = settingsQuery.data ?? null;
  const originalCvWorkspaceQuery = useQuery({
    ...getOriginalCvWorkspaceStateQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: initialOriginalCvWorkspaceState,
  });
  const originalCvWorkspaceState = originalCvWorkspaceQuery.data ?? initialOriginalCvWorkspaceState;
  const vacancyWorkspaceQuery = useQuery({
    ...getVacancyWorkspaceStateQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: initialVacancyWorkspaceState,
  });
  const vacancyWorkspaceState = vacancyWorkspaceQuery.data ?? initialVacancyWorkspaceState;
  const tailoredApplicationWorkspaceQuery = useQuery({
    ...getTailoredApplicationWorkspaceStateQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: initialTailoredApplicationWorkspaceState,
  });
  const tailoredApplicationWorkspaceState =
    tailoredApplicationWorkspaceQuery.data ?? initialTailoredApplicationWorkspaceState;
  const workspaceSelectionQuery = useQuery({
    ...getWorkspaceSelectionQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: createDefaultWorkspaceSelection(),
  });
  const persistedWorkspaceSelection =
    workspaceSelectionQuery.data ?? createDefaultWorkspaceSelection();
  const activeWorkspaceSection = persistedWorkspaceSelection.topLevelSection;
  const activeOriginalCvId = originalCvWorkspaceState.activeOriginalCv?.id ?? null;
  const originalCvDetailQuery = useQuery({
    ...(activeOriginalCvId === null
      ? {
          queryFn: () => Promise.resolve(null),
          queryKey: [...rendererQueryKeys.originalCvDetail, 'none'] as const,
        }
      : getActiveOriginalCvDetailQueryOptions(activeOriginalCvId)),
    enabled:
      viewModel.canEnterWorkspace &&
      activeWorkspaceSection === 'original_cv' &&
      activeOriginalCvId !== null,
  });
  const activeOriginalCvDetail =
    activeWorkspaceSection === 'original_cv' ? originalCvDetailQuery.data : null;
  const activeOriginalCvRuntimeAlertView = resolveActiveOriginalCvRuntimeAlertView({
    activeOriginalCv: originalCvWorkspaceState.activeOriginalCv,
    activeView: originalCvSectionMode,
  });
  const activeOriginalCvRuntimeAlert = originalCvRuntimeAlerts[activeOriginalCvRuntimeAlertView];
  const reviewedVacancyPreview = vacancyWorkspaceState.vacancy ?? vacancyPreviewOverride;
  const isCurrentDraftMeaningful = isVacancyDraftMeaningful({
    draft: vacancyDraft,
    vacancyPreview: reviewedVacancyPreview,
  });
  const resolvedTailoredApplicationId = resolveTailoredApplicationId({
    preferredTailoredApplicationId: selectedTailoredApplicationId,
    workspaceState: tailoredApplicationWorkspaceState,
  });
  const selectedTailoredApplication =
    resolvedTailoredApplicationId === null
      ? null
      : (tailoredApplicationWorkspaceState.applications.find((application) => {
          return application.id === resolvedTailoredApplicationId;
        }) ?? null);
  const pendingGenerationQuery = useQuery({
    ...getPendingGenerationCommandQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: null,
  });
  const pendingGenerationCommand = pendingGenerationQuery.data ?? null;
  const workspaceSelection = resolveWorkspaceViewSelection({
    forcedSelection: workspaceSelectionOverride,
    hasMeaningfulDraft: isCurrentDraftMeaningful,
    hasPendingGeneration: pendingGenerationCommand !== null,
    resolvedTailoredApplicationId,
  });
  const tailoredApplicationPreviewQuery = useQuery({
    ...getTailoredApplicationPreviewQueryOptions(resolvedTailoredApplicationId ?? ''),
    enabled:
      viewModel.canEnterWorkspace &&
      workspaceSelection.kind === 'tailored_application' &&
      resolvedTailoredApplicationId !== null,
    placeholderData: (previousPreview) => {
      return previousPreview;
    },
  });
  const tailoredApplicationPreview =
    workspaceSelection.kind === 'tailored_application'
      ? (tailoredApplicationPreviewQuery.data ?? null)
      : null;
  const draftStatusAlert = createDraftStatusRuntimeAlert(reviewedVacancyPreview);
  const draftRuntimeAlert = pickHigherPriorityAlert(
    pickHigherPriorityAlert(draftStatusAlert, draftActionAlert),
    draftWorkspaceAlert,
  );
  const activeSettingsRuntimeAlert = settingsRuntimeAlerts[settingsSection];

  const invalidateReadinessQuery = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: rendererQueryKeys.readiness,
    });
  };

  const invalidateWorkspaceQueries = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: rendererQueryKeys.originalCvDetail,
      }),
      queryClient.invalidateQueries({
        queryKey: rendererQueryKeys.originalCvWorkspace,
      }),
      queryClient.invalidateQueries({
        queryKey: rendererQueryKeys.pendingGeneration,
      }),
      queryClient.invalidateQueries({
        queryKey: rendererQueryKeys.tailoredApplicationPreviewRoot,
      }),
      queryClient.invalidateQueries({
        queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
      }),
      queryClient.invalidateQueries({
        queryKey: rendererQueryKeys.workspaceSelection,
      }),
      queryClient.invalidateQueries({
        queryKey: rendererQueryKeys.vacancyWorkspace,
      }),
    ]);
  };

  const seedReadinessQuery = async ({
    preflightResult,
    startupDestination,
  }: {
    preflightResult: AiWorkerPreflightResult;
    startupDestination?: StartupDestination;
  }): Promise<void> => {
    await queryClient.cancelQueries({
      queryKey: rendererQueryKeys.readiness,
    });

    const resolvedStartupDestination =
      preflightResult.status === 'ready'
        ? (startupDestination ??
          (await globalThis.window.cvMaxxing.aiWorker.getStartupDestination()))
        : undefined;

    queryClient.setQueryData(
      rendererQueryKeys.readiness,
      mapReadinessRouteViewModel({
        preflight: preflightResult,
        startupDestination: resolvedStartupDestination,
      }),
    );
  };

  const applyVacancyIngestResult = async (result: VacancyIngestResult): Promise<void> => {
    queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, result.workspaceState);
    setVacancyPreviewOverride(result.workspaceState.vacancy === null ? result.vacancy : null);
    await queryClient.invalidateQueries({
      queryKey: rendererQueryKeys.vacancyWorkspace,
    });
  };

  const aiWorkerStatusMutation = useMutation({
    mutationFn: async (action: 'retry' | 'sign_in'): Promise<AiWorkerPreflightResult> => {
      if (action === 'sign_in') {
        return await globalThis.window.cvMaxxing.aiWorker.startAiWorkerSignIn();
      }

      return await globalThis.window.cvMaxxing.aiWorker.retryAiWorkerPreflight();
    },
    onSuccess: async (preflightResult): Promise<void> => {
      clearDraftWorkspaceAlert();
      setSettingsRuntimeAlert('ai_worker', null);
      setSetupActionAlert(null);
      setStartupDestinationOverride(null);
      await seedReadinessQuery({
        preflightResult,
      });

      if (preflightResult.status !== 'ready') {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.settings,
        }),
        invalidateWorkspaceQueries(),
      ]);
    },
  });
  const clearJobSiteBrowserDataMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await globalThis.window.cvMaxxing.settings.clearJobSiteBrowserData();
    },
  });
  const resetLocalAppDataMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await globalThis.window.cvMaxxing.settings.resetLocalAppData({
        confirmationPhrase: resetConfirmationPhrase,
      });
    },
    onSuccess: async (): Promise<void> => {
      setIsDeleteTailoredApplicationDialogOpen(false);
      setDeleteTailoredApplicationDialogAlert(null);
      setDraftDiscardDialogAlert(null);
      setIsConfirmingDraftDiscard(false);
      setIsResetLocalAppDataDialogOpen(false);
      setOriginalCvSectionFile(null);
      setOriginalCvSectionMode('detail');
      setOriginalCvRuntimeAlerts(createEmptyOriginalCvRuntimeAlerts());
      setPreviewDocumentKind('adapted_cv');
      clearDraftWorkspaceAlert();
      setResetConfirmationPhrase('');
      setResetLocalAppDataDialogAlert(null);
      setSavedApplicationRuntimeAlertState(null);
      setSelectedTailoredApplicationId(null);
      clearSettingsRuntimeAlerts();
      setSetupActionAlert(null);
      setStartupDestinationOverride(null);
      setWorkspaceSelectionOverride(null);
      setVacancyDraft(initialVacancyDraft);
      setVacancyPreviewOverride(null);
      clearDraftActionAlert();
      queryClient.setQueryData(rendererQueryKeys.readiness, initialReadinessViewModel);
      queryClient.setQueryData(
        rendererQueryKeys.originalCvWorkspace,
        initialOriginalCvWorkspaceState,
      );
      queryClient.setQueryData(rendererQueryKeys.pendingGeneration, null);
      queryClient.setQueryData(
        rendererQueryKeys.tailoredApplicationWorkspace,
        initialTailoredApplicationWorkspaceState,
      );
      queryClient.setQueryData(
        rendererQueryKeys.workspaceSelection,
        createDefaultWorkspaceSelection(),
      );
      queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, initialVacancyWorkspaceState);
      queryClient.removeQueries({
        queryKey: rendererQueryKeys.settings,
      });
      queryClient.removeQueries({
        queryKey: rendererQueryKeys.tailoredApplicationPreviewRoot,
      });
      await Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.settings,
        }),
        invalidateWorkspaceQueries(),
      ]);
    },
  });
  const importOriginalCvMutation = useMutation({
    mutationFn: async ({
      file,
    }: {
      file: File;
      nextStartupDestination: OriginalCvImportDestination;
      topLevelSectionAfterImport: OriginalCvImportTopLevelSection;
    }): Promise<ImportOriginalCvMutationResult> => {
      return await globalThis.window.cvMaxxing.originalCv.importOriginalCv({
        content: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
      });
    },
    onSuccess: async (
      result,
      { nextStartupDestination, topLevelSectionAfterImport },
    ): Promise<void> => {
      if (result.kind === 'ai_worker_not_ready') {
        setOriginalCvRuntimeAlert(activeOriginalCvRuntimeAlertView, null);
        clearDraftWorkspaceAlert();
        await seedReadinessQuery({
          preflightResult: result.preflight,
        });

        return;
      }

      if (result.kind === 'rejected') {
        setOriginalCvRuntimeAlert(
          activeOriginalCvRuntimeAlertView,
          createOriginalCvRuntimeAlert({
            message: result.error.message,
            source: 'original_cv_import',
            view: activeOriginalCvRuntimeAlertView,
          }),
        );

        return;
      }

      const nextWorkspaceSelection: WorkspaceSelection = {
        jobs: persistedWorkspaceSelection.jobs,
        originalCv: {
          kind: 'active_original_cv',
          originalCvId: result.originalCv.id,
        },
        topLevelSection: topLevelSectionAfterImport,
      };

      clearOriginalCvRuntimeAlerts();
      setIsConfirmingDraftDiscard(false);
      setOriginalCvSectionFile(null);
      setOriginalCvSectionMode('detail');
      setPreviewDocumentKind('adapted_cv');
      clearDraftWorkspaceAlert();
      setStartupDestinationOverride(nextStartupDestination);
      setWorkspaceSelectionOverride(null);
      clearDraftActionAlert();
      setVacancyPreviewOverride(null);
      queryClient.setQueryData(rendererQueryKeys.originalCvWorkspace, {
        activeOriginalCv: result.originalCv,
        snapshotCount: result.originalCv.snapshotCount,
      });
      setPersistedWorkspaceSelection(nextWorkspaceSelection);
      await globalThis.window.cvMaxxing.vacancy.clearVacancyWorkspaceState();
      queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, initialVacancyWorkspaceState);
      await Promise.all([
        persistWorkspaceSelectionMutation.mutateAsync(nextWorkspaceSelection),
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.originalCvWorkspace,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.vacancyWorkspace,
        }),
      ]);
    },
  });
  const persistWorkspaceSelectionMutation = useMutation({
    mutationFn: async (selection: WorkspaceSelection): Promise<void> => {
      await globalThis.window.cvMaxxing.tailoredApplication.setWorkspaceSelection(selection);
    },
  });
  const setPersistedWorkspaceSelection = (selection: WorkspaceSelection) => {
    queryClient.setQueryData(rendererQueryKeys.workspaceSelection, selection);
  };
  const saveWorkspaceSelection = (selection: WorkspaceSelection): Promise<void> => {
    setPersistedWorkspaceSelection(selection);

    return persistWorkspaceSelectionMutation.mutateAsync(selection);
  };
  const buildWorkspaceSelection = ({
    jobs = persistedWorkspaceSelection.jobs,
    topLevelSection = persistedWorkspaceSelection.topLevelSection,
  }: {
    jobs?: JobsWorkspaceSelection;
    topLevelSection?: WorkspaceTopLevelSection;
  }): WorkspaceSelection => {
    return {
      jobs,
      originalCv:
        originalCvWorkspaceState.activeOriginalCv === null
          ? {
              kind: 'none',
            }
          : {
              kind: 'active_original_cv',
              originalCvId: originalCvWorkspaceState.activeOriginalCv.id,
            },
      topLevelSection,
    };
  };
  const reviewVacancyUrlMutation = useMutation({
    mutationFn: async (): Promise<VacancyIngestResult> => {
      return await globalThis.window.cvMaxxing.vacancy.ingestVacancyUrl({
        url: vacancyDraft.url.trim(),
      });
    },
    onSuccess: async (result): Promise<void> => {
      clearDraftWorkspaceAlert();
      clearDraftActionAlert();
      await applyVacancyIngestResult(result);
    },
  });
  const reviewPastedVacancyMutation = useMutation({
    mutationFn: async (): Promise<VacancyIngestResult> => {
      return await globalThis.window.cvMaxxing.vacancy.ingestPastedVacancy({
        text: vacancyDraft.text.trim(),
        url: vacancyDraft.url.trim() === '' ? undefined : vacancyDraft.url.trim(),
      });
    },
    onSuccess: async (result): Promise<void> => {
      clearDraftWorkspaceAlert();
      clearDraftActionAlert();
      await applyVacancyIngestResult(result);
    },
  });
  const openVacancyBrowserSessionMutation = useMutation({
    mutationFn: async (url: string): Promise<VacancyIngestResult> => {
      return await globalThis.window.cvMaxxing.vacancy.openVacancyBrowserSession({
        url,
      });
    },
    onSuccess: async (result): Promise<void> => {
      clearDraftWorkspaceAlert();
      clearDraftActionAlert();
      await applyVacancyIngestResult(result);
    },
  });
  const clearVacancyWorkspaceMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await globalThis.window.cvMaxxing.vacancy.clearVacancyWorkspaceState();
    },
    onSuccess: async (): Promise<void> => {
      clearDraftWorkspaceAlert();
      clearDraftActionAlert();
      setVacancyPreviewOverride(null);
      queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, initialVacancyWorkspaceState);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.vacancyWorkspace,
        }),
      ]);
    },
  });
  const startPendingGenerationMutation = useMutation({
    mutationFn: async (
      nextVacancyDraft: PendingGenerationCommand['vacancyDraft'],
    ): Promise<AiWorkerPreflightResult> => {
      const activeOriginalCv = originalCvWorkspaceState.activeOriginalCv;

      if (activeOriginalCv === null) {
        throw new Error('Add Your CV before tailoring this job.');
      }

      return await globalThis.window.cvMaxxing.tailoredApplication.startPendingGeneration({
        originalCvId: activeOriginalCv.id,
        originalCvLabel: activeOriginalCv.originalFilename,
        vacancyDraft: nextVacancyDraft,
      });
    },
    onSuccess: async (preflightResult): Promise<void> => {
      flushSync(() => {
        clearDraftWorkspaceAlert();
        setSelectedTailoredApplicationId(null);
        setStartupDestinationOverride('workspace');
        setWorkspaceSelectionOverride({
          kind: 'draft',
        });
        setVacancyPreviewOverride(null);
      });

      await seedReadinessQuery({
        preflightResult,
        startupDestination: preflightResult.status === 'ready' ? 'workspace' : undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.pendingGeneration,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
        }),
      ]);
    },
  });
  const completePendingGenerationMutation = useMutation({
    mutationFn: async ({
      commandId,
    }: {
      commandId: string;
      tailoredApplicationId: string | null;
    }): Promise<CompletePendingGenerationResult> => {
      return await globalThis.window.cvMaxxing.tailoredApplication.completePendingGeneration(
        commandId,
      );
    },
    onSuccess: ({ workspaceState }, { tailoredApplicationId }) => {
      const nextSelectedTailoredApplicationId =
        workspaceState.activeApplicationId ?? tailoredApplicationId;

      flushSync(() => {
        setIsDeleteTailoredApplicationDialogOpen(false);
        setPreviewDocumentKind('adapted_cv');
        clearDraftWorkspaceAlert();
        clearSavedApplicationRuntimeAlert();
        setSelectedTailoredApplicationId(nextSelectedTailoredApplicationId);
        setStartupDestinationOverride('workspace');
        setWorkspaceSelectionOverride(null);
        setVacancyDraft(initialVacancyDraft);
        setVacancyPreviewOverride(null);
      });

      queryClient.setQueryData(rendererQueryKeys.pendingGeneration, null);
      queryClient.setQueryData(rendererQueryKeys.tailoredApplicationWorkspace, workspaceState);
      queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, initialVacancyWorkspaceState);

      if (nextSelectedTailoredApplicationId !== null) {
        queryClient
          .prefetchQuery(
            getTailoredApplicationPreviewQueryOptions(nextSelectedTailoredApplicationId),
          )
          .catch(() => null);
      }

      Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.pendingGeneration,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationPreviewRoot,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
        }),
      ]).catch((error: unknown) => {
        setSavedApplicationRuntimeAlert(
          createSavedApplicationRuntimeAlert({
            message: resolveErrorMessage(error, `${readinessErrorMessage} ${readinessErrorAction}`),
            priority: 400,
            source: 'saved_application_complete',
          }),
        );
      });
    },
  });
  const deleteTailoredApplicationMutation = useMutation({
    mutationFn: async (tailoredApplicationId: string): Promise<void> => {
      await globalThis.window.cvMaxxing.tailoredApplication.deleteTailoredApplication(
        tailoredApplicationId,
      );
    },
    onSuccess: async (_data, tailoredApplicationId): Promise<void> => {
      if (selectedTailoredApplicationId === tailoredApplicationId) {
        setSelectedTailoredApplicationId(null);
      }

      setDeleteTailoredApplicationDialogAlert(null);
      setIsDeleteTailoredApplicationDialogOpen(false);
      setPreviewDocumentKind('adapted_cv');
      clearDraftWorkspaceAlert();
      clearSavedApplicationRuntimeAlert();
      await Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationPreviewRoot,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
        }),
      ]);
    },
  });
  const exportPdfMutation = useMutation({
    mutationFn: async (nextPreviewDocumentKind: PreviewDocumentKind): Promise<void> => {
      if (tailoredApplicationPreview === null) {
        throw new Error('A tailored application preview is required before exporting a PDF.');
      }

      if (nextPreviewDocumentKind === 'adapted_cv') {
        await globalThis.window.cvMaxxing.tailoredApplication.exportAdaptedCvPdf(
          tailoredApplicationPreview.id,
        );

        return;
      }

      await globalThis.window.cvMaxxing.tailoredApplication.exportCoverLetterPdf(
        tailoredApplicationPreview.id,
      );
    },
  });
  const abandonPendingGenerationMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await globalThis.window.cvMaxxing.tailoredApplication.abandonPendingGeneration();
    },
    onSuccess: async (): Promise<void> => {
      clearDraftWorkspaceAlert();
      setStartupDestinationOverride(null);
      setWorkspaceSelectionOverride({
        kind: 'draft',
      });
      setVacancyPreviewOverride(null);
      await Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.pendingGeneration,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.vacancyWorkspace,
        }),
      ]);
    },
  });
  const isClearingJobSiteBrowserData = clearJobSiteBrowserDataMutation.isPending;
  const isImportingOriginalCv = importOriginalCvMutation.isPending;
  const isOpeningVacancyBrowser = openVacancyBrowserSessionMutation.isPending;
  const isPendingGenerationActionPending =
    abandonPendingGenerationMutation.isPending ||
    completePendingGenerationMutation.isPending ||
    deleteTailoredApplicationMutation.isPending ||
    exportPdfMutation.isPending ||
    startPendingGenerationMutation.isPending;
  const isResettingLocalAppData = resetLocalAppDataMutation.isPending;
  const isSubmittingPrimaryAction = aiWorkerStatusMutation.isPending;
  const isSubmittingVacancyReview =
    reviewPastedVacancyMutation.isPending || reviewVacancyUrlMutation.isPending;
  const previewedVacancyDraft =
    reviewedVacancyPreview === null ? null : vacancyWorkspaceState.draft;
  const vacancyPreview = isVacancyDraftReviewed(vacancyDraft, previewedVacancyDraft)
    ? reviewedVacancyPreview
    : null;
  const draftReviewState =
    vacancyPreview === null
      ? initialVacancyWorkspaceState.reviewState
      : vacancyWorkspaceState.reviewState;
  const queriedVacancyDraft = vacancyWorkspaceState.draft;

  useEffect(() => {
    setVacancyDraft(queriedVacancyDraft);
  }, [queriedVacancyDraft]);

  useEffect(() => {
    if (vacancyWorkspaceState.vacancy === null) {
      return;
    }

    setVacancyPreviewOverride(null);
  }, [vacancyWorkspaceState.vacancy]);

  useEffect(() => {
    if (workspaceSelection.kind === 'tailored_application') {
      return;
    }

    setIsDeleteTailoredApplicationDialogOpen(false);
    setPreviewDocumentKind('adapted_cv');
  }, [workspaceSelection.kind]);

  useEffect(() => {
    if (isCurrentDraftMeaningful) {
      return;
    }

    setIsConfirmingDraftDiscard(false);
  }, [isCurrentDraftMeaningful]);

  useEffect(() => {
    if (!viewModel.canEnterWorkspace) {
      return;
    }

    setSetupActionAlert(null);
  }, [viewModel.canEnterWorkspace]);

  useEffect(() => {
    let nextError: Error | null;

    if (!viewModel.canEnterWorkspace) {
      nextError = readinessQuery.error ?? null;
    } else if (activeWorkspaceSection === 'settings') {
      nextError =
        settingsQuery.error ??
        originalCvWorkspaceQuery.error ??
        workspaceSelectionQuery.error ??
        null;
    } else if (activeWorkspaceSection === 'original_cv') {
      nextError =
        originalCvDetailQuery.error ??
        originalCvWorkspaceQuery.error ??
        workspaceSelectionQuery.error ??
        null;
    } else if (workspaceSelection.kind === 'tailored_application') {
      nextError =
        tailoredApplicationPreviewQuery.error ??
        tailoredApplicationWorkspaceQuery.error ??
        pendingGenerationQuery.error ??
        originalCvWorkspaceQuery.error ??
        workspaceSelectionQuery.error ??
        null;
    } else {
      nextError =
        vacancyWorkspaceQuery.error ??
        tailoredApplicationWorkspaceQuery.error ??
        pendingGenerationQuery.error ??
        originalCvWorkspaceQuery.error ??
        workspaceSelectionQuery.error ??
        null;
    }

    if (nextError === null) {
      if (setupActionAlert?.source === 'renderer_query') {
        setSetupActionAlert(null);
      }

      clearSettingsRuntimeAlertBySource('settings_query');

      setOriginalCvRuntimeAlerts((currentAlerts) => {
        return clearOriginalCvRuntimeAlertsBySource(currentAlerts, 'original_cv_query');
      });

      if (savedApplicationRuntimeAlert?.source === 'saved_application_query') {
        setSavedApplicationRuntimeAlert(null);
      }

      clearDraftWorkspaceAlert('draft_query');

      return;
    }

    const fallbackMessage = `${readinessErrorMessage} ${readinessErrorAction}`;
    const resolvedMessage = resolveErrorMessage(nextError, fallbackMessage);

    if (!viewModel.canEnterWorkspace) {
      setSetupActionAlert(
        createSetupActionRuntimeAlert({
          body: resolvedMessage,
          priority: 400,
          source: 'renderer_query',
          status: viewModel.status,
          title: readinessErrorMessage,
          variant: 'error',
        }),
      );

      return;
    }

    if (activeWorkspaceSection === 'original_cv') {
      setOriginalCvRuntimeAlert(
        activeOriginalCvRuntimeAlertView,
        createOriginalCvRuntimeAlert({
          message: resolvedMessage,
          source: 'original_cv_query',
          view: activeOriginalCvRuntimeAlertView,
        }),
      );

      return;
    }

    if (activeWorkspaceSection === 'settings') {
      setSettingsRuntimeAlert(
        settingsSection,
        createScopedRuntimeAlert({
          message: resolvedMessage,
          owner: {
            scope: 'settings',
            view: settingsSection,
          },
          priority: 400,
          source: 'settings_query',
        }),
      );

      return;
    }

    if (workspaceSelection.kind === 'tailored_application') {
      setSavedApplicationRuntimeAlert(
        createSavedApplicationRuntimeAlert({
          message: resolvedMessage,
          priority: 400,
          source: 'saved_application_query',
        }),
      );

      return;
    }

    setDraftWorkspaceAlert(
      createDraftRuntimeAlert({
        message: resolvedMessage,
        source: 'draft_query',
      }),
    );
  }, [
    activeOriginalCvRuntimeAlert,
    activeOriginalCvRuntimeAlertView,
    activeSettingsRuntimeAlert,
    activeWorkspaceSection,
    draftWorkspaceAlert,
    originalCvWorkspaceQuery.error,
    originalCvDetailQuery.error,
    pendingGenerationQuery.error,
    readinessQuery.error,
    savedApplicationRuntimeAlert,
    settingsQuery.error,
    setupActionAlert,
    tailoredApplicationPreviewQuery.error,
    tailoredApplicationWorkspaceQuery.error,
    viewModel.canEnterWorkspace,
    viewModel.status,
    settingsSection,
    workspaceSelection.kind,
    workspaceSelectionQuery.error,
    vacancyWorkspaceQuery.error,
  ]);

  useEffect(() => {
    if (activeOriginalCvDetail === null || activeOriginalCvDetail === undefined) {
      return;
    }

    setOriginalCvRuntimeAlerts((currentAlerts) => {
      if (currentAlerts.detail?.source !== 'original_cv_query') {
        return currentAlerts;
      }

      return {
        ...currentAlerts,
        detail: null,
      };
    });
  }, [activeOriginalCvDetail]);

  const handlePrimaryAction = async (): Promise<void> => {
    if (viewModel.primaryActionLabel === undefined || aiWorkerStatusMutation.isPending) {
      return;
    }

    const action: 'retry' | 'sign_in' =
      viewModel.status === 'sign_in_required' ? 'sign_in' : 'retry';

    try {
      setSetupActionAlert(null);
      await aiWorkerStatusMutation.mutateAsync(action);
    } catch {
      setSetupActionAlert(
        createSetupActionRuntimeAlert({
          body: `${readinessErrorMessage} ${readinessErrorAction}`,
          priority: 400,
          source: 'setup_primary_action',
          status: viewModel.status,
          title: readinessErrorMessage,
          variant: 'error',
        }),
      );
    }
  };

  const openSetupGuide = async (): Promise<void> => {
    if (isSecondaryActionPending) {
      return;
    }

    setIsSecondaryActionPending(true);

    try {
      await globalThis.window.cvMaxxing.aiWorker.openAiWorkerSetupGuide();
    } finally {
      setIsSecondaryActionPending(false);
    }
  };

  const clearSettingsRuntimeAlerts = () => {
    setSettingsRuntimeAlerts(createEmptySettingsRuntimeAlerts());
  };

  const clearSettingsRuntimeAlertBySource = (source: string) => {
    setSettingsRuntimeAlerts((currentAlerts) => {
      return clearSettingsRuntimeAlertsBySource(currentAlerts, source);
    });
  };

  const clearOriginalCvRuntimeAlerts = () => {
    setOriginalCvRuntimeAlerts(createEmptyOriginalCvRuntimeAlerts());
  };

  const clearSavedApplicationRuntimeAlert = () => {
    setSavedApplicationRuntimeAlertState(null);
  };

  const clearDraftWorkspaceAlert = (source?: string) => {
    setDraftWorkspaceAlertState((currentAlert) => {
      if (source !== undefined && currentAlert?.source !== source) {
        return currentAlert;
      }

      return null;
    });
  };

  const clearDraftActionAlert = (source?: string) => {
    setDraftActionAlertState((currentAlert) => {
      if (source !== undefined && currentAlert?.source !== source) {
        return currentAlert;
      }

      return null;
    });
  };

  const setDraftWorkspaceAlert = (nextAlert: RuntimeAlert | null) => {
    setDraftWorkspaceAlertState((currentAlert) => {
      return resolveNextRuntimeAlert(currentAlert, nextAlert);
    });
  };

  const setDraftActionAlert = (nextAlert: RuntimeAlert | null) => {
    setDraftActionAlertState((currentAlert) => {
      return resolveNextRuntimeAlert(currentAlert, nextAlert);
    });
  };

  const setSettingsRuntimeAlert = (section: SettingsSection, nextAlert: RuntimeAlert | null) => {
    setSettingsRuntimeAlerts((currentAlerts) => {
      const resolvedAlert = resolveNextRuntimeAlert(currentAlerts[section], nextAlert);

      if (resolvedAlert === currentAlerts[section]) {
        return currentAlerts;
      }

      return {
        ...currentAlerts,
        [section]: resolvedAlert,
      };
    });
  };

  const setOriginalCvRuntimeAlert = (
    view: OriginalCvRuntimeAlertView,
    nextAlert: RuntimeAlert | null,
  ) => {
    setOriginalCvRuntimeAlerts((currentAlerts) => {
      return {
        ...currentAlerts,
        [view]: resolveNextRuntimeAlert(currentAlerts[view], nextAlert),
      };
    });
  };

  const setSavedApplicationRuntimeAlert = (nextAlert: RuntimeAlert | null) => {
    setSavedApplicationRuntimeAlertState((currentAlert) => {
      return resolveNextRuntimeAlert(currentAlert, nextAlert);
    });
  };

  const showWorkspaceSelectionSaveFailure = (
    selection: WorkspaceSelection,
    options?: {
      originalCvTargetView?: OriginalCvRuntimeAlertView;
    },
  ) => {
    if (selection.topLevelSection === 'settings') {
      setSettingsRuntimeAlert(
        settingsSection,
        createScopedRuntimeAlert({
          message: workspaceSelectionSaveErrorMessage,
          owner: {
            scope: 'settings',
            view: settingsSection,
          },
          priority: 400,
          source: 'settings_selection',
        }),
      );

      return;
    }

    if (selection.topLevelSection === 'original_cv') {
      const targetView = options?.originalCvTargetView ?? activeOriginalCvRuntimeAlertView;

      setOriginalCvRuntimeAlert(
        targetView,
        createOriginalCvRuntimeAlert({
          message: workspaceSelectionSaveErrorMessage,
          priority: 400,
          source: 'original_cv_selection',
          view: targetView,
        }),
      );

      return;
    }

    if (selection.jobs.kind === 'tailored_application') {
      setSavedApplicationRuntimeAlert(
        createSavedApplicationRuntimeAlert({
          message: workspaceSelectionSaveErrorMessage,
          priority: 400,
          source: 'saved_application_selection',
        }),
      );

      return;
    }

    setDraftWorkspaceAlert(
      createDraftRuntimeAlert({
        message: workspaceSelectionSaveErrorMessage,
        source: 'draft_selection',
      }),
    );
  };

  const clearWorkspaceSelectionSaveFailure = (
    selection: WorkspaceSelection,
    options?: {
      originalCvTargetView?: OriginalCvRuntimeAlertView;
    },
  ) => {
    if (selection.topLevelSection === 'settings') {
      clearSettingsRuntimeAlertBySource('settings_selection');

      return;
    }

    if (selection.topLevelSection === 'original_cv') {
      const targetView = options?.originalCvTargetView ?? activeOriginalCvRuntimeAlertView;

      if (originalCvRuntimeAlerts[targetView]?.source === 'original_cv_selection') {
        setOriginalCvRuntimeAlert(targetView, null);
      }

      return;
    }

    if (selection.jobs.kind === 'tailored_application') {
      if (savedApplicationRuntimeAlert?.source === 'saved_application_selection') {
        setSavedApplicationRuntimeAlert(null);
      }

      return;
    }

    clearDraftWorkspaceAlert('draft_selection');
  };

  const handleOriginalCvDetailPreviewErrorChange = (message: string | null) => {
    if (message === null) {
      setOriginalCvRuntimeAlerts((currentAlerts) => {
        if (currentAlerts.detail?.source !== 'original_cv_preview') {
          return currentAlerts;
        }

        return {
          ...currentAlerts,
          detail: null,
        };
      });

      return;
    }

    setOriginalCvRuntimeAlert(
      'detail',
      createOriginalCvRuntimeAlert({
        message,
        priority: 400,
        source: 'original_cv_preview',
        view: 'detail',
      }),
    );
  };

  const handleSavedApplicationPreviewErrorChange = (message: string | null) => {
    if (message === null) {
      setSavedApplicationRuntimeAlertState((currentAlert) => {
        if (currentAlert?.source !== 'saved_application_preview') {
          return currentAlert;
        }

        return null;
      });

      return;
    }

    setSavedApplicationRuntimeAlert(
      createSavedApplicationRuntimeAlert({
        message,
        priority: 400,
        source: 'saved_application_preview',
      }),
    );
  };

  const handleSelectRailItem = (item: 'job_vacancies' | 'original_cv' | 'settings' | 'setup') => {
    if (!viewModel.canEnterWorkspace || item === 'setup') {
      return;
    }

    const nextTopLevelSection: WorkspaceTopLevelSection = item === 'settings' ? 'settings' : item;
    const nextWorkspaceSelection = buildWorkspaceSelection({
      topLevelSection: nextTopLevelSection,
    });

    if (item === 'original_cv') {
      setOriginalCvSectionFile(null);
      setOriginalCvSectionMode('detail');
    }

    clearSettingsRuntimeAlerts();

    const originalCvTargetView =
      item !== 'original_cv' || originalCvWorkspaceState.activeOriginalCv === null
        ? undefined
        : 'detail';

    saveWorkspaceSelection(nextWorkspaceSelection)
      .then(() => {
        clearWorkspaceSelectionSaveFailure(nextWorkspaceSelection, {
          originalCvTargetView,
        });
      })
      .catch(() => {
        showWorkspaceSelectionSaveFailure(nextWorkspaceSelection, {
          originalCvTargetView,
        });
      });
  };

  const handleSelectOriginalCv = () => {
    const nextWorkspaceSelection = buildWorkspaceSelection({
      topLevelSection: 'original_cv',
    });

    setOriginalCvSectionFile(null);
    setOriginalCvSectionMode('detail');

    const originalCvTargetView =
      originalCvWorkspaceState.activeOriginalCv === null ? undefined : 'detail';

    saveWorkspaceSelection(nextWorkspaceSelection)
      .then(() => {
        clearWorkspaceSelectionSaveFailure(nextWorkspaceSelection, {
          originalCvTargetView,
        });
      })
      .catch(() => {
        showWorkspaceSelectionSaveFailure(nextWorkspaceSelection, {
          originalCvTargetView,
        });
      });
  };

  const handleClearJobSiteBrowserData = async (): Promise<void> => {
    if (clearJobSiteBrowserDataMutation.isPending) {
      return;
    }

    try {
      await clearJobSiteBrowserDataMutation.mutateAsync();

      setSettingsRuntimeAlert(
        'local_data',
        createScopedRuntimeAlert({
          message: 'Job-site browser data cleared.',
          owner: {
            scope: 'settings',
            view: 'local_data',
          },
          priority: 100,
          source: 'clear_job_site_browser_data',
          variant: 'success',
        }),
      );
    } catch (error) {
      setSettingsRuntimeAlert(
        'local_data',
        createScopedRuntimeAlert({
          message: resolveErrorMessage(error, "We couldn't clear your job-site browser data."),
          owner: {
            scope: 'settings',
            view: 'local_data',
          },
          source: 'clear_job_site_browser_data',
        }),
      );
    }
  };

  const handleOpenResetLocalAppDataDialog = () => {
    if (resetLocalAppDataMutation.isPending) {
      return;
    }

    setResetLocalAppDataDialogAlert(null);
    setIsResetLocalAppDataDialogOpen(true);
  };

  const handleResetLocalAppData = async (): Promise<void> => {
    if (resetLocalAppDataMutation.isPending) {
      return;
    }

    setResetLocalAppDataDialogAlert(null);

    try {
      await resetLocalAppDataMutation.mutateAsync();
    } catch (error) {
      setResetLocalAppDataDialogAlert(
        createScopedRuntimeAlert({
          message: resolveErrorMessage(
            error,
            "We couldn't reset your app data right now. Try again.",
          ),
          owner: {
            scope: 'settings',
            view: 'local_data_reset_dialog',
          },
          source: 'reset_local_app_data',
        }),
      );
    }
  };

  const handleOriginalCvImport = async ({
    file,
    nextStartupDestination,
    topLevelSectionAfterImport,
  }: {
    file: File | null;
    nextStartupDestination: OriginalCvImportDestination;
    topLevelSectionAfterImport: OriginalCvImportTopLevelSection;
  }): Promise<void> => {
    if (file === null || importOriginalCvMutation.isPending || isStartingOriginalCvImport.current) {
      return;
    }

    isStartingOriginalCvImport.current = true;
    setOriginalCvRuntimeAlert(activeOriginalCvRuntimeAlertView, null);
    clearDraftWorkspaceAlert();

    try {
      await importOriginalCvMutation.mutateAsync({
        file,
        nextStartupDestination,
        topLevelSectionAfterImport,
      });
    } catch {
      setOriginalCvRuntimeAlert(
        activeOriginalCvRuntimeAlertView,
        createOriginalCvRuntimeAlert({
          message: `${readinessErrorMessage} ${readinessErrorAction}`,
          source: 'original_cv_import',
          view: activeOriginalCvRuntimeAlertView,
        }),
      );
    } finally {
      isStartingOriginalCvImport.current = false;
    }
  };

  const handleOriginalCvFile = async ({
    nextFile,
    setFile,
    nextStartupDestination,
    topLevelSectionAfterImport,
  }: {
    nextFile: File | null;
    nextStartupDestination: OriginalCvImportDestination;
    setFile: (file: File | null) => void;
    topLevelSectionAfterImport: OriginalCvImportTopLevelSection;
  }): Promise<void> => {
    if (nextFile === null) {
      setOriginalCvRuntimeAlert(activeOriginalCvRuntimeAlertView, null);
      setFile(null);

      return;
    }

    if (!isSupportedOriginalCvFile(nextFile)) {
      setOriginalCvRuntimeAlert(
        activeOriginalCvRuntimeAlertView,
        createOriginalCvRuntimeAlert({
          message: originalCvFileTypeErrorMessage,
          source: 'original_cv_file',
          view: activeOriginalCvRuntimeAlertView,
        }),
      );
      setFile(null);

      return;
    }

    setOriginalCvRuntimeAlert(activeOriginalCvRuntimeAlertView, null);
    setFile(nextFile);
    await handleOriginalCvImport({
      file: nextFile,
      nextStartupDestination,
      topLevelSectionAfterImport,
    });
  };

  const handleOriginalCvSectionSelection = (event: ChangeEvent<HTMLInputElement>) => {
    handleOriginalCvFile({
      nextFile: event.target.files?.[0] ?? null,
      nextStartupDestination: 'workspace',
      setFile: setOriginalCvSectionFile,
      topLevelSectionAfterImport: 'original_cv',
    }).catch(() => null);
  };

  const handleOriginalCvSectionDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();

    handleOriginalCvFile({
      nextFile: event.dataTransfer.files[0] ?? null,
      nextStartupDestination: 'workspace',
      setFile: setOriginalCvSectionFile,
      topLevelSectionAfterImport: 'original_cv',
    }).catch(() => null);
  };

  const handleStartOriginalCvReplacement = () => {
    setOriginalCvSectionFile(null);
    setOriginalCvSectionMode('replace');
  };

  const handleStartPendingGeneration = async (
    vacancyDraft: PendingGenerationCommand['vacancyDraft'],
  ): Promise<void> => {
    const activeOriginalCv = originalCvWorkspaceState.activeOriginalCv;

    if (activeOriginalCv === null || startPendingGenerationMutation.isPending) {
      return;
    }

    clearDraftWorkspaceAlert();
    clearDraftActionAlert();

    try {
      await startPendingGenerationMutation.mutateAsync(vacancyDraft);
    } catch (error) {
      setDraftActionAlert(
        createScopedRuntimeAlert({
          message: resolveErrorMessage(error, `${readinessErrorMessage} ${readinessErrorAction}`),
          owner: {
            scope: 'job_vacancies',
            view: 'draft',
          },
          priority: 400,
          source: 'start_pending_generation',
        }),
      );
    }
  };

  const handleExportAdaptedCvPdf = async (): Promise<void> => {
    if (tailoredApplicationPreview === null || exportPdfMutation.isPending) {
      return;
    }

    try {
      await exportPdfMutation.mutateAsync(previewDocumentKind);

      clearSavedApplicationRuntimeAlert();
    } catch {
      setSavedApplicationRuntimeAlert(
        createSavedApplicationRuntimeAlert({
          message: exportPdfErrorMessage,
          priority: 400,
          source: 'saved_application_export',
        }),
      );
    }
  };

  const handleSelectTailoredApplication = (tailoredApplicationId: string) => {
    if (tailoredApplicationPreview?.id === tailoredApplicationId || exportPdfMutation.isPending) {
      return;
    }

    if (
      selectedTailoredApplicationId !== null &&
      selectedTailoredApplicationId !== tailoredApplicationId
    ) {
      clearSavedApplicationRuntimeAlert();
    }

    setDeleteTailoredApplicationDialogAlert(null);
    setIsDeleteTailoredApplicationDialogOpen(false);
    setPreviewDocumentKind('adapted_cv');
    clearDraftWorkspaceAlert();
    setSelectedTailoredApplicationId(tailoredApplicationId);
    setWorkspaceSelectionOverride(null);
  };

  const handleOpenDeleteTailoredApplicationDialog = () => {
    if (tailoredApplicationPreview === null || deleteTailoredApplicationMutation.isPending) {
      return;
    }

    setDeleteTailoredApplicationDialogAlert(null);
    setIsDeleteTailoredApplicationDialogOpen(true);
  };

  const handleDeleteTailoredApplication = async (): Promise<void> => {
    if (tailoredApplicationPreview === null || deleteTailoredApplicationMutation.isPending) {
      return;
    }

    try {
      await deleteTailoredApplicationMutation.mutateAsync(tailoredApplicationPreview.id);
    } catch {
      setDeleteTailoredApplicationDialogAlert(
        createScopedRuntimeAlert({
          message: `${readinessErrorMessage} ${readinessErrorAction}`,
          owner: {
            scope: 'job_vacancies',
            view: 'delete_tailored_application_dialog',
          },
          source: 'delete_tailored_application',
        }),
      );
    }
  };

  const showBlankDraftWorkspace = () => {
    setDeleteTailoredApplicationDialogAlert(null);
    setDraftDiscardDialogAlert(null);
    setIsDeleteTailoredApplicationDialogOpen(false);
    setIsConfirmingDraftDiscard(false);
    setPreviewDocumentKind('adapted_cv');
    clearDraftWorkspaceAlert();
    setSelectedTailoredApplicationId(null);
    setStartupDestinationOverride('workspace');
    setWorkspaceSelectionOverride({
      kind: 'draft',
    });
    setVacancyDraft(initialVacancyDraft);
    setVacancyPreviewOverride(null);
    clearDraftActionAlert();
  };

  const handleCreateVacancy = async (): Promise<void> => {
    if (clearVacancyWorkspaceMutation.isPending) {
      return;
    }

    if (isCurrentDraftMeaningful) {
      setDraftDiscardDialogAlert(null);
      setIsConfirmingDraftDiscard(true);

      return;
    }

    try {
      await clearVacancyWorkspaceMutation.mutateAsync();
      showBlankDraftWorkspace();
    } catch (error) {
      setDraftActionAlert(
        createScopedRuntimeAlert({
          message: resolveErrorMessage(error, "We couldn't clear this job draft."),
          owner: {
            scope: 'job_vacancies',
            view: 'draft',
          },
          priority: 400,
          source: 'clear_job_draft',
        }),
      );
    }
  };

  const handleConfirmDraftDiscard = async (): Promise<void> => {
    if (clearVacancyWorkspaceMutation.isPending) {
      return;
    }

    setDraftDiscardDialogAlert(null);

    try {
      await clearVacancyWorkspaceMutation.mutateAsync();
      showBlankDraftWorkspace();
    } catch (error) {
      setDraftDiscardDialogAlert(
        createScopedRuntimeAlert({
          message: resolveErrorMessage(error, "We couldn't clear this job draft."),
          owner: {
            scope: 'job_vacancies',
            view: 'draft_discard_dialog',
          },
          source: 'clear_job_draft',
        }),
      );
    }
  };

  const handleCopyCoverLetterText = async (): Promise<void> => {
    if (tailoredApplicationPreview === null || isCopyingCoverLetterText) {
      return;
    }

    setIsCopyingCoverLetterText(true);

    try {
      await globalThis.navigator.clipboard.writeText(
        tailoredApplicationPreview.coverLetter.plainText,
      );

      clearSavedApplicationRuntimeAlert();
    } catch {
      setSavedApplicationRuntimeAlert(
        createSavedApplicationRuntimeAlert({
          message: "We couldn't copy the cover letter text.",
          priority: 400,
          source: 'saved_application_copy',
        }),
      );
    } finally {
      setIsCopyingCoverLetterText(false);
    }
  };

  const handleAbandonDraft = async (): Promise<void> => {
    if (abandonPendingGenerationMutation.isPending) {
      return;
    }

    try {
      await abandonPendingGenerationMutation.mutateAsync();
    } catch {
      setDraftActionAlert(
        createDraftRuntimeAlert({
          message: `${readinessErrorMessage} ${readinessErrorAction}`,
          source: 'abandon_pending_generation',
        }),
      );
    }
  };

  const screenKind =
    viewModel.canEnterWorkspace && pendingGenerationCommand !== null
      ? 'workspace'
      : resolveRendererScreen({
          originalCvWorkspaceState,
          readinessViewModel: viewModel,
        });

  const workerStatusLabel = resolveWorkerStatusLabel(viewModel.status);
  const workerStatusTone = resolveWorkerStatusTone(viewModel.status);
  const rendererLoadingState = resolveRendererLoadingState({
    hasActiveOriginalCv: originalCvWorkspaceState.activeOriginalCv !== null,
    isCheckingAiWorkerReadiness: viewModel.status === 'checking',
    isFetchingTailoredApplicationPreview:
      workspaceSelection.kind === 'tailored_application' &&
      resolvedTailoredApplicationId !== null &&
      tailoredApplicationPreviewQuery.isFetching,
    isGeneratingTailoredApplication:
      startPendingGenerationMutation.isPending || pendingGenerationCommand !== null,
    isImportingOriginalCv,
    isResettingLocalAppData,
    isReviewingVacancy: isSubmittingVacancyReview,
  });
  const ambientActivityLabel =
    rendererLoadingState.scope === 'ambient' ? rendererLoadingState.label : null;
  const appOverlay =
    rendererLoadingState.scope === 'app_blocking' ? (
      <WorkspaceBlockingOverlay title="Preparing app" />
    ) : null;
  let workspaceOverlay = null;

  if (rendererLoadingState.scope === 'workspace_blocking') {
    workspaceOverlay =
      rendererLoadingState.kind === 'tailored_application_generation' ? (
        <WorkspaceBlockingOverlay
          isSecondaryActionPending={isPendingGenerationActionPending}
          onSecondaryAction={() => {
            handleAbandonDraft().catch(() => null);
          }}
          secondaryActionLabel="Cancel"
          title={rendererLoadingState.label}
        />
      ) : (
        <WorkspaceBlockingOverlay title={rendererLoadingState.label} />
      );
  }

  const resumePendingGeneration = useEffectEvent(async (): Promise<void> => {
    if (
      !viewModel.canEnterWorkspace ||
      viewModel.status !== 'ready' ||
      pendingGenerationCommand === null
    ) {
      return;
    }

    try {
      const result =
        await globalThis.window.cvMaxxing.tailoredApplication.resumePendingGeneration();

      await completePendingGenerationMutation.mutateAsync({
        commandId: pendingGenerationCommand.commandId,
        tailoredApplicationId: result.tailoredApplicationId,
      });
    } catch (error) {
      flushSync(() => {
        setStartupDestinationOverride('workspace');
        clearDraftWorkspaceAlert();
        setDraftActionAlert(
          createScopedRuntimeAlert({
            message: resolveErrorMessage(error, `${readinessErrorMessage} ${readinessErrorAction}`),
            owner: {
              scope: 'job_vacancies',
              view: 'draft',
            },
            priority: 400,
            source: 'resume_pending_generation',
          }),
        );
        setSelectedTailoredApplicationId(null);
        setWorkspaceSelectionOverride({
          kind: 'draft',
        });
        setVacancyPreviewOverride(null);
      });

      queryClient.setQueryData(rendererQueryKeys.pendingGeneration, null);

      Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.pendingGeneration,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.vacancyWorkspace,
        }),
      ]).catch(() => {
        // Preserve the original generation failure message even if the reload also fails.
      });
    }
  });

  useEffect(() => {
    if (
      !viewModel.canEnterWorkspace ||
      viewModel.status !== 'ready' ||
      pendingGenerationCommand === null
    ) {
      return;
    }

    if (
      isResumingPendingGeneration.current ||
      lastResumedCommandId.current === pendingGenerationCommand.commandId
    ) {
      return;
    }

    isResumingPendingGeneration.current = true;
    lastResumedCommandId.current = pendingGenerationCommand.commandId;
    let didStartResume = false;
    const resumeAnimationFrameId = globalThis.window.requestAnimationFrame(() => {
      didStartResume = true;
      resumePendingGeneration()
        .catch(() => {
          lastResumedCommandId.current = null;
        })
        .finally(() => {
          isResumingPendingGeneration.current = false;
        });
    });

    return () => {
      globalThis.window.cancelAnimationFrame(resumeAnimationFrameId);

      if (!didStartResume) {
        lastResumedCommandId.current = null;
        isResumingPendingGeneration.current = false;
      }
    };
  }, [pendingGenerationCommand, viewModel.canEnterWorkspace, viewModel.status]);

  const screenRegistry: Record<RendererScreenKind, () => ReactElement> = {
    ai_worker_checking: () => {
      return (
        <AiWorkerCheckingScreen
          onOpenSetupGuide={() => {
            openSetupGuide().catch(() => {
              setSetupActionAlert(
                createSetupActionRuntimeAlert({
                  body: `${readinessErrorMessage} ${readinessErrorAction}`,
                  priority: 400,
                  source: 'setup_guide',
                  status: viewModel.status,
                  title: readinessErrorMessage,
                  variant: 'error',
                }),
              );
            });
          }}
          runtimeAlert={setupRuntimeAlert}
          viewModel={viewModel}
        />
      );
    },
    ai_worker_sign_in_required: () => {
      return (
        <AiWorkerSignInRequiredScreen
          isPrimaryActionPending={isSubmittingPrimaryAction}
          isSecondaryActionPending={isSecondaryActionPending}
          onPrimaryAction={() => {
            handlePrimaryAction().catch(() => null);
          }}
          onSecondaryAction={() => {
            openSetupGuide().catch(() => {
              setSetupActionAlert(
                createSetupActionRuntimeAlert({
                  body: `${readinessErrorMessage} ${readinessErrorAction}`,
                  priority: 400,
                  source: 'setup_guide',
                  status: viewModel.status,
                  title: readinessErrorMessage,
                  variant: 'error',
                }),
              );
            });
          }}
          runtimeAlert={setupRuntimeAlert}
          viewModel={viewModel}
        />
      );
    },
    ai_worker_unavailable: () => {
      return (
        <AiWorkerUnavailableScreen
          isPrimaryActionPending={isSubmittingPrimaryAction}
          isSecondaryActionPending={isSecondaryActionPending}
          onPrimaryAction={() => {
            handlePrimaryAction().catch(() => null);
          }}
          onSecondaryAction={() => {
            openSetupGuide().catch(() => {
              setSetupActionAlert(
                createSetupActionRuntimeAlert({
                  body: `${readinessErrorMessage} ${readinessErrorAction}`,
                  priority: 400,
                  source: 'setup_guide',
                  status: viewModel.status,
                  title: readinessErrorMessage,
                  variant: 'error',
                }),
              );
            });
          }}
          runtimeAlert={setupRuntimeAlert}
          viewModel={viewModel}
        />
      );
    },
    first_launch: () => {
      return (
        <OriginalCvScreen
          activeOriginalCvDetail={null}
          activeOriginalCv={null}
          ambientActivityLabel={ambientActivityLabel}
          isImportingOriginalCv={isImportingOriginalCv}
          onDetailPreviewErrorChange={handleOriginalCvDetailPreviewErrorChange}
          onFileDrop={handleOriginalCvSectionDrop}
          onFileSelection={handleOriginalCvSectionSelection}
          onImportOriginalCv={() => {
            handleOriginalCvImport({
              file: originalCvSectionFile,
              nextStartupDestination: 'workspace',
              topLevelSectionAfterImport: 'original_cv',
            }).catch(() => null);
          }}
          onSelectOriginalCv={handleSelectOriginalCv}
          onSelectRailItem={handleSelectRailItem}
          originalCvFile={originalCvSectionFile}
          runtimeAlert={activeOriginalCvRuntimeAlert}
          workspaceOverlay={workspaceOverlay}
        />
      );
    },
    workspace: () => {
      if (activeWorkspaceSection === 'original_cv') {
        return (
          <OriginalCvScreen
            activeOriginalCvDetail={activeOriginalCvDetail}
            activeOriginalCv={originalCvWorkspaceState.activeOriginalCv}
            activeView={originalCvSectionMode}
            ambientActivityLabel={ambientActivityLabel}
            isImportingOriginalCv={isImportingOriginalCv}
            onDetailPreviewErrorChange={handleOriginalCvDetailPreviewErrorChange}
            onFileDrop={handleOriginalCvSectionDrop}
            onFileSelection={handleOriginalCvSectionSelection}
            onImportOriginalCv={() => {
              handleOriginalCvImport({
                file: originalCvSectionFile,
                nextStartupDestination: 'workspace',
                topLevelSectionAfterImport: 'original_cv',
              }).catch(() => null);
            }}
            onSelectOriginalCv={handleSelectOriginalCv}
            onSelectRailItem={handleSelectRailItem}
            onStartAddCv={handleStartOriginalCvReplacement}
            originalCvFile={originalCvSectionFile}
            runtimeAlert={activeOriginalCvRuntimeAlert}
            workspaceOverlay={workspaceOverlay}
          />
        );
      }

      return (
        <>
          <WorkspaceScreen
            activeRailItem="job_vacancies"
            ambientActivityLabel={ambientActivityLabel}
            applicationTitle={selectedTailoredApplication?.title ?? null}
            applications={tailoredApplicationWorkspaceState.applications}
            draftReviewState={draftReviewState}
            isAdaptingCv={isPendingGenerationActionPending}
            isCopyingCoverLetterText={isCopyingCoverLetterText}
            isCurrentDraftMeaningful={isCurrentDraftMeaningful}
            isExportingPdf={isPendingGenerationActionPending}
            isOpeningVacancyBrowser={isOpeningVacancyBrowser}
            isReviewingVacancy={isSubmittingVacancyReview}
            onAdaptCv={() => {
              if (previewedVacancyDraft === null || vacancyPreview?.canGenerate !== true) {
                return;
              }

              handleStartPendingGeneration(previewedVacancyDraft).catch(() => null);
            }}
            onOpenVacancyBrowserSession={() => {
              const originalUrl = vacancyPreview?.originalUrl;

              if (originalUrl === undefined || originalUrl === null || isOpeningVacancyBrowser) {
                return;
              }

              clearDraftWorkspaceAlert();
              clearDraftActionAlert();

              openVacancyBrowserSessionMutation.mutateAsync(originalUrl).catch((error: unknown) => {
                setDraftActionAlert(
                  createRuntimeAlert({
                    items: [
                      {
                        description: 'Open the job page again from the current job link.',
                        id: 'job-link',
                        label: 'Job link',
                        targetId: 'workspace-vacancy-url',
                      },
                    ],
                    owner: {
                      scope: 'job_vacancies',
                      view: 'draft',
                    },
                    priority: 400,
                    source: 'open_job_page',
                    title: resolveErrorMessage(error, "We couldn't open the job page right now."),
                    variant: 'error',
                  }),
                );
              });
            }}
            onCopyCoverLetterText={() => {
              handleCopyCoverLetterText().catch(() => null);
            }}
            onCreateVacancy={() => {
              handleCreateVacancy().catch(() => null);
            }}
            onDeleteTailoredApplication={() => {
              handleOpenDeleteTailoredApplicationDialog();
            }}
            onExportPdf={() => {
              handleExportAdaptedCvPdf().catch(() => null);
            }}
            onPreviewErrorChange={handleSavedApplicationPreviewErrorChange}
            onReviewPastedVacancy={() => {
              if (isSubmittingVacancyReview) {
                return;
              }

              clearDraftWorkspaceAlert();
              clearDraftActionAlert();

              reviewPastedVacancyMutation.mutateAsync().catch((error: unknown) => {
                setDraftActionAlert(
                  createRuntimeAlert({
                    items: [
                      {
                        description: 'Update the job description, then check the details again.',
                        id: 'job-description',
                        label: 'Job description',
                        targetId: 'workspace-vacancy-text',
                      },
                    ],
                    owner: {
                      scope: 'job_vacancies',
                      view: 'draft',
                    },
                    priority: 400,
                    source: 'review_pasted_job_description',
                    title: resolveErrorMessage(
                      error,
                      "We couldn't check the pasted job description.",
                    ),
                    variant: 'error',
                  }),
                );
              });
            }}
            onReviewVacancyUrl={() => {
              if (isSubmittingVacancyReview) {
                return;
              }

              clearDraftWorkspaceAlert();
              clearDraftActionAlert();

              reviewVacancyUrlMutation.mutateAsync().catch((error: unknown) => {
                setDraftActionAlert(
                  createRuntimeAlert({
                    items: [
                      {
                        description: 'Check the job link and try again.',
                        id: 'job-link',
                        label: 'Job link',
                        targetId: 'workspace-vacancy-url',
                      },
                    ],
                    owner: {
                      scope: 'job_vacancies',
                      view: 'draft',
                    },
                    priority: 400,
                    source: 'review_job_link',
                    title: resolveErrorMessage(error, "We couldn't check that job link."),
                    variant: 'error',
                  }),
                );
              });
            }}
            onSelectApplication={(tailoredApplicationId) => {
              handleSelectTailoredApplication(tailoredApplicationId);
              const nextWorkspaceSelection = buildWorkspaceSelection({
                jobs: {
                  kind: 'tailored_application',
                  tailoredApplicationId,
                },
                topLevelSection: 'job_vacancies',
              });

              saveWorkspaceSelection(nextWorkspaceSelection)
                .then(() => {
                  clearWorkspaceSelectionSaveFailure(nextWorkspaceSelection);
                })
                .catch(() => {
                  showWorkspaceSelectionSaveFailure(nextWorkspaceSelection);
                });
            }}
            onSelectDraft={() => {
              setIsDeleteTailoredApplicationDialogOpen(false);
              setPreviewDocumentKind('adapted_cv');
              clearDraftWorkspaceAlert();
              setSelectedTailoredApplicationId(null);
              setWorkspaceSelectionOverride({
                kind: 'draft',
              });
              const nextWorkspaceSelection = buildWorkspaceSelection({
                jobs: {
                  kind: 'draft',
                },
                topLevelSection: 'job_vacancies',
              });

              saveWorkspaceSelection(nextWorkspaceSelection)
                .then(() => {
                  clearWorkspaceSelectionSaveFailure(nextWorkspaceSelection);
                })
                .catch(() => {
                  showWorkspaceSelectionSaveFailure(nextWorkspaceSelection);
                });
            }}
            onSelectPreviewDocument={setPreviewDocumentKind}
            onSelectRailItem={handleSelectRailItem}
            onTextDraftChange={(event) => {
              const nextDraft = {
                text: event.target.value,
                url: vacancyDraft.url,
              };

              setVacancyDraft(nextDraft);
              setSelectedTailoredApplicationId(null);
              setWorkspaceSelectionOverride({
                kind: 'draft',
              });
              setVacancyPreviewOverride(null);
              clearDraftWorkspaceAlert();
              clearDraftActionAlert();

              if (
                persistedWorkspaceSelection.topLevelSection !== 'job_vacancies' ||
                persistedWorkspaceSelection.jobs.kind !== 'draft'
              ) {
                const nextWorkspaceSelection = buildWorkspaceSelection({
                  jobs: {
                    kind: 'draft',
                  },
                  topLevelSection: 'job_vacancies',
                });

                saveWorkspaceSelection(nextWorkspaceSelection)
                  .then(() => {
                    clearWorkspaceSelectionSaveFailure(nextWorkspaceSelection);
                  })
                  .catch(() => {
                    showWorkspaceSelectionSaveFailure(nextWorkspaceSelection);
                  });
              }
            }}
            onUrlDraftChange={(event) => {
              const nextDraft = {
                text: vacancyDraft.text,
                url: event.target.value,
              };

              setVacancyDraft(nextDraft);
              setSelectedTailoredApplicationId(null);
              setWorkspaceSelectionOverride({
                kind: 'draft',
              });
              setVacancyPreviewOverride(null);
              clearDraftWorkspaceAlert();
              clearDraftActionAlert();

              if (
                persistedWorkspaceSelection.topLevelSection !== 'job_vacancies' ||
                persistedWorkspaceSelection.jobs.kind !== 'draft'
              ) {
                const nextWorkspaceSelection = buildWorkspaceSelection({
                  jobs: {
                    kind: 'draft',
                  },
                  topLevelSection: 'job_vacancies',
                });

                saveWorkspaceSelection(nextWorkspaceSelection)
                  .then(() => {
                    clearWorkspaceSelectionSaveFailure(nextWorkspaceSelection);
                  })
                  .catch(() => {
                    showWorkspaceSelectionSaveFailure(nextWorkspaceSelection);
                  });
              }
            }}
            preview={tailoredApplicationPreview}
            previewDocumentKind={previewDocumentKind}
            selectedTailoredApplicationId={resolvedTailoredApplicationId}
            selectedWorkspaceItem={
              workspaceSelection.kind === 'tailored_application' ? 'tailored_application' : 'draft'
            }
            textDraft={vacancyDraft.text}
            urlDraft={vacancyDraft.url}
            vacancyPreview={vacancyPreview}
            applicationRuntimeAlert={savedApplicationRuntimeAlert}
            draftRuntimeAlert={draftRuntimeAlert}
            workspaceOverlay={workspaceOverlay}
          />
          <Dialog
            actions={
              <>
                <Button
                  disabled={clearVacancyWorkspaceMutation.isPending}
                  onClick={() => {
                    setDraftDiscardDialogAlert(null);
                    setIsConfirmingDraftDiscard(false);
                  }}
                  tone="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={clearVacancyWorkspaceMutation.isPending}
                  onClick={() => {
                    handleConfirmDraftDiscard().catch(() => null);
                  }}
                  tone="danger"
                >
                  Discard draft
                </Button>
              </>
            }
            eyebrow="Add a job"
            isDismissable={false}
            isOpen={isConfirmingDraftDiscard}
            onOpenChange={(nextIsOpen) => {
              if (!nextIsOpen) {
                setDraftDiscardDialogAlert(null);
                setIsConfirmingDraftDiscard(false);
              }
            }}
            runtimeAlert={draftDiscardDialogAlert}
            title="Discard this job draft?"
          >
            <p className="m-0">
              Starting a new job will remove this draft and any checked job details attached to it.
              Saved jobs stay in the list.
            </p>
            <p className="m-0">Cancel keeps everything as it is now.</p>
          </Dialog>
          <Dialog
            actions={
              <>
                <Button
                  disabled={deleteTailoredApplicationMutation.isPending}
                  onClick={() => {
                    setDeleteTailoredApplicationDialogAlert(null);
                    setIsDeleteTailoredApplicationDialogOpen(false);
                  }}
                  tone="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={deleteTailoredApplicationMutation.isPending}
                  onClick={() => {
                    handleDeleteTailoredApplication().catch(() => null);
                  }}
                  tone="danger"
                >
                  Delete this job
                </Button>
              </>
            }
            eyebrow="Saved job"
            isDismissable={false}
            isOpen={isDeleteTailoredApplicationDialogOpen}
            onOpenChange={(nextIsOpen) => {
              if (!nextIsOpen) {
                setDeleteTailoredApplicationDialogAlert(null);
                setIsDeleteTailoredApplicationDialogOpen(false);
              }
            }}
            runtimeAlert={deleteTailoredApplicationDialogAlert}
            title="Delete this job?"
          >
            <p className="m-0">
              This permanently removes the saved CV and cover letter for this job.
            </p>
            <p className="m-0">Cancel keeps this job exactly as it is now.</p>
          </Dialog>
        </>
      );
    },
  };

  if (
    activeWorkspaceSection === 'settings' &&
    viewModel.canEnterWorkspace &&
    settingsSnapshot !== null
  ) {
    return (
      <>
        <SettingsScreen
          activeSection={settingsSection}
          appOverlay={appOverlay}
          ambientActivityLabel={ambientActivityLabel}
          isClearingJobSiteBrowserData={isClearingJobSiteBrowserData}
          isOpeningSetupGuide={isSecondaryActionPending}
          isResettingLocalAppData={isResettingLocalAppData}
          isRetryingAiWorker={isSubmittingPrimaryAction}
          onClearJobSiteBrowserData={() => {
            handleClearJobSiteBrowserData().catch(() => null);
          }}
          onOpenSetupGuide={() => {
            setSettingsRuntimeAlert('ai_worker', null);

            openSetupGuide().catch((error: unknown) => {
              setSettingsRuntimeAlert(
                'ai_worker',
                createScopedRuntimeAlert({
                  message: resolveErrorMessage(
                    error,
                    "We couldn't open help right now. Try again.",
                  ),
                  owner: {
                    scope: 'settings',
                    view: 'ai_worker',
                  },
                  source: 'open_ai_setup_guide',
                }),
              );
            });
          }}
          onResetLocalAppData={handleOpenResetLocalAppDataDialog}
          onRetryAiWorker={() => {
            setSettingsRuntimeAlert('ai_worker', null);

            aiWorkerStatusMutation.mutateAsync('retry').catch((error: unknown) => {
              setSettingsRuntimeAlert(
                'ai_worker',
                createScopedRuntimeAlert({
                  message: resolveErrorMessage(
                    error,
                    `${readinessErrorMessage} ${readinessErrorAction}`,
                  ),
                  owner: {
                    scope: 'settings',
                    view: 'ai_worker',
                  },
                  source: 'retry_ai_worker',
                }),
              );
            });
          }}
          onSelectRailItem={handleSelectRailItem}
          onSelectSection={(section) => {
            clearSettingsRuntimeAlerts();
            setSettingsSection(section);
          }}
          runtimeAlert={activeSettingsRuntimeAlert}
          snapshot={settingsSnapshot}
          workerStatus={viewModel.status}
          workerStatusLabel={workerStatusLabel}
          workerStatusTone={workerStatusTone}
        />
        <Dialog
          actions={
            <>
              <Button
                disabled={isResettingLocalAppData}
                onClick={() => {
                  setIsResetLocalAppDataDialogOpen(false);
                  setResetConfirmationPhrase('');
                  setResetLocalAppDataDialogAlert(null);
                }}
                tone="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  isResettingLocalAppData ||
                  resetConfirmationPhrase !== SETTINGS_RESET_CONFIRMATION_PHRASE
                }
                onClick={() => {
                  handleResetLocalAppData().catch(() => null);
                }}
                tone="danger"
              >
                {isResettingLocalAppData ? 'Resetting local app data...' : 'Reset local app data'}
              </Button>
            </>
          }
          eyebrow="Local data"
          isDismissable={false}
          isOpen={isResetLocalAppDataDialogOpen}
          onOpenChange={(nextIsOpen) => {
            if (!nextIsOpen) {
              setIsResetLocalAppDataDialogOpen(false);
              setResetConfirmationPhrase('');
              setResetLocalAppDataDialogAlert(null);
            }
          }}
          runtimeAlert={resetLocalAppDataDialogAlert}
          title="Reset local app data?"
        >
          <p className="m-0">
            This permanently removes your CV, saved jobs, documents, settings, and sign-ins from
            this device.
          </p>
          <label
            className="block text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-status-danger)]"
            htmlFor="reset-local-app-data-confirmation"
          >
            Type RESET to confirm destructive reset
          </label>
          <input
            aria-label="Type RESET to confirm destructive reset"
            className="w-full rounded-[8px] border border-[var(--color-border)] bg-white px-[14px] py-3 text-[13px] font-medium text-[var(--color-copy-strong)] outline-none transition focus:border-[var(--color-ink-900)]"
            id="reset-local-app-data-confirmation"
            onChange={(event) => {
              setResetConfirmationPhrase(event.target.value);
            }}
            type="text"
            value={resetConfirmationPhrase}
          />
        </Dialog>
      </>
    );
  }

  const renderScreen = screenRegistry[screenKind];

  return renderScreen();
}

function applyStartupDestinationOverride({
  readinessViewModel,
  startupDestinationOverride,
}: {
  readinessViewModel: ReadinessRouteViewModel;
  startupDestinationOverride: RendererStartupDestinationOverride | null;
}): ReadinessRouteViewModel {
  if (!readinessViewModel.canEnterWorkspace || startupDestinationOverride === null) {
    return readinessViewModel;
  }

  return {
    ...readinessViewModel,
    startupDestination: startupDestinationOverride,
  };
}

function isVacancyDraftReviewed(
  nextDraft: VacancyDraft,
  previewedVacancyDraft: VacancyDraft | null,
) {
  if (previewedVacancyDraft === null) {
    return false;
  }

  return (
    nextDraft.text === previewedVacancyDraft.text && nextDraft.url === previewedVacancyDraft.url
  );
}

function isVacancyDraftMeaningful({
  draft,
  vacancyPreview,
}: {
  draft: VacancyDraft;
  vacancyPreview: VacancySummary | null;
}) {
  return draft.text.trim() !== '' || draft.url.trim() !== '' || vacancyPreview !== null;
}

function resolveErrorMessage(error: unknown, fallbackMessage: string) {
  if (typeof error === 'string' && error !== '') {
    return resolveRendererErrorMessage(error, fallbackMessage);
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message !== ''
  ) {
    return resolveRendererErrorMessage(error.message, fallbackMessage);
  }

  return fallbackMessage;
}

function resolveRendererErrorMessage(errorMessage: string, fallbackMessage: string) {
  const electronInvokeMessage = extractElectronInvokeMessage(errorMessage);

  if (electronInvokeMessage === null) {
    return errorMessage;
  }

  if (electronInvokeMessage === '') {
    return fallbackMessage;
  }

  return electronInvokeMessage;
}

function extractElectronInvokeMessage(errorMessage: string): string | null {
  const wrappedMessageMatch =
    /^Error invoking remote method ['"`][\s\S]+?['"`](?::\s*([\s\S]+))?$/u.exec(errorMessage);

  if (wrappedMessageMatch === null) {
    return null;
  }

  const wrappedMessage = wrappedMessageMatch[1]?.trim() ?? '';
  const wrappedMessageSummary = wrappedMessage.split(/\r?\n/u, 1)[0]?.trim() ?? '';

  if (wrappedMessageSummary === '' || wrappedMessageSummary === 'Error') {
    return '';
  }

  if (wrappedMessage.startsWith('Error: ')) {
    const normalizedWrappedMessage = wrappedMessage.slice('Error: '.length).trim();
    const normalizedWrappedMessageSummary =
      normalizedWrappedMessage.split(/\r?\n/u, 1)[0]?.trim() ?? '';

    return normalizedWrappedMessageSummary === '' || normalizedWrappedMessageSummary === 'Error'
      ? ''
      : normalizedWrappedMessageSummary;
  }

  return wrappedMessageSummary;
}

function resolveWorkerStatusLabel(status: ReadinessRouteViewModel['status']) {
  if (status === 'ready') {
    return 'Connected';
  }

  if (status === 'sign_in_required') {
    return 'Sign in needed';
  }

  if (status === 'unavailable') {
    return 'Needs attention';
  }

  return 'Checking';
}

function resolveWorkerStatusTone(
  status: ReadinessRouteViewModel['status'],
): 'danger' | 'muted' | 'ready' | 'warning' {
  if (status === 'ready') {
    return 'ready';
  }

  if (status === 'sign_in_required') {
    return 'warning';
  }

  if (status === 'unavailable') {
    return 'danger';
  }

  return 'muted';
}
