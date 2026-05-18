import {
  AI_WORKER_IPC_CHANNELS,
  ORIGINAL_CV_IPC_CHANNELS,
  SETTINGS_IPC_CHANNELS,
  TAILORED_APPLICATION_IPC_CHANNELS,
  VACANCY_IPC_CHANNELS,
} from '../shared/ipc.js'
import type { OriginalCvImportInput, OriginalCvImportResult } from '../shared/original-cv.js'
import type {
  CompletePendingGenerationInput,
  StartPendingGenerationInput,
} from '../shared/pending-generation.js'
import type { ResetLocalAppDataInput } from '../shared/settings.js'
import type { WorkspaceSelection } from '../shared/workspace-selection.js'
import type { PastedVacancyInput, VacancyUrlInput } from '../shared/vacancy.js'
import type { AiWorkerPreflightService } from './ai-worker-preflight-service.js'
import { OriginalCvImportError, type OriginalCvService } from './original-cv-service.js'
import type { SettingsService } from './settings-service.js'
import type { TailoredApplicationSessionService } from './tailored-application-session-service.js'
import type { VacancyService } from './vacancy-service.js'

export interface IpcMainLike {
  handle: (
    channel: string,
    handler: (_event: unknown, payload?: unknown) => Promise<unknown>,
  ) => void
}

interface RegisterDesktopIpcHandlersOptions {
  aiWorker: AiWorkerPreflightService
  ipcMain: IpcMainLike
  onOriginalCvImported: () => Promise<void>
  originalCv: OriginalCvService
  settings: SettingsService
  tailoredApplicationPreviewDelayMs?: number
  tailoredApplication: TailoredApplicationSessionService
  vacancy: VacancyService
}

