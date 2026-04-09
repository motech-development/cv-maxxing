import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from 'react'

import { createReadinessRouteViewModel } from '../readiness/readiness-route.js'
import type { ReadinessRouteViewModel } from '../readiness/readiness-route.js'
import type { OriginalCvWorkspaceState } from '../shared/original-cv.js'
import type { PendingGenerationCommand } from '../shared/pending-generation.js'
import type { VacancyDraft, VacancySummary } from '../shared/vacancy.js'
import { AiWorkerCheckingScreen } from './screens/ai-worker-checking-screen.js'
import { AiWorkerSignInRequiredScreen } from './screens/ai-worker-sign-in-required-screen.js'
import { AiWorkerUnavailableScreen } from './screens/ai-worker-unavailable-screen.js'
import { FirstLaunchScreen } from './screens/first-launch-screen.js'
import { WorkspaceActiveScreen } from './screens/workspace-active-screen.js'
import { WorkspaceEmptyScreen } from './screens/workspace-empty-screen.js'
import { WorkspaceLoadingScreen } from './screens/workspace-loading-screen.js'
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

const initialVacancyDraft: VacancyDraft = {
  text: '',
  url: '',
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

type OriginalCvImportDestination = 'workspace_active' | 'workspace_empty'

export function App() {
  const [activeApplicationTitle, setActiveApplicationTitle] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isImportingOriginalCv, setIsImportingOriginalCv] = useState(false)
  const [isOpeningVacancyBrowser, setIsOpeningVacancyBrowser] = useState(false)
  const [isPendingGenerationActionPending, setIsPendingGenerationActionPending] = useState(false)
  const [isSecondaryActionPending, setIsSecondaryActionPending] = useState(false)
  const [isSubmittingPrimaryAction, setIsSubmittingPrimaryAction] = useState(false)
  const [isSubmittingVacancyReview, setIsSubmittingVacancyReview] = useState(false)
  const [originalCvFile, setOriginalCvFile] = useState<File | null>(null)
  const [originalCvWorkspaceState, setOriginalCvWorkspaceState] = useState(
    initialOriginalCvWorkspaceState,
  )
  const [pendingGenerationCommand, setPendingGenerationCommand] =
    useState<PendingGenerationCommand | null>(null)
  const [previewedVacancyDraft, setPreviewedVacancyDraft] = useState<VacancyDraft | null>(null)
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [vacancyDraft, setVacancyDraft] = useState(initialVacancyDraft)
  const [vacancyPreview, setVacancyPreview] = useState<VacancySummary | null>(null)
  const [vacancyReviewError, setVacancyReviewError] = useState<string | null>(null)
  const [viewModel, setViewModel] = useState(initialReadinessViewModel)
  const isResumingPendingGeneration = useRef(false)
  const lastResumedCommandId = useRef<string | null>(null)

  const loadWorkspaceState = async (): Promise<void> => {
    const [nextOriginalCvWorkspaceState, nextVacancyWorkspaceState] = await Promise.all([
      globalThis.window.cvMaxxing.originalCv.getOriginalCvWorkspaceState(),
      globalThis.window.cvMaxxing.vacancy.getVacancyWorkspaceState(),
    ])

    setOriginalCvWorkspaceState(nextOriginalCvWorkspaceState)
    setPreviewedVacancyDraft(
      nextVacancyWorkspaceState.vacancy ? nextVacancyWorkspaceState.draft : null,
    )
    setVacancyDraft(nextVacancyWorkspaceState.draft)
    setVacancyPreview(nextVacancyWorkspaceState.vacancy)
    setVacancyReviewError(null)
  }

  const loadPendingGenerationCommand = async (): Promise<void> => {
    const nextPendingGenerationCommand =
      await globalThis.window.cvMaxxing.tailoredApplication.getPendingGenerationCommand()

    setPendingGenerationCommand(nextPendingGenerationCommand)
  }

  const loadReadinessState = async (
    getAiWorkerPreflight: typeof globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight,
  ): Promise<void> => {
    const nextViewModel = await createReadinessRouteViewModel({
      getAiWorkerPreflight,
      getStartupDestination: globalThis.window.cvMaxxing.aiWorker.getStartupDestination,
    })

    setReadinessError(null)
    setViewModel(nextViewModel)

    if (nextViewModel.canEnterWorkspace) {
      await loadWorkspaceState()

      if (nextViewModel.startupDestination !== 'workspace_active') {
        setActiveApplicationTitle(null)
      }

      if (nextViewModel.startupDestination === 'workspace_loading') {
        await loadPendingGenerationCommand()

        return
      }

      setPendingGenerationCommand(null)
    }
  }

  const loadInitialState = useEffectEvent(async (): Promise<void> => {
    await loadReadinessState(globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight)
  })

  useEffect(() => {
    loadInitialState().catch(() => {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    })
  }, [])

  const handlePrimaryAction = async (): Promise<void> => {
    if (viewModel.primaryActionLabel === undefined || isSubmittingPrimaryAction) {
      return
    }

    const getAiWorkerPreflight =
      viewModel.status === 'sign_in_required'
        ? globalThis.window.cvMaxxing.aiWorker.startAiWorkerSignIn
        : globalThis.window.cvMaxxing.aiWorker.retryAiWorkerPreflight

    setIsSubmittingPrimaryAction(true)

    try {
      await loadReadinessState(getAiWorkerPreflight)
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    } finally {
      setIsSubmittingPrimaryAction(false)
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

  const handleOriginalCvImport = async (
    nextStartupDestination: OriginalCvImportDestination,
  ): Promise<void> => {
    if (originalCvFile === null || isImportingOriginalCv) {
      return
    }

    setIsImportingOriginalCv(true)
    setImportError(null)

    try {
      const importResult = await globalThis.window.cvMaxxing.originalCv.importOriginalCv({
        content: new Uint8Array(await originalCvFile.arrayBuffer()),
        filename: originalCvFile.name,
      })

      if (importResult.kind === 'rejected') {
        setImportError(importResult.error.message)

        return
      }

      await globalThis.window.cvMaxxing.vacancy.clearVacancyWorkspaceState()
      setOriginalCvFile(null)
      setPreviewedVacancyDraft(null)
      setVacancyDraft(initialVacancyDraft)
      setVacancyPreview(null)
      setVacancyReviewError(null)
      setOriginalCvWorkspaceState({
        activeOriginalCv: importResult.originalCv,
        snapshotCount: importResult.originalCv.snapshotCount,
      })
      setViewModel((previousViewModel) => {
        return {
          ...previousViewModel,
          startupDestination: nextStartupDestination,
        }
      })
    } finally {
      setIsImportingOriginalCv(false)
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

    if (activeOriginalCv === null || isPendingGenerationActionPending) {
      return
    }

    setActiveApplicationTitle(null)
    setIsPendingGenerationActionPending(true)

    try {
      await loadReadinessState(async () => {
        return await globalThis.window.cvMaxxing.tailoredApplication.startPendingGeneration({
          originalCvId: activeOriginalCv.id,
          originalCvLabel: activeOriginalCv.originalFilename,
          vacancyDraft,
        })
      })
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    } finally {
      setIsPendingGenerationActionPending(false)
    }
  }

  const completePendingGenerationFlow = async (
    nextPendingGenerationCommand: PendingGenerationCommand,
  ): Promise<void> => {
    await globalThis.window.cvMaxxing.tailoredApplication.completePendingGeneration(
      nextPendingGenerationCommand.commandId,
    )
    await globalThis.window.cvMaxxing.vacancy.clearVacancyWorkspaceState()
    setActiveApplicationTitle(createPendingGenerationTitle(nextPendingGenerationCommand))
    await loadWorkspaceState()
    setPendingGenerationCommand(null)
    setReadinessError(null)
    setViewModel(createWorkspaceActiveViewModel())
  }

  const handleOpenTailoredApplication = async (): Promise<void> => {
    if (pendingGenerationCommand === null || isPendingGenerationActionPending) {
      return
    }

    setIsPendingGenerationActionPending(true)

    try {
      await completePendingGenerationFlow(pendingGenerationCommand)
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    } finally {
      setIsPendingGenerationActionPending(false)
    }
  }

  const handleAbandonDraft = async (): Promise<void> => {
    if (isPendingGenerationActionPending) {
      return
    }

    setIsPendingGenerationActionPending(true)

    try {
      await globalThis.window.cvMaxxing.tailoredApplication.abandonPendingGeneration()
      await loadReadinessState(globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight)
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    } finally {
      setIsPendingGenerationActionPending(false)
    }
  }

  const screenKind = resolveRendererScreen({
    originalCvWorkspaceState,
    readinessViewModel: viewModel,
  })

  const resumePendingGeneration = useEffectEvent(async (): Promise<void> => {
    if (pendingGenerationCommand === null) {
      return
    }

    try {
      await globalThis.window.cvMaxxing.tailoredApplication.resumePendingGeneration()
      await completePendingGenerationFlow(pendingGenerationCommand)
    } catch (error) {
      setReadinessError(
        resolveErrorMessage(error, `${readinessErrorMessage} ${readinessErrorAction}`),
      )
      await loadReadinessState(globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight)
    }
  })

  useEffect(() => {
    if (screenKind !== 'workspace_loading' || pendingGenerationCommand === null) {
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

    resumePendingGeneration()
      .catch(() => {
        lastResumedCommandId.current = null
      })
      .finally(() => {
        isResumingPendingGeneration.current = false
      })
  }, [pendingGenerationCommand, screenKind])

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
            handleOriginalCvImport('workspace_empty').catch(() => null)
          }}
          originalCvFile={originalCvFile}
        />
      )
    },
    workspace_active: () => {
      return (
        <WorkspaceActiveScreen
          activeOriginalCv={originalCvWorkspaceState.activeOriginalCv}
          applicationTitle={activeApplicationTitle}
          importError={importError}
          isImportingOriginalCv={isImportingOriginalCv}
          onOriginalCvFileSelection={handleOriginalCvSelection}
          onReplaceOriginalCv={() => {
            handleOriginalCvImport('workspace_active').catch(() => null)
          }}
          originalCvFile={originalCvFile}
        />
      )
    },
    workspace_empty: () => {
      return (
        <WorkspaceEmptyScreen
          activeOriginalCv={originalCvWorkspaceState.activeOriginalCv}
          importError={importError}
          isAdaptingCv={isPendingGenerationActionPending}
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

            setIsOpeningVacancyBrowser(true)
            setVacancyReviewError(null)

            globalThis.window.cvMaxxing.vacancy
              .openVacancyBrowserSession({
                url: originalUrl,
              })
              .then((result) => {
                setPreviewedVacancyDraft(result.workspaceState.draft)
                setVacancyDraft(result.workspaceState.draft)
                setVacancyPreview(result.vacancy)
              })
              .catch((error: unknown) => {
                setVacancyReviewError(
                  resolveErrorMessage(
                    error,
                    'Unable to open the internal browser session for this vacancy.',
                  ),
                )
              })
              .finally(() => {
                setIsOpeningVacancyBrowser(false)
              })
          }}
          onOriginalCvFileSelection={handleOriginalCvSelection}
          onReplaceOriginalCv={() => {
            handleOriginalCvImport('workspace_empty').catch(() => null)
          }}
          onResetDrafts={() => {
            globalThis.window.cvMaxxing.vacancy
              .clearVacancyWorkspaceState()
              .then(() => {
                setPreviewedVacancyDraft(null)
                setVacancyDraft(initialVacancyDraft)
                setVacancyPreview(null)
                setVacancyReviewError(null)
              })
              .catch((error: unknown) => {
                setVacancyReviewError(
                  resolveErrorMessage(error, 'Unable to clear the current vacancy draft.'),
                )
              })
          }}
          onReviewPastedVacancy={() => {
            if (isSubmittingVacancyReview) {
              return
            }

            setIsSubmittingVacancyReview(true)
            setVacancyReviewError(null)

            globalThis.window.cvMaxxing.vacancy
              .ingestPastedVacancy({
                text: vacancyDraft.text.trim(),
                url: vacancyDraft.url.trim() === '' ? undefined : vacancyDraft.url.trim(),
              })
              .then((result) => {
                setPreviewedVacancyDraft(result.workspaceState.draft)
                setVacancyDraft(result.workspaceState.draft)
                setVacancyPreview(result.vacancy)
              })
              .catch((error: unknown) => {
                setPreviewedVacancyDraft(null)
                setVacancyPreview(null)
                setVacancyReviewError(
                  resolveErrorMessage(error, 'Unable to review the pasted vacancy text.'),
                )
              })
              .finally(() => {
                setIsSubmittingVacancyReview(false)
              })
          }}
          onReviewVacancyUrl={() => {
            if (isSubmittingVacancyReview) {
              return
            }

            setIsSubmittingVacancyReview(true)
            setVacancyReviewError(null)

            globalThis.window.cvMaxxing.vacancy
              .ingestVacancyUrl({
                url: vacancyDraft.url.trim(),
              })
              .then((result) => {
                setPreviewedVacancyDraft(result.workspaceState.draft)
                setVacancyDraft(result.workspaceState.draft)
                setVacancyPreview(result.vacancy)
              })
              .catch((error: unknown) => {
                setPreviewedVacancyDraft(null)
                setVacancyPreview(null)
                setVacancyReviewError(
                  resolveErrorMessage(error, 'Unable to review this vacancy URL.'),
                )
              })
              .finally(() => {
                setIsSubmittingVacancyReview(false)
              })
          }}
          onTextDraftChange={(event) => {
            const nextDraft = {
              text: event.target.value,
              url: vacancyDraft.url,
            }

            setVacancyDraft(nextDraft)
            setVacancyReviewError(null)

            if (!isVacancyDraftReviewed(nextDraft, previewedVacancyDraft)) {
              setPreviewedVacancyDraft(null)
              setVacancyPreview(null)
            }
          }}
          onUrlDraftChange={(event) => {
            const nextDraft = {
              text: vacancyDraft.text,
              url: event.target.value,
            }

            setVacancyDraft(nextDraft)
            setVacancyReviewError(null)

            if (!isVacancyDraftReviewed(nextDraft, previewedVacancyDraft)) {
              setPreviewedVacancyDraft(null)
              setVacancyPreview(null)
            }
          }}
          originalCvFile={originalCvFile}
          textDraft={vacancyDraft.text}
          urlDraft={vacancyDraft.url}
          vacancyPreview={vacancyPreview}
          vacancyReviewError={vacancyReviewError}
        />
      )
    },
    workspace_loading: () => {
      return (
        <WorkspaceLoadingScreen
          isPendingAction={isPendingGenerationActionPending}
          onAbandonDraft={() => {
            handleAbandonDraft().catch(() => null)
          }}
          onOpenTailoredApplication={() => {
            handleOpenTailoredApplication().catch(() => null)
          }}
          pendingGenerationCommand={pendingGenerationCommand}
        />
      )
    },
  }

  const renderScreen = screenRegistry[screenKind]

  return renderScreen()
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

function createPendingGenerationTitle(pendingGenerationCommand: PendingGenerationCommand): string {
  const vacancyTitle = pendingGenerationCommand.vacancyDraft.text
    .split('\n')
    .map((line) => {
      return line.trim()
    })
    .find((line) => {
      return line !== ''
    })

  if (vacancyTitle !== undefined) {
    return vacancyTitle
  }

  return tryFormatHostname(pendingGenerationCommand.vacancyDraft.url) ?? 'Tailored application'
}

function tryFormatHostname(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./u, '')

    if (hostname === '') {
      return null
    }

    return hostname
  } catch {
    return null
  }
}

function resolveErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message !== '') {
    return error.message
  }

  return fallbackMessage
}

function createWorkspaceActiveViewModel(): ReadinessRouteViewModel {
  return {
    body: 'The local AI worker is ready. Restoring your last tailored application.',
    canEnterWorkspace: true,
    diagnostic: 'Startup route restored: workspace_active.',
    heading: 'Workspace restored',
    primaryActionLabel: undefined,
    secondaryActionLabel: undefined,
    startupDestination: 'workspace_active',
    status: 'ready',
  }
}
