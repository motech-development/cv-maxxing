import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AI_WORKER_IPC_CHANNELS } from '../shared/ipc.js'
import type { StartupDestination } from '../shared/startup-destination.js'
import { createAiWorkerReadinessStore } from './ai-worker-readiness-store.js'
import {
  createAiWorkerPreflightService,
  type AiWorkerPreflightService,
  type PendingGenerationCommand,
} from './ai-worker-preflight-service.js'
import { createLocalAppDataPaths, openLocalAppData } from './local-app-data-service.js'
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
  handle: (channel: string, handler: () => Promise<unknown>) => void
}

interface DesktopAppBootstrapDependencies {
  aiWorker: AiWorkerPreflightService
  app: AppLike
  browserWindow: BrowserWindowModule
  ipcMain: IpcMainLike
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
  platform: NodeJS.Platform
  preloadPath: string
  rendererDevelopmentUrl?: string
  rendererIndexPath: string
}

interface RuntimeEnvironment {
  CHECKING_TIMEOUT_MS?: string
  CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS?: string
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
  platform,
  preloadPath,
  rendererDevelopmentUrl,
  rendererIndexPath,
}: DesktopAppBootstrapDependencies): { start: () => Promise<void> } {
  function registerIpcHandlers(): void {
    ipcMain.handle(AI_WORKER_IPC_CHANNELS.getPreflight, () => {
      return aiWorker.getAiWorkerPreflight()
    })
    ipcMain.handle(AI_WORKER_IPC_CHANNELS.getStartupDestination, () => {
      return aiWorker.getStartupDestination()
    })
    ipcMain.handle(AI_WORKER_IPC_CHANNELS.retryPreflight, () => {
      return aiWorker.retryAiWorkerPreflight()
    })
    ipcMain.handle(AI_WORKER_IPC_CHANNELS.startSignIn, () => {
      return aiWorker.startAiWorkerSignIn()
    })
    ipcMain.handle(AI_WORKER_IPC_CHANNELS.openSetupGuide, () => {
      return aiWorker.openAiWorkerSetupGuide()
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
    platform,
    preloadPath,
    rendererDevelopmentUrl,
    rendererIndexPath,
  }
}

async function createRuntimeAiWorkerPreflightService(): Promise<AiWorkerPreflightService> {
  const environment = process.env as RuntimeEnvironment
  const paths = createLocalAppDataPaths(path.join(app.getPath('userData'), 'local-app-data'))
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

  return createAiWorkerPreflightService({
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
  const aiWorker = await createRuntimeAiWorkerPreflightService()

  await createDesktopAppBootstrap(
    createElectronRuntimeDependencies({
      aiWorker,
      app,
      browserWindowConstructor: BrowserWindow,
      ipcMain,
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