export function registerDesktopIpcHandlers({
  aiWorker,
  ipcMain,
  onOriginalCvImported,
  originalCv,
  settings,
  tailoredApplicationPreviewDelayMs = 0,
  tailoredApplication,
  vacancy,
}: RegisterDesktopIpcHandlersOptions): void {
  ipcMain.handle(AI_WORKER_IPC_CHANNELS.getPreflight, async () => {
    return await aiWorker.getAiWorkerPreflight()
  })
  ipcMain.handle(AI_WORKER_IPC_CHANNELS.getStartupDestination, async () => {
    return await aiWorker.getStartupDestination()
  })
  ipcMain.handle(AI_WORKER_IPC_CHANNELS.retryPreflight, async () => {
    return await aiWorker.retryAiWorkerPreflight()
  })
  ipcMain.handle(AI_WORKER_IPC_CHANNELS.startSignIn, async () => {
    return await aiWorker.startAiWorkerSignIn()
  })
  ipcMain.handle(AI_WORKER_IPC_CHANNELS.openSetupGuide, async () => {
    await aiWorker.openAiWorkerSetupGuide()
  })
  ipcMain.handle(ORIGINAL_CV_IPC_CHANNELS.getWorkspaceState, async () => {
    return await originalCv.getWorkspaceState()
  })
  ipcMain.handle(ORIGINAL_CV_IPC_CHANNELS.getActiveDetail, async () => {
    return await originalCv.getActiveOriginalCvDetail()
  })
  ipcMain.handle(ORIGINAL_CV_IPC_CHANNELS.importOriginalCv, async (_event, payload) => {
    const input = parseOriginalCvImportInput(payload)
    const preflightResult = await aiWorker.getAiWorkerPreflight()

    if (preflightResult.status !== 'ready') {
      return {
        kind: 'ai_worker_not_ready',
        preflight: preflightResult,
      } satisfies OriginalCvImportResult
    }

    try {
      const importedOriginalCv = await originalCv.importOriginalCv({
        content: Buffer.from(input.content),
        filename: input.filename,
      })

      await onOriginalCvImported()

      return {
        kind: 'imported',
        originalCv: importedOriginalCv,
      } satisfies OriginalCvImportResult
    } catch (error) {
      if (error instanceof OriginalCvImportError) {
        return {
          error: {
            code: error.code,
            message: error.message,
          },
          kind: 'rejected',
        } satisfies OriginalCvImportResult
      }

      throw error
    }
  })
  ipcMain.handle(SETTINGS_IPC_CHANNELS.getSnapshot, async () => {
    return await settings.getSettingsSnapshot()
  })
  ipcMain.handle(SETTINGS_IPC_CHANNELS.clearJobSiteBrowserData, async () => {
    await settings.clearJobSiteBrowserData()
  })
  ipcMain.handle(SETTINGS_IPC_CHANNELS.resetLocalAppData, async (_event, payload) => {
    await settings.resetLocalAppData(parseResetLocalAppDataInput(payload))
  })
  ipcMain.handle(VACANCY_IPC_CHANNELS.getWorkspaceState, async () => {
    return await vacancy.getWorkspaceState()
  })
  ipcMain.handle(VACANCY_IPC_CHANNELS.clearWorkspaceState, async () => {
    await vacancy.resetWorkspaceState()
  })
  ipcMain.handle(VACANCY_IPC_CHANNELS.ingestUrl, async (_event, payload) => {
    return await vacancy.ingestVacancyUrl(parseVacancyUrlInput(payload))
  })
  ipcMain.handle(VACANCY_IPC_CHANNELS.ingestPasted, async (_event, payload) => {
    return await vacancy.ingestPastedVacancy(parsePastedVacancyInput(payload))
  })
  ipcMain.handle(VACANCY_IPC_CHANNELS.openBrowserSession, async (_event, payload) => {
    return await vacancy.openBrowserSession(parseVacancyUrlInput(payload))
  })
  ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.getPendingGeneration, async () => {
    return await tailoredApplication.getPendingGenerationCommand()
  })
  ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.getWorkspaceState, async () => {
    return await tailoredApplication.getWorkspaceState()
  })
  ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.getWorkspaceSelection, async () => {
    return await tailoredApplication.getWorkspaceSelection()
  })
  ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.getPreview, async (_event, payload) => {
    if (tailoredApplicationPreviewDelayMs > 0) {
      await waitForDelay(tailoredApplicationPreviewDelayMs)
    }

    return await tailoredApplication.getTailoredApplicationPreview(
      parseTailoredApplicationIdInput(payload).tailoredApplicationId,
    )
  })
  ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.resumePendingGeneration, async () => {
    return await tailoredApplication.resumePendingGeneration()
  })
  ipcMain.handle(
    TAILORED_APPLICATION_IPC_CHANNELS.setWorkspaceSelection,
    async (_event, payload) => {
      await tailoredApplication.setWorkspaceSelection(parseWorkspaceSelection(payload))
    },
  )
  ipcMain.handle(
    TAILORED_APPLICATION_IPC_CHANNELS.startPendingGeneration,
    async (_event, payload) => {
      return await tailoredApplication.startPendingGeneration(
        parseStartPendingGenerationInput(payload),
      )
    },
  )
  ipcMain.handle(
    TAILORED_APPLICATION_IPC_CHANNELS.completePendingGeneration,
    async (_event, payload) => {
      return await tailoredApplication.completePendingGeneration(
        parseCompletePendingGenerationInput(payload).commandId,
      )
    },
  )
  ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.abandonPendingGeneration, async () => {
    await tailoredApplication.abandonPendingGeneration()
  })
  ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.delete, async (_event, payload) => {
    await tailoredApplication.deleteTailoredApplication(
      parseTailoredApplicationIdInput(payload).tailoredApplicationId,
    )
  })
  ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.exportAdaptedCvPdf, async (_event, payload) => {
    return await tailoredApplication.exportAdaptedCvPdf(
      parseTailoredApplicationIdInput(payload).tailoredApplicationId,
    )
  })
  ipcMain.handle(
    TAILORED_APPLICATION_IPC_CHANNELS.exportCoverLetterPdf,
    async (_event, payload) => {
      return await tailoredApplication.exportCoverLetterPdf(
        parseTailoredApplicationIdInput(payload).tailoredApplicationId,
      )
    },
  )
}

function parseWorkspaceSelection(value: unknown): WorkspaceSelection {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('jobs' in value) ||
    !('originalCv' in value) ||
    !('topLevelSection' in value)
  ) {
    throw new Error('Workspace selection must be an object.')
  }

  const jobsSelection = parseJobsWorkspaceSelection(value.jobs)
  const originalCvSelection = parseOriginalCvWorkspaceSelection(value.originalCv)

  if (
    value.topLevelSection !== 'job_vacancies' &&
    value.topLevelSection !== 'original_cv' &&
    value.topLevelSection !== 'settings'
  ) {
    throw new Error('Workspace selection payload is invalid.')
  }

  return {
    jobs: jobsSelection,
    originalCv: originalCvSelection,
    topLevelSection: value.topLevelSection,
  }
}

