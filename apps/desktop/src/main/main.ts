import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  PendingGenerationCommand,
  StartPendingGenerationInput,
} from '../shared/pending-generation.js'
import type { ResetLocalAppDataInput } from '../shared/settings.js'
import type { StartupDestination } from '../shared/startup-destination.js'
import type { PastedVacancyInput, VacancyUrlInput } from '../shared/vacancy.js'
import { createAiWorkerReadinessStore } from './ai-worker-readiness-store.js'
import { createElectronAdaptedCvRenderer } from './adapted-cv-electron-renderer.js'
import { createElectronCoverLetterRenderer } from './cover-letter-electron-renderer.js'
import {
  createAiWorkerPreflightService,
  type AiWorkerPreflightService,
} from './ai-worker-preflight-service.js'
import { createLocalAppDataPaths, openLocalAppData } from './local-app-data-service.js'
import { extractTextFromDocx, extractTextFromPdf } from './original-cv-document-extractor.js'
import {
  OriginalCvImportError,
  createOriginalCvService,
  type OriginalCvService,
} from './original-cv-service.js'
import { createSafeStorageKeychain } from './safe-storage-keychain.js'
import { createTailoredApplicationGenerationWorker } from './tailored-application-generation-worker.js'
import {
  createTailoredApplicationSessionService,
  type TailoredApplicationSessionService,
} from './tailored-application-session-service.js'
import { createSettingsService, type SettingsService } from './settings-service.js'
import { createVacancyBrowserSessionService } from './vacancy-browser-session-service.js'
import { createVacancyService, type VacancyService } from './vacancy-service.js'

const CODEX_SETUP_GUIDE_URL = 'https://developers.openai.com/codex/app/'
const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
const preloadPath = path.join(currentDirectory, '../preload/preload.js')
const rendererIndexPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url))
const rendererDevelopmentUrl = process.env.CV_MAXXING_RENDERER_URL

interface AppLike {
  on: (event: 'activate' | 'window-all-closed', handler: () => void) => unknown
  quit: () => void
  whenReady: () => Promise<void>
}

interface BrowserWindowLike {
  loadFile: (path: string) => Promise<void>
  loadURL: (url: string) => Promise<void>
}

interface DesktopBrowserWindowOptions {
  backgroundColor: string
  frame?: boolean
  height: number
  show: boolean
  title: string
  trafficLightPosition?: {
    x: number
    y: number
  }
  titleBarStyle?: 'customButtonsOnHover' | 'default' | 'hidden' | 'hiddenInset'
  webPreferences: {
    contextIsolation: boolean
    nodeIntegration: boolean
    preload: string
    sandbox: boolean
  }
  width: number
}

interface BrowserWindowModule {
  create: (options: DesktopBrowserWindowOptions) => BrowserWindowLike
  getAllWindows: () => BrowserWindowLike[]
}

interface IpcMainLike {
  handle: (
    channel: string,
    handler: (_event: unknown, payload?: unknown) => Promise<unknown>,
  ) => void
}

interface DesktopAppBootstrapDependencies {
  aiWorker: AiWorkerPreflightService
  app: AppLike
  browserWindow: BrowserWindowModule
  ipcMain: IpcMainLike
  onOriginalCvImported: () => Promise<void>
  originalCv: OriginalCvService
  platform: NodeJS.Platform
  preloadPath: string
  rendererDevelopmentUrl?: string
  rendererIndexPath: string
  settings: SettingsService
  tailoredApplication: TailoredApplicationSessionService
  vacancy: VacancyService
}

type ElectronAppOn = ((event: 'activate', listener: (...args: unknown[]) => void) => unknown) &
  ((event: 'window-all-closed', listener: (...args: unknown[]) => void) => unknown)

interface ElectronAppLike {
  on: ElectronAppOn
  quit: () => void
  whenReady: () => Promise<void>
}

interface ElectronBrowserWindowConstructor {
  new (options: DesktopBrowserWindowOptions): BrowserWindowLike
  getAllWindows: () => BrowserWindowLike[]
}

