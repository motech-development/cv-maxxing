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

const initialReadinessViewModel: ReadinessRouteViewModel = {
  body: 'Checking the local AI worker before opening your workspace.',
  canEnterWorkspace: false,
  diagnostic: 'Looking for the configured local worker, authentication state, and health probe.',
  heading: 'AI worker setup',
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
  vacancy: null,
}

const readinessErrorMessage = 'Unable to complete the AI worker startup check.'
const readinessErrorAction = 'Restart the app or verify the local AI worker setup.'
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
  const [isConfirmingDeleteTailoredApplication, setIsConfirmingDeleteTailoredApplication] =
    useState(false)
  const [isCopyingCoverLetterText, setIsCopyingCoverLetterText] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
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
      setImportError(null)
      setIsConfirmingDeleteTailoredApplication(false)
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
        setIsConfirmingDeleteTailoredApplication(false)
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

      setIsConfirmingDeleteTailoredApplication(false)
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

    setIsConfirmingDeleteTailoredApplication(false)
    setPreviewDocumentKind('adapted_cv')
  }, [workspaceSelection.kind])

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
      setSettingsMessage('Internal job-site browser data cleared.')
    } catch (error) {
      setSettingsMessage(resolveErrorMessage(error, 'Unable to clear the internal browser data.'))
    }
  }

  const handleResetLocalAppData = async (): Promise<void> => {
    if (resetLocalAppDataMutation.isPending) {
      return
    }

    try {
      await resetLocalAppDataMutation.mutateAsync()
    } catch (error) {
      setSettingsMessage(
        resolveErrorMessage(error, 'Unable to reset local app data on this machine.'),
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

    setIsConfirmingDeleteTailoredApplication(false)
    setPreviewDocumentKind('adapted_cv')
    setReadinessError(null)
    setSelectedTailoredApplicationId(tailoredApplicationId)
    setWorkspaceSelectionOverride(null)
  }

  const handleDeleteTailoredApplication = async (): Promise<void> => {
    if (tailoredApplicationPreview === null || deleteTailoredApplicationMutation.isPending) {
      return
    }

    if (isConfirmingDeleteTailoredApplication) {
      try {
        await deleteTailoredApplicationMutation.mutateAsync(tailoredApplicationPreview.id)
      } catch {
        setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
      }

      return
    }

    setIsConfirmingDeleteTailoredApplication(true)
  }

  const handleCreateVacancy = async (): Promise<void> => {
    if (clearVacancyWorkspaceMutation.isPending) {
      return
    }

    try {
      await clearVacancyWorkspaceMutation.mutateAsync()

      setIsConfirmingDeleteTailoredApplication(false)
      setPreviewDocumentKind('adapted_cv')
      setReadinessError(null)
      setSelectedTailoredApplicationId(null)
      setStartupDestinationOverride('workspace')
      setWorkspaceSelectionOverride('draft')
      setVacancyDraft(initialVacancyDraft)
      setVacancyPreviewOverride(null)
    } catch (error) {
      setVacancyReviewError(
        resolveErrorMessage(error, 'Unable to clear the current vacancy draft.'),
      )
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
      setReadinessError('Unable to copy the cover letter text.')
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
        />
      ) : (
        <WorkspaceBlockingOverlay />
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
        <WorkspaceScreen
          activeOriginalCv={originalCvWorkspaceState.activeOriginalCv}
          ambientActivityLabel={ambientActivityLabel}
          applicationTitle={selectedTailoredApplication?.title ?? null}
          applications={tailoredApplicationWorkspaceState.applications}
          importError={importError}
          isAdaptingCv={isPendingGenerationActionPending}
          isConfirmingDeleteTailoredApplication={isConfirmingDeleteTailoredApplication}
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
                resolveErrorMessage(
                  error,
                  'Unable to open the internal browser session for this vacancy.',
                ),
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
            handleDeleteTailoredApplication().catch(() => null)
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
                resolveErrorMessage(error, 'Unable to review the pasted vacancy text.'),
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
                resolveErrorMessage(error, 'Unable to review this vacancy URL.'),
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
                setReadinessError('Unable to persist the current workspace selection.')
              })
          }}
          onSelectDraft={() => {
            setIsConfirmingDeleteTailoredApplication(false)
            setPreviewDocumentKind('adapted_cv')
            setReadinessError(null)
            setSelectedTailoredApplicationId(null)
            setWorkspaceSelectionOverride('draft')
            persistWorkspaceSelectionMutation
              .mutateAsync({
                kind: 'draft',
              })
              .catch(() => {
                setReadinessError('Unable to persist the current workspace selection.')
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
                setReadinessError('Unable to persist the current workspace selection.')
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
                setReadinessError('Unable to persist the current workspace selection.')
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
      )
    },
  }

  if (
    activeWorkspaceSection === 'settings' &&
    viewModel.canEnterWorkspace &&
    settingsSnapshot !== null
  ) {
    return (
      <SettingsScreen
        activeSection={settingsSection}
        appOverlay={appOverlay}
        ambientActivityLabel={ambientActivityLabel}
        isClearingJobSiteBrowserData={isClearingJobSiteBrowserData}
        isOpeningSetupGuide={isSecondaryActionPending}
        isResettingLocalAppData={isResettingLocalAppData}
        isRetryingAiWorker={isSubmittingPrimaryAction}
        onChangeResetConfirmationPhrase={setResetConfirmationPhrase}
        onClearJobSiteBrowserData={() => {
          handleClearJobSiteBrowserData().catch(() => null)
        }}
        onOpenSetupGuide={() => {
          handleSecondaryAction().catch(() => null)
        }}
        onResetLocalAppData={() => {
          handleResetLocalAppData().catch(() => null)
        }}
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
        resetConfirmationPhrase={resetConfirmationPhrase}
        settingsMessage={settingsMessage}
        snapshot={settingsSnapshot}
        workerStatusLabel={workerStatusLabel}
        workerStatusTone={workerStatusTone}
      />
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
  if (forcedSelection === 'draft' || hasMeaningfulDraft || hasPendingGeneration) {
    return {
      kind: 'draft',
    }
  }

  if (resolvedTailoredApplicationId !== null) {
    return {
      kind: 'tailored_application',
    }
  }

  return {
    kind: 'draft',
  }
}

function resolveWorkerStatusLabel(status: ReadinessRouteViewModel['status']): string {
  if (status === 'ready') {
    return 'Local'
  }

  if (status === 'sign_in_required') {
    return 'Sign in required'
  }

  if (status === 'unavailable') {
    return 'Unavailable'
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
