import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from 'react'
import { flushSync } from 'react-dom'

import {
  mapReadinessRouteViewModel,
  type ReadinessRouteViewModel,
} from '../readiness/readiness-route.js'
import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type { OriginalCvImportResult, OriginalCvWorkspaceState } from '../shared/original-cv.js'
import type {
  CompletePendingGenerationResult,
  PendingGenerationCommand,
} from '../shared/pending-generation.js'
import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../shared/settings.js'
import type { StartupDestination } from '../shared/startup-destination.js'
import type { TailoredApplicationWorkspaceState } from '../shared/tailored-application.js'
import type { WorkspaceSelection } from '../shared/workspace-selection.js'
import type { VacancyDraft, VacancyIngestResult, VacancySummary } from '../shared/vacancy.js'
import { AiWorkerCheckingScreen } from './screens/ai-worker-checking-screen.js'
import { AiWorkerSignInRequiredScreen } from './screens/ai-worker-sign-in-required-screen.js'
import { AiWorkerUnavailableScreen } from './screens/ai-worker-unavailable-screen.js'
import { FirstLaunchScreen } from './screens/first-launch-screen.js'
import { SettingsScreen, type SettingsSection } from './screens/settings-screen.js'
import { WorkspaceScreen } from './screens/workspace-screen.js'
import {
  getOriginalCvWorkspaceStateQueryOptions,
  getPendingGenerationCommandQueryOptions,
  getReadinessViewModelQueryOptions,
  getSettingsSnapshotQueryOptions,
  getTailoredApplicationPreviewQueryOptions,
  getTailoredApplicationWorkspaceStateQueryOptions,
  getVacancyWorkspaceStateQueryOptions,
  rendererQueryKeys,
} from './app-queries.js'
import { resolveRendererLoadingState } from './loading/resolve-renderer-loading-state.js'
import { WorkspaceBlockingOverlay } from './loading/workspace-blocking-overlay.js'
import { resolveRendererScreen, type RendererScreenKind } from './routing/renderer-screen.js'
import { Button } from './ui/button.js'
import { Dialog } from './ui/dialog.js'

const initialReadinessViewModel: ReadinessRouteViewModel = {
  body: 'Getting AI ready before you enter the app.',
  canEnterWorkspace: false,
  diagnostic: 'Checking your AI connection on this Mac.',
  heading: 'Connect AI',
  primaryActionLabel: undefined,
  secondaryActionLabel: undefined,
  startupDestination: undefined,
  status: 'checking',
}

const initialOriginalCvWorkspaceState: OriginalCvWorkspaceState = {
  activeOriginalCv: null,
  snapshotCount: 0,
}

const initialTailoredApplicationWorkspaceState: TailoredApplicationWorkspaceState = {
  activeApplicationId: null,
  applications: [],
}

const initialVacancyDraft: VacancyDraft = {
  text: '',
  url: '',
}

const initialVacancyWorkspaceState = {
  draft: initialVacancyDraft,
  reviewState: 'editable' as const,
  vacancy: null,
}

const readinessErrorMessage = "We couldn't check AI."
const readinessErrorAction = 'Restart the app or get help with AI setup on this Mac.'
const originalCvFileTypeErrorMessage = 'Choose a PDF or DOCX file.'

