import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getAiWorkerPreflight } from './ai-worker-preflight-service.js'
import { AI_WORKER_IPC_CHANNELS } from '../shared/ipc.js'
import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'

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
  }
  width: number
}

interface BrowserWindowModule {
  create: (options: DesktopBrowserWindowOptions) => BrowserWindowLike
  getAllWindows: () => BrowserWindowLike[]
}

interface IpcMainLike {
  handle: (channel: string, handler: () => Promise<AiWorkerPreflightResult>) => void
}

interface DesktopAppBootstrapDependencies {
  app: AppLike
  browserWindow: BrowserWindowModule
  getAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>
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
  app: ElectronAppLike
  browserWindowConstructor: ElectronBrowserWindowConstructor
  getAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>
  ipcMain: IpcMainLike
  platform: NodeJS.Platform
  preloadPath: string
  rendererDevelopmentUrl?: string
  rendererIndexPath: string
}

export function createDesktopAppBootstrap({
  app,
  browserWindow,
  getAiWorkerPreflight,
  ipcMain,
  platform,
  preloadPath,
  rendererDevelopmentUrl,
  rendererIndexPath,
}: DesktopAppBootstrapDependencies): { start: () => Promise<void> } {
  function registerIpcHandlers(): void {
    ipcMain.handle(AI_WORKER_IPC_CHANNELS.getPreflight, () => {
      return getAiWorkerPreflight()
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
  app,
  browserWindowConstructor,
  getAiWorkerPreflight,
  ipcMain,
  platform,
  preloadPath,
  rendererDevelopmentUrl,
  rendererIndexPath,
}: RuntimeDependencyOptions): DesktopAppBootstrapDependencies {
  return {
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
    getAiWorkerPreflight,
    ipcMain,
    platform,
    preloadPath,
    rendererDevelopmentUrl,
    rendererIndexPath,
  }
}

if (process.env.VITEST !== 'true') {
  void createDesktopAppBootstrap(
    createElectronRuntimeDependencies({
      app,
      browserWindowConstructor: BrowserWindow,
      getAiWorkerPreflight,
      ipcMain,
      platform: process.platform,
      preloadPath,
      rendererDevelopmentUrl,
      rendererIndexPath,
    }),
  )
    .start()
    .catch((error: unknown) => {
      throw error
    })
}