interface RuntimeDependencyOptions {
  aiWorker: AiWorkerPreflightService
  app: ElectronAppLike
  browserWindowConstructor: ElectronBrowserWindowConstructor
  ipcMain: IpcMainLike
  onOriginalCvImported: () => Promise<void>
  originalCv: OriginalCvService
  platform: NodeJS.Platform
  preloadPath: string
  rendererDevelopmentUrl?: string
  rendererIndexPath: string
  settings: SettingsService
  tailoredApplication: TailoredApplicationSessionService
  vacancy: VacancyService
}

interface RuntimeEnvironment {
  CHECKING_TIMEOUT_MS?: string
  CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS?: string
  CV_MAXXING_AI_WORKER_CODEX_COMMAND?: string
  CV_MAXXING_AI_WORKER_GENERATION_DELAY_MS?: string
  CV_MAXXING_AI_WORKER_GENERATION_FAILURE?: string
  CV_MAXXING_AI_WORKER_GENERATION_OUTPUT?: string
  CV_MAXXING_LOCAL_APP_DATA_ROOT?: string
  CV_MAXXING_AI_WORKER_RETRY_STATUS?: string
  CV_MAXXING_AI_WORKER_SIGN_IN_STATUS?: string
  CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET?: string
  CV_MAXXING_PENDING_GENERATION_COMMAND?: string
  CV_MAXXING_STARTUP_DESTINATION?: string
  CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH?: string
  CV_MAXXING_VACANCY_BROWSER_SESSION_CLOSE_AFTER_LOAD?: string
  CV_MAXXING_VACANCY_BROWSER_SESSION_HTML?: string
  CV_MAXXING_VACANCY_BROWSER_SESSION_RESOLVED_URL?: string
}

