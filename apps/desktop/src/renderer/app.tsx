import {
  useEffect,
  useEffectEvent,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from 'react'

import { createReadinessRouteViewModel } from '../readiness/readiness-route.js'
import type { ReadinessRouteViewModel } from '../readiness/readiness-route.js'
import type { OriginalCvWorkspaceState } from '../shared/original-cv.js'
import type { PendingGenerationCommand } from '../shared/pending-generation.js'
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

export function App() {
  const [activeApplicationTitle, setActiveApplicationTitle] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isImportingOriginalCv, setIsImportingOriginalCv] = useState(false)
  const [isPendingGenerationActionPending, setIsPendingGenerationActionPending] = useState(false)
  const [isSecondaryActionPending, setIsSecondaryActionPending] = useState(false)
  const [isSubmittingPrimaryAction, setIsSubmittingPrimaryAction] = useState(false)
  const [originalCvFile, setOriginalCvFile] = useState<File | null>(null)
  const [originalCvWorkspaceState, setOriginalCvWorkspaceState] = useState(
    initialOriginalCvWorkspaceState,
  )
  const [pendingGenerationCommand, setPendingGenerationCommand] =
    useState<PendingGenerationCommand | null>(null)
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  const [viewModel, setViewModel] = useState(initialReadinessViewModel)

  const loadWorkspaceState = async (): Promise<void> => {
    const nextOriginalCvWorkspaceState =
      await globalThis.window.cvMaxxing.originalCv.getOriginalCvWorkspaceState()

    setOriginalCvWorkspaceState(nextOriginalCvWorkspaceState)
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

  const handleOriginalCvImport = async (): Promise<void> => {
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

      setOriginalCvFile(null)
      setTextDraft('')
      setUrlDraft('')
      setOriginalCvWorkspaceState({
        activeOriginalCv: importResult.originalCv,
        snapshotCount: importResult.originalCv.snapshotCount,
      })
      setViewModel((previousViewModel) => {
        return {
          ...previousViewModel,
          startupDestination: 'workspace_empty',
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

  const handleOpenTailoredApplication = async (): Promise<void> => {
    if (pendingGenerationCommand === null || isPendingGenerationActionPending) {
      return
    }

    setIsPendingGenerationActionPending(true)

    try {
      await globalThis.window.cvMaxxing.tailoredApplication.completePendingGeneration(
        pendingGenerationCommand.commandId,
      )
      setActiveApplicationTitle(createPendingGenerationTitle(pendingGenerationCommand))
      await loadReadinessState(globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight)
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
      setActiveApplicationTitle(null)
      setTextDraft('')
      setUrlDraft('')
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
            handleOriginalCvImport().catch(() => null)
          }}
          originalCvFile={originalCvFile}
        />
      )
    },
    workspace_active: () => {
      return <WorkspaceActiveScreen applicationTitle={activeApplicationTitle} />
    },
    workspace_empty: () => {
      return (
        <WorkspaceEmptyScreen
          activeOriginalCv={originalCvWorkspaceState.activeOriginalCv}
          isStartingGeneration={isPendingGenerationActionPending}
          onResetDrafts={() => {
            setTextDraft('')
            setUrlDraft('')
          }}
          onStartFromText={() => {
            handleStartPendingGeneration({
              text: textDraft.trim(),
              url: '',
            }).catch(() => null)
          }}
          onStartFromUrl={() => {
            handleStartPendingGeneration({
              text: '',
              url: urlDraft.trim(),
            }).catch(() => null)
          }}
          onTextDraftChange={(event) => {
            setTextDraft(event.target.value)
          }}
          onUrlDraftChange={(event) => {
            setUrlDraft(event.target.value)
          }}
          textDraft={textDraft}
          urlDraft={urlDraft}
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