function isSupportedOriginalCvFile(file: File): boolean {
  const normalizedName = file.name.toLowerCase()

  return (
    normalizedName.endsWith('.pdf') ||
    normalizedName.endsWith('.docx') ||
    file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

type OriginalCvImportDestination = 'workspace'
type RendererStartupDestinationOverride = OriginalCvImportDestination
type PreviewDocumentKind = 'adapted_cv' | 'cover_letter'
type WorkspaceSection = 'settings' | 'workspace'
type WorkspaceSelectionOverride = 'draft' | null
type WorkspaceSelectionKind = 'draft' | 'tailored_application'
type ImportOriginalCvMutationResult = OriginalCvImportResult

export function App() {
  const queryClient = useQueryClient()
  const [activeWorkspaceSection, setActiveWorkspaceSection] =
    useState<WorkspaceSection>('workspace')
  const [isDeleteTailoredApplicationDialogOpen, setIsDeleteTailoredApplicationDialogOpen] =
    useState(false)
  const [isConfirmingDraftDiscard, setIsConfirmingDraftDiscard] = useState(false)
  const [isCopyingCoverLetterText, setIsCopyingCoverLetterText] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [isResetLocalAppDataDialogOpen, setIsResetLocalAppDataDialogOpen] = useState(false)
  const [isSecondaryActionPending, setIsSecondaryActionPending] = useState(false)
  const [originalCvFile, setOriginalCvFile] = useState<File | null>(null)
  const [previewDocumentKind, setPreviewDocumentKind] = useState<PreviewDocumentKind>('adapted_cv')
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [resetConfirmationPhrase, setResetConfirmationPhrase] = useState('')
  const [selectedTailoredApplicationId, setSelectedTailoredApplicationId] = useState<string | null>(
    null,
  )
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('ai_worker')
  const [startupDestinationOverride, setStartupDestinationOverride] =
    useState<RendererStartupDestinationOverride | null>(null)
  const [workspaceSelectionOverride, setWorkspaceSelectionOverride] =
    useState<WorkspaceSelectionOverride>(null)
  const [vacancyDraft, setVacancyDraft] = useState(initialVacancyDraft)
  const [vacancyPreviewOverride, setVacancyPreviewOverride] = useState<VacancySummary | null>(null)
  const [vacancyReviewError, setVacancyReviewError] = useState<string | null>(null)
  const isResumingPendingGeneration = useRef(false)
  const lastResumedCommandId = useRef<string | null>(null)

  const readinessQuery = useQuery({
    ...getReadinessViewModelQueryOptions(),
    placeholderData: initialReadinessViewModel,
  })
  const baseReadinessViewModel = readinessQuery.data ?? initialReadinessViewModel
  const viewModel = applyStartupDestinationOverride({
    readinessViewModel: baseReadinessViewModel,
    startupDestinationOverride,
  })
  const settingsQuery = useQuery({
    ...getSettingsSnapshotQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
  })
  const settingsSnapshot = settingsQuery.data ?? null
  const originalCvWorkspaceQuery = useQuery({
    ...getOriginalCvWorkspaceStateQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: initialOriginalCvWorkspaceState,
  })
  const originalCvWorkspaceState = originalCvWorkspaceQuery.data ?? initialOriginalCvWorkspaceState
  const vacancyWorkspaceQuery = useQuery({
    ...getVacancyWorkspaceStateQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: initialVacancyWorkspaceState,
  })
  const vacancyWorkspaceState = vacancyWorkspaceQuery.data ?? initialVacancyWorkspaceState
  const tailoredApplicationWorkspaceQuery = useQuery({
    ...getTailoredApplicationWorkspaceStateQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: initialTailoredApplicationWorkspaceState,
  })
  const tailoredApplicationWorkspaceState =
    tailoredApplicationWorkspaceQuery.data ?? initialTailoredApplicationWorkspaceState
  const reviewedVacancyPreview = vacancyWorkspaceState.vacancy ?? vacancyPreviewOverride
  const isCurrentDraftMeaningful = isVacancyDraftMeaningful({
    draft: vacancyDraft,
    vacancyPreview: reviewedVacancyPreview,
  })
  const resolvedTailoredApplicationId = resolveTailoredApplicationId({
    preferredTailoredApplicationId: selectedTailoredApplicationId,
    workspaceState: tailoredApplicationWorkspaceState,
  })
  const selectedTailoredApplication =
    resolvedTailoredApplicationId === null
      ? null
      : (tailoredApplicationWorkspaceState.applications.find((application) => {
          return application.id === resolvedTailoredApplicationId
        }) ?? null)
  const pendingGenerationQuery = useQuery({
    ...getPendingGenerationCommandQueryOptions(),
    enabled: viewModel.canEnterWorkspace,
    placeholderData: null,
  })
  const pendingGenerationCommand = pendingGenerationQuery.data ?? null
  const workspaceSelection = resolveWorkspaceSelection({
    forcedSelection: workspaceSelectionOverride,
    hasMeaningfulDraft: isCurrentDraftMeaningful,
    hasPendingGeneration: pendingGenerationCommand !== null,
    resolvedTailoredApplicationId,
  })
  const tailoredApplicationPreviewQuery = useQuery({
    ...getTailoredApplicationPreviewQueryOptions(resolvedTailoredApplicationId ?? ''),
    enabled:
      viewModel.canEnterWorkspace &&
      workspaceSelection.kind === 'tailored_application' &&
      resolvedTailoredApplicationId !== null,
    placeholderData: (previousPreview) => {
      return previousPreview
    },
  })
  const tailoredApplicationPreview =
    workspaceSelection.kind === 'tailored_application'
      ? (tailoredApplicationPreviewQuery.data ?? null)
      : null

  const invalidateReadinessQuery = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: rendererQueryKeys.readiness,
    })
  }

  const invalidateWorkspaceQueries = async (): Promise<void> => {
    await Promise.all([
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
        queryKey: rendererQueryKeys.vacancyWorkspace,
      }),
    ])
  }

  const seedReadinessQuery = async ({
    preflightResult,
    startupDestination,
  }: {
    preflightResult: AiWorkerPreflightResult
    startupDestination?: StartupDestination
  }): Promise<void> => {
    await queryClient.cancelQueries({
      queryKey: rendererQueryKeys.readiness,
    })

    const resolvedStartupDestination =
      preflightResult.status === 'ready'
        ? (startupDestination ??
          (await globalThis.window.cvMaxxing.aiWorker.getStartupDestination()))
        : undefined

    queryClient.setQueryData(
      rendererQueryKeys.readiness,
      mapReadinessRouteViewModel({
        preflight: preflightResult,
        startupDestination: resolvedStartupDestination,
      }),
    )
  }

  const applyVacancyIngestResult = async (result: VacancyIngestResult): Promise<void> => {
    queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, result.workspaceState)
    setVacancyPreviewOverride(result.workspaceState.vacancy === null ? result.vacancy : null)
    await queryClient.invalidateQueries({
      queryKey: rendererQueryKeys.vacancyWorkspace,
    })
  }

  const aiWorkerStatusMutation = useMutation({
    mutationFn: async (action: 'retry' | 'sign_in'): Promise<AiWorkerPreflightResult> => {
      if (action === 'sign_in') {
        return await globalThis.window.cvMaxxing.aiWorker.startAiWorkerSignIn()
      }

      return await globalThis.window.cvMaxxing.aiWorker.retryAiWorkerPreflight()
    },
    onSuccess: async (preflightResult): Promise<void> => {
      setReadinessError(null)
      setStartupDestinationOverride(null)
      await seedReadinessQuery({
        preflightResult,
      })

      if (preflightResult.status !== 'ready') {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.settings,
        }),
        invalidateWorkspaceQueries(),
      ])
    },
  })
  const clearJobSiteBrowserDataMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await globalThis.window.cvMaxxing.settings.clearJobSiteBrowserData()
    },
  })
  const resetLocalAppDataMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await globalThis.window.cvMaxxing.settings.resetLocalAppData({
        confirmationPhrase: resetConfirmationPhrase,
      })
    },
    onSuccess: async (): Promise<void> => {
      setActiveWorkspaceSection('workspace')
      setIsDeleteTailoredApplicationDialogOpen(false)
      setIsConfirmingDraftDiscard(false)
      setImportError(null)
      setIsResetLocalAppDataDialogOpen(false)
      setOriginalCvFile(null)
      setPreviewDocumentKind('adapted_cv')
      setReadinessError(null)
      setResetConfirmationPhrase('')
      setSelectedTailoredApplicationId(null)
      setSettingsMessage(null)
      setStartupDestinationOverride(null)
      setWorkspaceSelectionOverride(null)
      setVacancyDraft(initialVacancyDraft)
      setVacancyPreviewOverride(null)
      setVacancyReviewError(null)
      queryClient.setQueryData(rendererQueryKeys.readiness, initialReadinessViewModel)
      queryClient.setQueryData(
        rendererQueryKeys.originalCvWorkspace,
        initialOriginalCvWorkspaceState,
      )
      queryClient.setQueryData(rendererQueryKeys.pendingGeneration, null)
      queryClient.setQueryData(
        rendererQueryKeys.tailoredApplicationWorkspace,
        initialTailoredApplicationWorkspaceState,
      )
      queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, initialVacancyWorkspaceState)
      queryClient.removeQueries({
        queryKey: rendererQueryKeys.settings,
      })
      queryClient.removeQueries({
        queryKey: rendererQueryKeys.tailoredApplicationPreviewRoot,
      })
      await Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.settings,
        }),
        invalidateWorkspaceQueries(),
      ])
    },
  })
  const importOriginalCvMutation = useMutation({
    mutationFn: async ({
      file,
    }: {
      file: File
      nextStartupDestination: OriginalCvImportDestination
    }): Promise<ImportOriginalCvMutationResult> => {
      return await globalThis.window.cvMaxxing.originalCv.importOriginalCv({
        content: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
      })
    },
    onSuccess: async (result, { nextStartupDestination }): Promise<void> => {
      if (result.kind === 'ai_worker_not_ready') {
        setImportError(null)
        setReadinessError(null)
        await seedReadinessQuery({
          preflightResult: result.preflight,
        })

        return
      }

      if (result.kind === 'rejected') {
        setImportError(result.error.message)

        return
      }

      setImportError(null)
      setIsConfirmingDraftDiscard(false)
      setOriginalCvFile(null)
      setPreviewDocumentKind('adapted_cv')
      setReadinessError(null)
      setStartupDestinationOverride(nextStartupDestination)
      setWorkspaceSelectionOverride('draft')
      setVacancyReviewError(null)
      setVacancyPreviewOverride(null)
      queryClient.setQueryData(rendererQueryKeys.originalCvWorkspace, {
        activeOriginalCv: result.originalCv,
        snapshotCount: result.originalCv.snapshotCount,
      })
      await globalThis.window.cvMaxxing.vacancy.clearVacancyWorkspaceState()
      queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, initialVacancyWorkspaceState)
      await Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.originalCvWorkspace,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.vacancyWorkspace,
        }),
      ])
    },
  })
  const persistWorkspaceSelectionMutation = useMutation({
    mutationFn: async (selection: WorkspaceSelection): Promise<void> => {
      await globalThis.window.cvMaxxing.tailoredApplication.setWorkspaceSelection(selection)
    },
  })
  const reviewVacancyUrlMutation = useMutation({
    mutationFn: async (): Promise<VacancyIngestResult> => {
      const result = await globalThis.window.cvMaxxing.vacancy.ingestVacancyUrl({
        url: vacancyDraft.url.trim(),
      })

      const browserSessionUrl = resolveAutoBrowserSessionUrl(result)

      if (browserSessionUrl === null) {
        return result
      }

      return await globalThis.window.cvMaxxing.vacancy.openVacancyBrowserSession({
        url: browserSessionUrl,
      })
    },
    onSuccess: async (result): Promise<void> => {
      setReadinessError(null)
      setVacancyReviewError(null)
      await applyVacancyIngestResult(result)
    },
  })
  const reviewPastedVacancyMutation = useMutation({
    mutationFn: async (): Promise<VacancyIngestResult> => {
      return await globalThis.window.cvMaxxing.vacancy.ingestPastedVacancy({
        text: vacancyDraft.text.trim(),
        url: vacancyDraft.url.trim() === '' ? undefined : vacancyDraft.url.trim(),
      })
    },
    onSuccess: async (result): Promise<void> => {
      setReadinessError(null)
      setVacancyReviewError(null)
      await applyVacancyIngestResult(result)
    },
  })
  const openVacancyBrowserSessionMutation = useMutation({
    mutationFn: async (url: string): Promise<VacancyIngestResult> => {
      return await globalThis.window.cvMaxxing.vacancy.openVacancyBrowserSession({
        url,
      })
    },
    onSuccess: async (result): Promise<void> => {
      setReadinessError(null)
      setVacancyReviewError(null)
      await applyVacancyIngestResult(result)
    },
  })
  const clearVacancyWorkspaceMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await globalThis.window.cvMaxxing.vacancy.clearVacancyWorkspaceState()
    },
    onSuccess: async (): Promise<void> => {
      setReadinessError(null)
      setVacancyReviewError(null)
      setVacancyPreviewOverride(null)
      queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, initialVacancyWorkspaceState)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.vacancyWorkspace,
        }),
      ])
    },
  })
  const startPendingGenerationMutation = useMutation({
    mutationFn: async (
      nextVacancyDraft: PendingGenerationCommand['vacancyDraft'],
    ): Promise<AiWorkerPreflightResult> => {
      const activeOriginalCv = originalCvWorkspaceState.activeOriginalCv

      if (activeOriginalCv === null) {
        throw new Error('An active original CV is required before adaptation can begin.')
      }

      return await globalThis.window.cvMaxxing.tailoredApplication.startPendingGeneration({
        originalCvId: activeOriginalCv.id,
        originalCvLabel: activeOriginalCv.originalFilename,
        vacancyDraft: nextVacancyDraft,
      })
    },
    onSuccess: async (preflightResult): Promise<void> => {
      flushSync(() => {
        setReadinessError(null)
        setSelectedTailoredApplicationId(null)
        setStartupDestinationOverride('workspace')
        setWorkspaceSelectionOverride('draft')
        setVacancyPreviewOverride(null)
      })

      await seedReadinessQuery({
        preflightResult,
        startupDestination: preflightResult.status === 'ready' ? 'workspace' : undefined,
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.pendingGeneration,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
        }),
      ])
    },
  })
  const completePendingGenerationMutation = useMutation({
    mutationFn: async ({
      commandId,
    }: {
      commandId: string
      tailoredApplicationId: string | null
    }): Promise<CompletePendingGenerationResult> => {
      return await globalThis.window.cvMaxxing.tailoredApplication.completePendingGeneration(
        commandId,
      )
    },
    onSuccess: ({ workspaceState }, { tailoredApplicationId }): void => {
      const nextSelectedTailoredApplicationId =
        workspaceState.activeApplicationId ?? tailoredApplicationId

      flushSync(() => {
        setIsDeleteTailoredApplicationDialogOpen(false)
        setPreviewDocumentKind('adapted_cv')
        setReadinessError(null)
        setSelectedTailoredApplicationId(nextSelectedTailoredApplicationId)
        setStartupDestinationOverride('workspace')
        setWorkspaceSelectionOverride(null)
        setVacancyDraft(initialVacancyDraft)
        setVacancyPreviewOverride(null)
      })

      queryClient.setQueryData(rendererQueryKeys.pendingGeneration, null)
      queryClient.setQueryData(rendererQueryKeys.tailoredApplicationWorkspace, workspaceState)
      queryClient.setQueryData(rendererQueryKeys.vacancyWorkspace, initialVacancyWorkspaceState)

      if (nextSelectedTailoredApplicationId !== null) {
        queryClient
          .prefetchQuery(
            getTailoredApplicationPreviewQueryOptions(nextSelectedTailoredApplicationId),
          )
          .catch(() => null)
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
        setReadinessError(
          resolveErrorMessage(error, `${readinessErrorMessage} ${readinessErrorAction}`),
        )
      })
    },
  })
  const deleteTailoredApplicationMutation = useMutation({
    mutationFn: async (tailoredApplicationId: string): Promise<void> => {
      await globalThis.window.cvMaxxing.tailoredApplication.deleteTailoredApplication(
        tailoredApplicationId,
      )
    },
    onSuccess: async (_data, tailoredApplicationId): Promise<void> => {
      if (selectedTailoredApplicationId === tailoredApplicationId) {
        setSelectedTailoredApplicationId(null)
      }

      setIsDeleteTailoredApplicationDialogOpen(false)
      setPreviewDocumentKind('adapted_cv')
      setReadinessError(null)
      await Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationPreviewRoot,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
        }),
      ])
    },
  })
  const exportPdfMutation = useMutation({
    mutationFn: async (nextPreviewDocumentKind: PreviewDocumentKind): Promise<void> => {
      if (tailoredApplicationPreview === null) {
        throw new Error('A tailored application preview is required before exporting a PDF.')
      }

      if (nextPreviewDocumentKind === 'adapted_cv') {
        await globalThis.window.cvMaxxing.tailoredApplication.exportAdaptedCvPdf(
          tailoredApplicationPreview.id,
        )

        return
      }

      await globalThis.window.cvMaxxing.tailoredApplication.exportCoverLetterPdf(
        tailoredApplicationPreview.id,
      )
    },
  })
  const abandonPendingGenerationMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await globalThis.window.cvMaxxing.tailoredApplication.abandonPendingGeneration()
    },
    onSuccess: async (): Promise<void> => {
      setReadinessError(null)
      setStartupDestinationOverride(null)
      setWorkspaceSelectionOverride('draft')
      setVacancyPreviewOverride(null)
      await Promise.all([
        invalidateReadinessQuery(),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.pendingGeneration,
        }),
        queryClient.invalidateQueries({
          queryKey: rendererQueryKeys.vacancyWorkspace,
        }),
      ])
    },
  })
  const isClearingJobSiteBrowserData = clearJobSiteBrowserDataMutation.isPending
  const isImportingOriginalCv = importOriginalCvMutation.isPending
  const isOpeningVacancyBrowser = openVacancyBrowserSessionMutation.isPending
  const isPendingGenerationActionPending =
    abandonPendingGenerationMutation.isPending ||
    completePendingGenerationMutation.isPending ||
    deleteTailoredApplicationMutation.isPending ||
    exportPdfMutation.isPending ||
    startPendingGenerationMutation.isPending
  const isResettingLocalAppData = resetLocalAppDataMutation.isPending
  const isSubmittingPrimaryAction = aiWorkerStatusMutation.isPending
  const isSubmittingVacancyReview =
    reviewPastedVacancyMutation.isPending || reviewVacancyUrlMutation.isPending
  const previewedVacancyDraft = reviewedVacancyPreview === null ? null : vacancyWorkspaceState.draft
  const vacancyPreview = isVacancyDraftReviewed(vacancyDraft, previewedVacancyDraft)
    ? reviewedVacancyPreview
    : null
  const draftReviewState =
    vacancyPreview === null
      ? initialVacancyWorkspaceState.reviewState
      : vacancyWorkspaceState.reviewState
  const queriedVacancyDraft = vacancyWorkspaceState.draft

  useEffect(() => {
    setVacancyDraft(queriedVacancyDraft)
  }, [queriedVacancyDraft])

  useEffect(() => {
    if (vacancyWorkspaceState.vacancy === null) {
      return
    }

    setVacancyPreviewOverride(null)
  }, [vacancyWorkspaceState.vacancy])

  useEffect(() => {
    if (!viewModel.canEnterWorkspace) {
      setActiveWorkspaceSection('workspace')
    }
  }, [viewModel.canEnterWorkspace])

  useEffect(() => {
    if (workspaceSelection.kind === 'tailored_application') {
      return
    }

    setIsDeleteTailoredApplicationDialogOpen(false)
    setPreviewDocumentKind('adapted_cv')
  }, [workspaceSelection.kind])

  useEffect(() => {
    if (isCurrentDraftMeaningful) {
      return
    }

    setIsConfirmingDraftDiscard(false)
  }, [isCurrentDraftMeaningful])

  useEffect(() => {
    const nextError =
      readinessQuery.error ??
      settingsQuery.error ??
      originalCvWorkspaceQuery.error ??
      vacancyWorkspaceQuery.error ??
      tailoredApplicationWorkspaceQuery.error ??
      pendingGenerationQuery.error ??
      tailoredApplicationPreviewQuery.error ??
      null

    if (nextError === null) {
      return
    }

    setReadinessError(
      resolveErrorMessage(nextError, `${readinessErrorMessage} ${readinessErrorAction}`),
    )
  }, [
    originalCvWorkspaceQuery.error,
    pendingGenerationQuery.error,
    readinessQuery.error,
    settingsQuery.error,
    tailoredApplicationPreviewQuery.error,
    tailoredApplicationWorkspaceQuery.error,
    vacancyWorkspaceQuery.error,
  ])

  const handlePrimaryAction = async (): Promise<void> => {
    if (viewModel.primaryActionLabel === undefined || aiWorkerStatusMutation.isPending) {
      return
    }

    const action: 'retry' | 'sign_in' =
      viewModel.status === 'sign_in_required' ? 'sign_in' : 'retry'

    try {
      await aiWorkerStatusMutation.mutateAsync(action)
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    }
  }

  const handleSecondaryAction = async (): Promise<void> => {
    if (isSecondaryActionPending) {
      return
    }

    setIsSecondaryActionPending(true)

    try {
      await globalThis.window.cvMaxxing.aiWorker.openAiWorkerSetupGuide()
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    } finally {
      setIsSecondaryActionPending(false)
    }
  }

  const handleSelectRailItem = (item: 'job_vacancies' | 'original_cv' | 'settings' | 'setup') => {
    if (item === 'settings') {
      setActiveWorkspaceSection('settings')
      setSettingsMessage(null)

      return
    }

    if (viewModel.canEnterWorkspace) {
      setActiveWorkspaceSection('workspace')
      setSettingsMessage(null)
    }
  }

  const handleClearJobSiteBrowserData = async (): Promise<void> => {
    if (clearJobSiteBrowserDataMutation.isPending) {
      return
    }

    try {
      await clearJobSiteBrowserDataMutation.mutateAsync()
      setSettingsMessage('Job-site browser data cleared.')
    } catch (error) {
      setSettingsMessage(
        resolveErrorMessage(error, "We couldn't clear your job-site browser data."),
      )
    }
  }

  const handleOpenResetLocalAppDataDialog = (): void => {
    if (resetLocalAppDataMutation.isPending) {
      return
    }

    setIsResetLocalAppDataDialogOpen(true)
  }

  const handleResetLocalAppData = async (): Promise<void> => {
    if (resetLocalAppDataMutation.isPending) {
      return
    }

    setIsResetLocalAppDataDialogOpen(false)

    try {
      await resetLocalAppDataMutation.mutateAsync()
    } catch (error) {
      setSettingsMessage(
        resolveErrorMessage(error, "We couldn't reset your local data on this Mac."),
      )
    }
  }

  const handleOriginalCvImport = async (
    nextStartupDestination: OriginalCvImportDestination,
  ): Promise<void> => {
    if (originalCvFile === null || importOriginalCvMutation.isPending) {
      return
    }

    setImportError(null)
    setReadinessError(null)

    try {
      await importOriginalCvMutation.mutateAsync({
        file: originalCvFile,
        nextStartupDestination,
      })
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    }
  }

  const handleOriginalCvFile = (nextFile: File | null): void => {
    if (nextFile === null) {
      setImportError(null)
      setOriginalCvFile(null)

      return
    }

    if (!isSupportedOriginalCvFile(nextFile)) {
      setImportError(originalCvFileTypeErrorMessage)
      setOriginalCvFile(null)

      return
    }

    setImportError(null)
    setOriginalCvFile(nextFile)
  }

  const handleOriginalCvSelection = (event: ChangeEvent<HTMLInputElement>): void => {
    handleOriginalCvFile(event.target.files?.[0] ?? null)
  }

  const handleOriginalCvDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    handleOriginalCvFile(event.dataTransfer.files[0] ?? null)
  }

  const handleStartPendingGeneration = async (
    vacancyDraft: PendingGenerationCommand['vacancyDraft'],
  ): Promise<void> => {
    const activeOriginalCv = originalCvWorkspaceState.activeOriginalCv

    if (activeOriginalCv === null || startPendingGenerationMutation.isPending) {
      return
    }

    setReadinessError(null)

    try {
      await startPendingGenerationMutation.mutateAsync(vacancyDraft)
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    }
  }

  const handleExportAdaptedCvPdf = async (): Promise<void> => {
    if (tailoredApplicationPreview === null || exportPdfMutation.isPending) {
      return
    }

    try {
      await exportPdfMutation.mutateAsync(previewDocumentKind)
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    }
  }

  const handleSelectTailoredApplication = (tailoredApplicationId: string): void => {
    if (tailoredApplicationPreview?.id === tailoredApplicationId || exportPdfMutation.isPending) {
      return
    }

    setIsDeleteTailoredApplicationDialogOpen(false)
    setPreviewDocumentKind('adapted_cv')
    setReadinessError(null)
    setSelectedTailoredApplicationId(tailoredApplicationId)
    setWorkspaceSelectionOverride(null)
  }

  const handleOpenDeleteTailoredApplicationDialog = (): void => {
    if (tailoredApplicationPreview === null || deleteTailoredApplicationMutation.isPending) {
      return
    }

    setIsDeleteTailoredApplicationDialogOpen(true)
  }

  const handleDeleteTailoredApplication = async (): Promise<void> => {
    if (tailoredApplicationPreview === null || deleteTailoredApplicationMutation.isPending) {
      return
    }

    try {
      await deleteTailoredApplicationMutation.mutateAsync(tailoredApplicationPreview.id)
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    }
  }

  const showBlankDraftWorkspace = (): void => {
    setIsDeleteTailoredApplicationDialogOpen(false)
    setIsConfirmingDraftDiscard(false)
    setPreviewDocumentKind('adapted_cv')
    setReadinessError(null)
    setSelectedTailoredApplicationId(null)
    setStartupDestinationOverride('workspace')
    setWorkspaceSelectionOverride('draft')
    setVacancyDraft(initialVacancyDraft)
    setVacancyPreviewOverride(null)
    setVacancyReviewError(null)
  }

  const handleCreateVacancy = async (): Promise<void> => {
    if (clearVacancyWorkspaceMutation.isPending) {
      return
    }

    if (isCurrentDraftMeaningful) {
      setIsConfirmingDraftDiscard(true)

      return
    }

    try {
      await clearVacancyWorkspaceMutation.mutateAsync()
      showBlankDraftWorkspace()
    } catch (error) {
      setVacancyReviewError(resolveErrorMessage(error, "We couldn't clear this job draft."))
    }
  }

  const handleConfirmDraftDiscard = async (): Promise<void> => {
    if (clearVacancyWorkspaceMutation.isPending) {
      return
    }

    try {
      await clearVacancyWorkspaceMutation.mutateAsync()
      showBlankDraftWorkspace()
    } catch (error) {
      setVacancyReviewError(resolveErrorMessage(error, "We couldn't clear this job draft."))
    }
  }

  const handleCopyCoverLetterText = async (): Promise<void> => {
    if (tailoredApplicationPreview === null || isCopyingCoverLetterText) {
      return
    }

    setIsCopyingCoverLetterText(true)

    try {
      await globalThis.navigator.clipboard.writeText(
        tailoredApplicationPreview.coverLetter.plainText,
      )
      setReadinessError(null)
    } catch {
      setReadinessError("We couldn't copy the cover letter text.")
    } finally {
      setIsCopyingCoverLetterText(false)
    }
  }

  const handleAbandonDraft = async (): Promise<void> => {
    if (abandonPendingGenerationMutation.isPending) {
      return
    }

    try {
      await abandonPendingGenerationMutation.mutateAsync()
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    }
  }

  const screenKind =
    viewModel.canEnterWorkspace && pendingGenerationCommand !== null
      ? 'workspace'
      : resolveRendererScreen({
          originalCvWorkspaceState,
          readinessViewModel: viewModel,
        })

  const workerStatusLabel = resolveWorkerStatusLabel(viewModel.status)
  const workerStatusTone = resolveWorkerStatusTone(viewModel.status)
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
  })
  const ambientActivityLabel =
    rendererLoadingState.scope === 'ambient' ? rendererLoadingState.label : null
  const appOverlay =
    rendererLoadingState.scope === 'app_blocking' ? (
      <WorkspaceBlockingOverlay title="Preparing app" />
    ) : null
  let workspaceOverlay = null

  if (rendererLoadingState.scope === 'workspace_blocking') {
    workspaceOverlay =
      rendererLoadingState.kind === 'tailored_application_generation' ? (
        <WorkspaceBlockingOverlay
          isSecondaryActionPending={isPendingGenerationActionPending}
          onSecondaryAction={() => {
            handleAbandonDraft().catch(() => null)
          }}
          secondaryActionLabel="Cancel"
          title={rendererLoadingState.label}
        />
      ) : (
        <WorkspaceBlockingOverlay title={rendererLoadingState.label} />
      )
  }

  const resumePendingGeneration = useEffectEvent(async (): Promise<void> => {
    if (
      !viewModel.canEnterWorkspace ||
      viewModel.status !== 'ready' ||
      pendingGenerationCommand === null
    ) {
      return
    }

    try {
      const result = await globalThis.window.cvMaxxing.tailoredApplication.resumePendingGeneration()

      await completePendingGenerationMutation.mutateAsync({
        commandId: pendingGenerationCommand.commandId,
        tailoredApplicationId: result.tailoredApplicationId,
      })
    } catch (error) {
      flushSync(() => {
        setStartupDestinationOverride('workspace')
        setReadinessError(
          resolveErrorMessage(error, `${readinessErrorMessage} ${readinessErrorAction}`),
        )
        setSelectedTailoredApplicationId(null)
        setWorkspaceSelectionOverride('draft')
        setVacancyPreviewOverride(null)
      })

      queryClient.setQueryData(rendererQueryKeys.pendingGeneration, null)

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
      })
    }
  })

  useEffect(() => {
    if (
      !viewModel.canEnterWorkspace ||
      viewModel.status !== 'ready' ||
      pendingGenerationCommand === null
    ) {
      return
    }

    if (
      isResumingPendingGeneration.current ||
      lastResumedCommandId.current === pendingGenerationCommand.commandId
    ) {
      return
    }

    isResumingPendingGeneration.current = true
    lastResumedCommandId.current = pendingGenerationCommand.commandId
    let didStartResume = false
    const resumeAnimationFrameId = globalThis.window.requestAnimationFrame(() => {
      didStartResume = true
      resumePendingGeneration()
        .catch(() => {
          lastResumedCommandId.current = null
        })
        .finally(() => {
          isResumingPendingGeneration.current = false
        })
    })

    return () => {
      globalThis.window.cancelAnimationFrame(resumeAnimationFrameId)

      if (!didStartResume) {
        lastResumedCommandId.current = null
        isResumingPendingGeneration.current = false
      }
    }
  }, [pendingGenerationCommand, viewModel.canEnterWorkspace, viewModel.status])

  const screenRegistry: Record<RendererScreenKind, () => ReactElement> = {
    ai_worker_checking: () => {
      return (
        <AiWorkerCheckingScreen
          onOpenSetupGuide={() => {
            handleSecondaryAction().catch(() => null)
          }}
          readinessError={readinessError}
          viewModel={viewModel}
        />
      )
    },
    ai_worker_sign_in_required: () => {
      return (
        <AiWorkerSignInRequiredScreen
          isPrimaryActionPending={isSubmittingPrimaryAction}
          isSecondaryActionPending={isSecondaryActionPending}
          onPrimaryAction={() => {
            handlePrimaryAction().catch(() => null)
          }}
          onSecondaryAction={() => {
            handleSecondaryAction().catch(() => null)
          }}
          readinessError={readinessError}
          viewModel={viewModel}
        />
      )
    },
    ai_worker_unavailable: () => {
      return (
        <AiWorkerUnavailableScreen
          isPrimaryActionPending={isSubmittingPrimaryAction}
          isSecondaryActionPending={isSecondaryActionPending}
          onPrimaryAction={() => {
            handlePrimaryAction().catch(() => null)
          }}
          onSecondaryAction={() => {
            handleSecondaryAction().catch(() => null)
          }}
          readinessError={readinessError}
          viewModel={viewModel}
        />
      )
    },
    first_launch: () => {
      return (
        <FirstLaunchScreen
          importError={importError}
          isImportingOriginalCv={isImportingOriginalCv}
          onFileDrop={handleOriginalCvDrop}
          onFileSelection={handleOriginalCvSelection}
          onImportOriginalCv={() => {
            handleOriginalCvImport('workspace').catch(() => null)
          }}
          onSelectRailItem={handleSelectRailItem}
          originalCvFile={originalCvFile}
          workspaceOverlay={workspaceOverlay}
        />
      )
    },
    workspace: () => {
      return (
        <>
          <WorkspaceScreen
            activeOriginalCv={originalCvWorkspaceState.activeOriginalCv}
            ambientActivityLabel={ambientActivityLabel}
            applicationTitle={selectedTailoredApplication?.title ?? null}
            applications={tailoredApplicationWorkspaceState.applications}
            draftReviewState={draftReviewState}
            importError={importError}
            isAdaptingCv={isPendingGenerationActionPending}
            isCopyingCoverLetterText={isCopyingCoverLetterText}
            isCurrentDraftMeaningful={isCurrentDraftMeaningful}
            isExportingPdf={isPendingGenerationActionPending}
            isImportingOriginalCv={isImportingOriginalCv}
            isOpeningVacancyBrowser={isOpeningVacancyBrowser}
            isReviewingVacancy={isSubmittingVacancyReview}
            onAdaptCv={() => {
              if (previewedVacancyDraft === null || vacancyPreview?.canGenerate !== true) {
                return
              }

              handleStartPendingGeneration(previewedVacancyDraft).catch(() => null)
            }}
            onOpenVacancyBrowserSession={() => {
              const originalUrl = vacancyPreview?.originalUrl

              if (originalUrl === undefined || originalUrl === null || isOpeningVacancyBrowser) {
                return
              }

              setReadinessError(null)
              setVacancyReviewError(null)

              openVacancyBrowserSessionMutation.mutateAsync(originalUrl).catch((error: unknown) => {
                setVacancyReviewError(
                  resolveErrorMessage(error, "We couldn't open the job page right now."),
                )
              })
            }}
            onCopyCoverLetterText={() => {
              handleCopyCoverLetterText().catch(() => null)
            }}
            onCreateVacancy={() => {
              handleCreateVacancy().catch(() => null)
            }}
            onDeleteTailoredApplication={() => {
              handleOpenDeleteTailoredApplicationDialog()
            }}
            onExportPdf={() => {
              handleExportAdaptedCvPdf().catch(() => null)
            }}
            onReviewPastedVacancy={() => {
              if (isSubmittingVacancyReview) {
                return
              }

              setReadinessError(null)
              setVacancyReviewError(null)

              reviewPastedVacancyMutation.mutateAsync().catch((error: unknown) => {
                setVacancyReviewError(
                  resolveErrorMessage(error, "We couldn't check the pasted job description."),
                )
              })
            }}
            onReviewVacancyUrl={() => {
              if (isSubmittingVacancyReview) {
                return
              }

              setReadinessError(null)
              setVacancyReviewError(null)

              reviewVacancyUrlMutation.mutateAsync().catch((error: unknown) => {
                setVacancyReviewError(
                  resolveErrorMessage(error, "We couldn't check that job link."),
                )
              })
            }}
            onOriginalCvFileSelection={handleOriginalCvSelection}
            onReplaceOriginalCv={() => {
              handleOriginalCvImport('workspace').catch(() => null)
            }}
            onSelectApplication={(tailoredApplicationId) => {
              handleSelectTailoredApplication(tailoredApplicationId)
              persistWorkspaceSelectionMutation
                .mutateAsync({
                  kind: 'tailored_application',
                  tailoredApplicationId,
                })
                .catch(() => {
                  setReadinessError("We couldn't save where you left off.")
                })
            }}
            onSelectDraft={() => {
              setIsDeleteTailoredApplicationDialogOpen(false)
              setPreviewDocumentKind('adapted_cv')
              setReadinessError(null)
              setSelectedTailoredApplicationId(null)
              setWorkspaceSelectionOverride('draft')
              persistWorkspaceSelectionMutation
                .mutateAsync({
                  kind: 'draft',
                })
                .catch(() => {
                  setReadinessError("We couldn't save where you left off.")
                })
            }}
            onSelectPreviewDocument={setPreviewDocumentKind}
            onSelectRailItem={handleSelectRailItem}
            onTextDraftChange={(event) => {
              const nextDraft = {
                text: event.target.value,
                url: vacancyDraft.url,
              }

              setVacancyDraft(nextDraft)
              setSelectedTailoredApplicationId(null)
              setWorkspaceSelectionOverride('draft')
              setVacancyPreviewOverride(null)
              setReadinessError(null)
              setVacancyReviewError(null)
              persistWorkspaceSelectionMutation
                .mutateAsync({
                  kind: 'draft',
                })
                .catch(() => {
                  setReadinessError("We couldn't save where you left off.")
                })
            }}
            onUrlDraftChange={(event) => {
              const nextDraft = {
                text: vacancyDraft.text,
                url: event.target.value,
              }

              setVacancyDraft(nextDraft)
              setSelectedTailoredApplicationId(null)
              setWorkspaceSelectionOverride('draft')
              setVacancyPreviewOverride(null)
              setReadinessError(null)
              setVacancyReviewError(null)
              persistWorkspaceSelectionMutation
                .mutateAsync({
                  kind: 'draft',
                })
                .catch(() => {
                  setReadinessError("We couldn't save where you left off.")
                })
            }}
            originalCvFile={originalCvFile}
            preview={tailoredApplicationPreview}
            previewDocumentKind={previewDocumentKind}
            selectedTailoredApplicationId={resolvedTailoredApplicationId}
            selectedWorkspaceItem={workspaceSelection.kind}
            textDraft={vacancyDraft.text}
            urlDraft={vacancyDraft.url}
            vacancyPreview={vacancyPreview}
            vacancyReviewError={vacancyReviewError}
            workspaceOverlay={workspaceOverlay}
            workspaceError={readinessError}
          />
          <Dialog
            actions={
              <>
                <Button
                  disabled={clearVacancyWorkspaceMutation.isPending}
                  onClick={() => {
                    setIsConfirmingDraftDiscard(false)
                  }}
                  tone="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={clearVacancyWorkspaceMutation.isPending}
                  onClick={() => {
                    handleConfirmDraftDiscard().catch(() => null)
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
                setIsConfirmingDraftDiscard(false)
              }
            }}
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
                    setIsDeleteTailoredApplicationDialogOpen(false)
                  }}
                  tone="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={deleteTailoredApplicationMutation.isPending}
                  onClick={() => {
                    handleDeleteTailoredApplication().catch(() => null)
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
                setIsDeleteTailoredApplicationDialogOpen(false)
              }
            }}
            title="Delete this job?"
          >
            <p className="m-0">
              This permanently removes the saved CV and cover letter for this job.
            </p>
            <p className="m-0">Cancel keeps this job exactly as it is now.</p>
          </Dialog>
        </>
      )
    },
  }

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
            handleClearJobSiteBrowserData().catch(() => null)
          }}
          onOpenSetupGuide={() => {
            handleSecondaryAction().catch(() => null)
          }}
          onResetLocalAppData={handleOpenResetLocalAppDataDialog}
          onRetryAiWorker={() => {
            setSettingsMessage(null)

            aiWorkerStatusMutation.mutateAsync('retry').catch((error: unknown) => {
              setSettingsMessage(
                resolveErrorMessage(error, `${readinessErrorMessage} ${readinessErrorAction}`),
              )
            })
          }}
          onSelectRailItem={handleSelectRailItem}
          onSelectSection={(section) => {
            setSettingsMessage(null)
            setSettingsSection(section)
          }}
          settingsMessage={settingsMessage}
          snapshot={settingsSnapshot}
          workerStatusLabel={workerStatusLabel}
          workerStatusTone={workerStatusTone}
        />
        <Dialog
          actions={
            <>
              <Button
                disabled={isResettingLocalAppData}
                onClick={() => {
                  setIsResetLocalAppDataDialogOpen(false)
                  setResetConfirmationPhrase('')
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
                  handleResetLocalAppData().catch(() => null)
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
              setIsResetLocalAppDataDialogOpen(false)
              setResetConfirmationPhrase('')
            }
          }}
          title="Reset local app data?"
        >
          <p className="m-0">
            This permanently removes your CV, saved jobs, documents, settings, and sign-ins from
            this Mac.
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
              setResetConfirmationPhrase(event.target.value)
            }}
            type="text"
            value={resetConfirmationPhrase}
          />
        </Dialog>
      </>
    )
  }

  const renderScreen = screenRegistry[screenKind]

  return renderScreen()
}