export function createDesktopAppBootstrap({
  aiWorker,
  app,
  browserWindow,
  ipcMain,
  onOriginalCvImported,
  originalCv,
  platform,
  preloadPath,
  rendererDevelopmentUrl,
  rendererIndexPath,
  settings,
  tailoredApplication,
  vacancy,
}: DesktopAppBootstrapDependencies): { start: () => Promise<void> } {
  function registerIpcHandlers(): void {
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
    ipcMain.handle(ORIGINAL_CV_IPC_CHANNELS.importOriginalCv, async (_event, payload) => {
      const input = parseOriginalCvImportInput(payload)

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
    ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.getPreview, async (_event, payload) => {
      return await tailoredApplication.getTailoredApplicationPreview(
        parseTailoredApplicationIdInput(payload).tailoredApplicationId,
      )
    })
    ipcMain.handle(TAILORED_APPLICATION_IPC_CHANNELS.resumePendingGeneration, async () => {
      return await tailoredApplication.resumePendingGeneration()
    })
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
        await tailoredApplication.completePendingGeneration(
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
    ipcMain.handle(
      TAILORED_APPLICATION_IPC_CHANNELS.exportAdaptedCvPdf,
      async (_event, payload) => {
        return await tailoredApplication.exportAdaptedCvPdf(
          parseTailoredApplicationIdInput(payload).tailoredApplicationId,
        )
      },
    )
    ipcMain.handle(
      TAILORED_APPLICATION_IPC_CHANNELS.exportCoverLetterPdf,
      async (_event, payload) => {
        return await tailoredApplication.exportCoverLetterPdf(
          parseTailoredApplicationIdInput(payload).tailoredApplicationId,
        )
      },
    )
  }

  async function createMainWindow(): Promise<void> {
    const mainWindow = browserWindow.create({
      backgroundColor: '#08141f',
      ...(platform === 'darwin'
        ? {
            trafficLightPosition: {
              x: 12,
              y: 20,
            },
            titleBarStyle: 'hiddenInset' as const,
          }
        : {}),
      height: 900,
      show: true,
      title: 'CV Maxxing',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
        sandbox: false,
      },
      width: 1440,
    })

    if (rendererDevelopmentUrl) {
      await mainWindow.loadURL(rendererDevelopmentUrl)

      return
    }

    await mainWindow.loadFile(rendererIndexPath)
  }

  async function start(): Promise<void> {
    await app.whenReady()
    registerIpcHandlers()
    await createMainWindow()

    app.on('activate', () => {
      if (browserWindow.getAllWindows().length === 0) {
        createMainWindow().catch((error: unknown) => {
          console.error('Failed to recreate the main window on activate.', error)
        })
      }
    })

    app.on('window-all-closed', () => {
      if (platform !== 'darwin') {
        app.quit()
      }
    })
  }

  return {
    start,
  }
}

export function createElectronRuntimeDependencies({
  aiWorker,
  app,
  browserWindowConstructor,
  ipcMain,
  onOriginalCvImported,
  originalCv,
  platform,
  preloadPath,
  rendererDevelopmentUrl,
  rendererIndexPath,
  settings,
  tailoredApplication,
  vacancy,
}: RuntimeDependencyOptions): DesktopAppBootstrapDependencies {
  return {
    aiWorker,
    app: {
      on: (event, handler) => {
        if (event === 'activate') {
          return app.on('activate', () => {
            handler()
          })
        }

        return app.on('window-all-closed', () => {
          handler()
        })
      },
      quit: () => {
        app.quit()
      },
      whenReady: () => {
        return app.whenReady()
      },
    },
    browserWindow: {
      create: (options) => {
        return new browserWindowConstructor(options)
      },
      getAllWindows: () => {
        return browserWindowConstructor.getAllWindows()
      },
    },
    ipcMain,
    onOriginalCvImported,
    originalCv,
    platform,
    preloadPath,
    rendererDevelopmentUrl,
    rendererIndexPath,
    settings,
    tailoredApplication,
    vacancy,
  }
}

async function createRuntimeServices(): Promise<{
  aiWorker: AiWorkerPreflightService
  onOriginalCvImported: () => Promise<void>
  originalCv: OriginalCvService
  settings: SettingsService
  tailoredApplication: TailoredApplicationSessionService
  vacancy: VacancyService
}> {
  const environment = process.env as RuntimeEnvironment
  const paths = createLocalAppDataPaths(
    environment.CV_MAXXING_LOCAL_APP_DATA_ROOT ??
      path.join(app.getPath('userData'), 'local-app-data'),
  )
  const localAppData = await openLocalAppData({
    keychain: createSafeStorageKeychain({
      keychainRecordPath: paths.keychainRecordPath,
      safeStorage,
    }),
    paths,
  })
  const readinessStore = createAiWorkerReadinessStore({
    localAppData,
  })
  const aiWorker = createAiWorkerPreflightService({
    environment,
    getPendingGenerationCommand: async () => {
      const overrideCommand = parsePendingGenerationCommand(
        environment.CV_MAXXING_PENDING_GENERATION_COMMAND,
      )

      if (overrideCommand !== null) {
        return overrideCommand
      }

      return await readinessStore.getPendingGenerationCommand()
    },
    getPersistedCheckingTimeout: async () => {
      return await readinessStore.getCheckingTimeout()
    },
    getPersistedStartupDestination: async () => {
      const overrideDestination = parseStartupDestination(
        environment.CV_MAXXING_STARTUP_DESTINATION,
      )

      if (overrideDestination !== null) {
        return overrideDestination
      }

      return await readinessStore.getStartupDestination()
    },
    openAiWorkerSetupGuide: async () => {
      await shell.openExternal(CODEX_SETUP_GUIDE_URL)
    },
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    autoCloseAfterFirstObservation:
      environment.CV_MAXXING_VACANCY_BROWSER_SESSION_CLOSE_AFTER_LOAD === 'true',
    profileRootPath: path.join(paths.rootDirectoryPath, 'browser-sessions'),
    testResolvedUrl: environment.CV_MAXXING_VACANCY_BROWSER_SESSION_RESOLVED_URL,
    testSnapshotHtml: environment.CV_MAXXING_VACANCY_BROWSER_SESSION_HTML,
  })
  const tailoredApplication = createTailoredApplicationSessionService({
    adaptedCvRenderer: createElectronAdaptedCvRenderer(),
    aiWorker,
    coverLetterRenderer: createElectronCoverLetterRenderer(),
    exportDialog: createAdaptedCvExportDialog(environment),
    localAppData,
    readinessStore,
    runWorkspaceRootPath: path.join(paths.rootDirectoryPath, 'runs'),
    worker: createTailoredApplicationGenerationWorker({
      environment,
    }),
  })

  await tailoredApplication.recoverInterruptedGeneration()

  return {
    aiWorker,
    onOriginalCvImported: async () => {
      await readinessStore.setStartupDestination('workspace_empty')
    },
    originalCv: createOriginalCvService({
      extractTextFromDocx,
      extractTextFromPdf,
      localAppData,
    }),
    settings: createSettingsService({
      browserSessionRootPath: path.join(paths.rootDirectoryPath, 'browser-sessions'),
      closeActiveJobs: async () => {
        await tailoredApplication.abandonPendingGeneration()
      },
      getAppVersion: () => {
        return app.getVersion()
      },
      localAppData,
      restartApp: () => {
        if (environment.CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET === 'true') {
          return Promise.resolve()
        }

        app.relaunch()
        app.quit()

        return Promise.resolve()
      },
      workerCommand: environment.CV_MAXXING_AI_WORKER_CODEX_COMMAND ?? 'codex',
    }),
    tailoredApplication,
    vacancy: createVacancyService({
      localAppData,
      openVacancyBrowserSession: async ({ shouldCapturePage, url }) => {
        return await vacancyBrowserSession.openSession({
          shouldCapturePage,
          url,
        })
      },
    }),
  }
}

function parsePendingGenerationCommand(
  rawCommand: string | undefined,
): PendingGenerationCommand | null {
  if (rawCommand === undefined || rawCommand.trim() === '') {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawCommand) as unknown

    if (!isPendingGenerationCommand(parsedValue)) {
      return null
    }

    return parsedValue
  } catch {
    return null
  }
}