function parseJobsWorkspaceSelection(value: unknown): WorkspaceSelection['jobs'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !('kind' in value)) {
    throw new Error('Workspace selection payload is invalid.')
  }

  if (value.kind === 'draft' || value.kind === 'none') {
    return {
      kind: value.kind,
    }
  }

  if (
    value.kind === 'tailored_application' &&
    'tailoredApplicationId' in value &&
    typeof value.tailoredApplicationId === 'string'
  ) {
    return {
      kind: 'tailored_application',
      tailoredApplicationId: value.tailoredApplicationId,
    }
  }

  throw new Error('Workspace selection payload is invalid.')
}

function parseOriginalCvWorkspaceSelection(value: unknown): WorkspaceSelection['originalCv'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !('kind' in value)) {
    throw new Error('Workspace selection payload is invalid.')
  }

  if (value.kind === 'none') {
    return {
      kind: value.kind,
    }
  }

  if (
    value.kind === 'active_original_cv' &&
    'originalCvId' in value &&
    (typeof value.originalCvId === 'string' || value.originalCvId === null)
  ) {
    return {
      kind: value.kind,
      originalCvId: value.originalCvId,
    }
  }

  throw new Error('Workspace selection payload is invalid.')
}

async function waitForDelay(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs)
  })
}

function parseOriginalCvImportInput(payload: unknown): OriginalCvImportInput {
  if (!isOriginalCvImportPayload(payload)) {
    throw new TypeError('Invalid original CV import payload.')
  }

  return payload
}

function parseResetLocalAppDataInput(payload: unknown): ResetLocalAppDataInput {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !('confirmationPhrase' in payload) ||
    typeof payload.confirmationPhrase !== 'string'
  ) {
    throw new TypeError('Invalid local app data reset payload.')
  }

  return {
    confirmationPhrase: payload.confirmationPhrase,
  }
}

function isOriginalCvImportPayload(payload: unknown): payload is OriginalCvImportInput {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'content' in payload &&
    payload.content instanceof Uint8Array &&
    'filename' in payload &&
    typeof payload.filename === 'string'
  )
}

function parseVacancyUrlInput(payload: unknown): VacancyUrlInput {
  if (!isVacancyUrlInput(payload)) {
    throw new TypeError('Invalid vacancy URL payload.')
  }

  return payload
}

function isVacancyUrlInput(payload: unknown): payload is VacancyUrlInput {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'url' in payload &&
    typeof payload.url === 'string'
  )
}

function parsePastedVacancyInput(payload: unknown): PastedVacancyInput {
  if (!isPastedVacancyInput(payload)) {
    throw new TypeError('Invalid pasted vacancy payload.')
  }

  return payload
}

function isPastedVacancyInput(payload: unknown): payload is PastedVacancyInput {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'text' in payload &&
    typeof payload.text === 'string' &&
    (!('url' in payload) || payload.url === undefined || typeof payload.url === 'string')
  )
}

function parseStartPendingGenerationInput(payload: unknown): StartPendingGenerationInput {
  if (!isStartPendingGenerationInput(payload)) {
    throw new TypeError('Invalid pending generation payload.')
  }

  return payload
}

function isStartPendingGenerationInput(payload: unknown): payload is StartPendingGenerationInput {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'originalCvId' in payload &&
    typeof payload.originalCvId === 'string' &&
    'originalCvLabel' in payload &&
    typeof payload.originalCvLabel === 'string' &&
    'vacancyDraft' in payload &&
    payload.vacancyDraft !== null &&
    typeof payload.vacancyDraft === 'object' &&
    'text' in payload.vacancyDraft &&
    typeof payload.vacancyDraft.text === 'string' &&
    'url' in payload.vacancyDraft &&
    typeof payload.vacancyDraft.url === 'string'
  )
}

function parseCompletePendingGenerationInput(payload: unknown): CompletePendingGenerationInput {
  if (!isCompletePendingGenerationInput(payload)) {
    throw new TypeError('Invalid complete pending generation payload.')
  }

  return payload
}

function isCompletePendingGenerationInput(
  payload: unknown,
): payload is CompletePendingGenerationInput {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'commandId' in payload &&
    typeof payload.commandId === 'string'
  )
}

function parseTailoredApplicationIdInput(payload: unknown): { tailoredApplicationId: string } {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !('tailoredApplicationId' in payload) ||
    typeof payload.tailoredApplicationId !== 'string' ||
    payload.tailoredApplicationId === ''
  ) {
    throw new TypeError('Invalid tailored application payload.')
  }

  return {
    tailoredApplicationId: payload.tailoredApplicationId,
  }
}