function applyStartupDestinationOverride({
  readinessViewModel,
  startupDestinationOverride,
}: {
  readinessViewModel: ReadinessRouteViewModel
  startupDestinationOverride: RendererStartupDestinationOverride | null
}): ReadinessRouteViewModel {
  if (!readinessViewModel.canEnterWorkspace || startupDestinationOverride === null) {
    return readinessViewModel
  }

  return {
    ...readinessViewModel,
    startupDestination: startupDestinationOverride,
  }
}

function isVacancyDraftReviewed(
  nextDraft: VacancyDraft,
  previewedVacancyDraft: VacancyDraft | null,
): boolean {
  if (previewedVacancyDraft === null) {
    return false
  }

  return (
    nextDraft.text === previewedVacancyDraft.text && nextDraft.url === previewedVacancyDraft.url
  )
}

function isVacancyDraftMeaningful({
  draft,
  vacancyPreview,
}: {
  draft: VacancyDraft
  vacancyPreview: VacancySummary | null
}): boolean {
  return draft.text.trim() !== '' || draft.url.trim() !== '' || vacancyPreview !== null
}

function resolveErrorMessage(error: unknown, fallbackMessage: string): string {
  if (typeof error === 'string' && error !== '') {
    return error
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message !== ''
  ) {
    return error.message
  }

  return fallbackMessage
}