function isPendingGenerationCommand(value: unknown): value is PendingGenerationCommand {
  return (
    value !== null &&
    typeof value === 'object' &&
    'commandId' in value &&
    typeof value.commandId === 'string' &&
    'originalCvId' in value &&
    typeof value.originalCvId === 'string' &&
    'originalCvLabel' in value &&
    typeof value.originalCvLabel === 'string' &&
    'vacancyId' in value &&
    typeof value.vacancyId === 'string' &&
    'vacancyDraft' in value &&
    value.vacancyDraft !== null &&
    typeof value.vacancyDraft === 'object' &&
    'text' in value.vacancyDraft &&
    typeof value.vacancyDraft.text === 'string' &&
    'url' in value.vacancyDraft &&
    typeof value.vacancyDraft.url === 'string'
  )
}

function parseStartupDestination(value: string | undefined): StartupDestination | null {
  if (
    value === 'first_launch' ||
    value === 'workspace_active' ||
    value === 'workspace_empty' ||
    value === 'workspace_loading'
  ) {
    return value
  }

  return null
}

async function startDesktopAppRuntime(): Promise<void> {
  const runtimeServices = await createRuntimeServices()

  await createDesktopAppBootstrap(
    createElectronRuntimeDependencies({
      aiWorker: runtimeServices.aiWorker,
      app,
      browserWindowConstructor: BrowserWindow,
      ipcMain,
      onOriginalCvImported: runtimeServices.onOriginalCvImported,
      originalCv: runtimeServices.originalCv,
      platform: process.platform,
      preloadPath,
      rendererDevelopmentUrl,
      rendererIndexPath,
      settings: runtimeServices.settings,
      tailoredApplication: runtimeServices.tailoredApplication,
      vacancy: runtimeServices.vacancy,
    }),
  ).start()
}

if (process.env.VITEST !== 'true') {
  void startDesktopAppRuntime().catch((error: unknown) => {
    throw error
  })
}

function createAdaptedCvExportDialog(environment: RuntimeEnvironment) {
  if (
    environment.CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH !== undefined &&
    environment.CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH !== ''
  ) {
    return {
      showSaveDialog: () => {
        return Promise.resolve({
          canceled: false,
          filePath: environment.CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH,
        })
      },
    }
  }

  return dialog
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
