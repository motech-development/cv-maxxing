import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AI_WORKER_IPC_CHANNELS, ORIGINAL_CV_IPC_CHANNELS } from '../shared/ipc.js'
import type { OriginalCvImportInput, OriginalCvImportResult } from '../shared/original-cv.js'
import type { StartupDestination } from '../shared/startup-destination.js'
import { createAiWorkerReadinessStore } from './ai-worker-readiness-store.js'
import {
  createAiWorkerPreflightService,
  type AiWorkerPreflightService,
  type PendingGenerationCommand,
} from './ai-worker-preflight-service.js'
import { createLocalAppDataPaths, openLocalAppData } from './local-app-data-service.js'
import { extractTextFromDocx, extractTextFromPdf } from './original-cv-document-extractor.js'
import {
  OriginalCvImportError,
  createOriginalCvService,
  type OriginalCvService,
} from './original-cv-service.js'
import { createSafeStorageKeychain } from './safe-storage-keychain.js'

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
  height: number
  show: boolean
  title: string
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
}

interface RuntimeEnvironment {
  CHECKING_TIMEOUT_MS?: string
  CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS?: string
  CV_MAXXING_LOCAL_APP_DATA_ROOT?: string
  CV_MAXXING_AI_WORKER_RETRY_STATUS?: string
  CV_MAXXING_AI_WORKER_SIGN_IN_STATUS?: string
  CV_MAXXING_PENDING_GENERATION_COMMAND?: string
  CV_MAXXING_STARTUP_DESTINATION?: string
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
  }

  async function createMainWindow(): Promise<void> {
    const mainWindow = browserWindow.create({
      backgroundColor: '#08141f',
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
  }
}

async function createRuntimeServices(): Promise<{
  aiWorker: AiWorkerPreflightService
  onOriginalCvImported: () => Promise<void>
  originalCv: OriginalCvService
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

  return {
    aiWorker: createAiWorkerPreflightService({
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
    }),
    onOriginalCvImported: async () => {
      await readinessStore.setStartupDestination('workspace_empty')
    },
    originalCv: createOriginalCvService({
      extractTextFromDocx,
      extractTextFromPdf,
      localAppData,
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
    'vacancyText' in value &&
    typeof value.vacancyText === 'string'
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
    }),
  ).start()
}

if (process.env.VITEST !== 'true') {
  void startDesktopAppRuntime().catch((error: unknown) => {
    throw error
  })
}

function parseOriginalCvImportInput(payload: unknown): OriginalCvImportInput {
  if (!isOriginalCvImportPayload(payload)) {
    throw new TypeError('Invalid original CV import payload.')
  }

  return payload
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