function resolveAutoBrowserSessionUrl(result: VacancyIngestResult): string | null {
  if (result.kind !== 'incomplete') {
    return null
  }

  if (result.vacancy.source !== 'indeed' && result.vacancy.source !== 'linkedin') {
    return null
  }

  return result.vacancy.originalUrl
}

function resolveTailoredApplicationId({
  preferredTailoredApplicationId,
  workspaceState,
}: {
  preferredTailoredApplicationId: string | null
  workspaceState: TailoredApplicationWorkspaceState
}): string | null {
  const preferredTailoredApplicationStillExists = workspaceState.applications.some(
    (application) => {
      return application.id === preferredTailoredApplicationId
    },
  )

  if (preferredTailoredApplicationStillExists) {
    return preferredTailoredApplicationId
  }

  return workspaceState.activeApplicationId
}

function resolveWorkspaceSelection({
  forcedSelection,
  hasMeaningfulDraft,
  hasPendingGeneration,
  resolvedTailoredApplicationId,
}: {
  forcedSelection: WorkspaceSelectionOverride
  hasMeaningfulDraft: boolean
  hasPendingGeneration: boolean
  resolvedTailoredApplicationId: string | null
}): {
  kind: WorkspaceSelectionKind
} {
  if (forcedSelection === 'draft' || hasPendingGeneration) {
    return {
      kind: 'draft',
    }
  }

  if (resolvedTailoredApplicationId !== null) {
    return {
      kind: 'tailored_application',
    }
  }

  if (hasMeaningfulDraft) {
    return {
      kind: 'draft',
    }
  }

  return {
    kind: 'draft',
  }
}

function resolveWorkerStatusLabel(status: ReadinessRouteViewModel['status']): string {
  if (status === 'ready') {
    return 'Connected'
  }

  if (status === 'sign_in_required') {
    return 'Sign in needed'
  }

  if (status === 'unavailable') {
    return 'Needs attention'
  }

  return 'Checking'
}

function resolveWorkerStatusTone(
  status: ReadinessRouteViewModel['status'],
): 'danger' | 'muted' | 'ready' | 'warning' {
  if (status === 'ready') {
    return 'ready'
  }

  if (status === 'sign_in_required') {
    return 'warning'
  }

  if (status === 'unavailable') {
    return 'danger'
  }

  return 'muted'
}
