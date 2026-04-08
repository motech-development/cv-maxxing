import { beforeEach, expect, test, vi } from 'vitest'

import { AI_WORKER_IPC_CHANNELS } from '../../shared/ipc.js'
import { createDesktopAppBootstrap, createElectronRuntimeDependencies } from '../main.js'

type AppEvent = 'activate' | 'window-all-closed'

function createAppDouble() {
  const eventHandlers = new Map<AppEvent, () => void>()

  return {
    app: {
      on: vi.fn((event: AppEvent, handler: () => void) => {
        eventHandlers.set(event, handler)
      }),
      quit: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
    },
    eventHandlers,
  }
}

function createBrowserWindowDouble() {
  const loadFile = vi.fn(() => Promise.resolve())
  const loadURL = vi.fn(() => Promise.resolve())
  const getAllWindows = vi.fn().mockReturnValue([])
  const constructor = vi.fn().mockImplementation(() => {
    return {
      loadFile,
      loadURL,
    }
  })

  return {
    browserWindow: {
      create: constructor,
      getAllWindows,
    },
    constructor,
    getAllWindows,
    loadFile,
    loadURL,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

test('bootstrap registers the readiness IPC contract and opens the packaged shell on startup', async () => {
  const { app, eventHandlers } = createAppDouble()
  const { browserWindow, constructor, loadFile, loadURL } = createBrowserWindowDouble()
  let registeredHandler: (() => Promise<unknown>) | undefined
  const handle = vi.fn((_, handler: () => Promise<unknown>) => {
    registeredHandler = handler
  })
  const getAiWorkerPreflight = vi.fn().mockResolvedValue({
    canResumeGeneration: false,
    message: 'Checking the local AI worker before opening your workspace.',
    provider: 'codex',
    status: 'checking',
  })

  const bootstrap = createDesktopAppBootstrap({
    app,
    browserWindow,
    getAiWorkerPreflight,
    ipcMain: {
      handle,
    },
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  })

  await bootstrap.start()

  expect(app.whenReady).toHaveBeenCalledTimes(1)
  expect(handle).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.getPreflight, expect.any(Function))
  expect(registeredHandler).toBeDefined()

  if (registeredHandler === undefined) {
    throw new Error('Expected bootstrap to register the readiness IPC handler.')
  }

  await expect(registeredHandler()).resolves.toEqual({
    canResumeGeneration: false,
    message: 'Checking the local AI worker before opening your workspace.',
    provider: 'codex',
    status: 'checking',
  })
  expect(constructor).toHaveBeenCalledWith({
    backgroundColor: '#08141f',
    height: 900,
    show: true,
    title: 'CV Maxxing',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/tmp/preload.js',
    },
    width: 1440,
  })
  expect(loadFile).toHaveBeenCalledWith('/tmp/index.html')
  expect(loadURL).not.toHaveBeenCalled()
  expect(eventHandlers.has('activate')).toBe(true)
  expect(eventHandlers.has('window-all-closed')).toBe(true)
})

test('bootstrap recreates the window on activate and quits on window-all-closed outside macOS', async () => {
  const { app, eventHandlers } = createAppDouble()
  const browserWindow = createBrowserWindowDouble()

  const bootstrap = createDesktopAppBootstrap({
    app,
    browserWindow: browserWindow.browserWindow,
    getAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    }),
    ipcMain: {
      handle: vi.fn(),
    },
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: 'http://127.0.0.1:5173',
    rendererIndexPath: '/tmp/index.html',
  })

  await bootstrap.start()

  browserWindow.getAllWindows.mockReturnValueOnce([])
  eventHandlers.get('activate')?.()

  await Promise.resolve()

  expect(browserWindow.constructor).toHaveBeenCalledTimes(2)
  expect(browserWindow.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173')

  eventHandlers.get('window-all-closed')?.()

  expect(app.quit).toHaveBeenCalledTimes(1)
})

test('bootstrap logs and swallows activate window recreation failures', async () => {
  const { app, eventHandlers } = createAppDouble()
  const browserWindow = createBrowserWindowDouble()
  const error = new Error('failed to open window')
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => null)

  browserWindow.browserWindow.create = vi
    .fn()
    .mockImplementationOnce(() => {
      return {
        loadFile: vi.fn(() => Promise.resolve()),
        loadURL: vi.fn(() => Promise.resolve()),
      }
    })
    .mockImplementationOnce(() => {
      return {
        loadFile: vi.fn(() => Promise.reject(error)),
        loadURL: vi.fn(() => Promise.resolve()),
      }
    })

  const bootstrap = createDesktopAppBootstrap({
    app,
    browserWindow: browserWindow.browserWindow,
    getAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    }),
    ipcMain: {
      handle: vi.fn(),
    },
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  })

  await bootstrap.start()

  browserWindow.getAllWindows.mockReturnValueOnce([])
  eventHandlers.get('activate')?.()

  await vi.waitFor(() => {
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to recreate the main window on activate.',
      error,
    )
  })
})

test('bootstrap keeps the app open when every window closes on macOS', async () => {
  const { app, eventHandlers } = createAppDouble()
  const browserWindow = createBrowserWindowDouble()

  const bootstrap = createDesktopAppBootstrap({
    app,
    browserWindow: browserWindow.browserWindow,
    getAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    }),
    ipcMain: {
      handle: vi.fn(),
    },
    platform: 'darwin',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  })

  await bootstrap.start()
  eventHandlers.get('window-all-closed')?.()

  expect(app.quit).not.toHaveBeenCalled()
})

test('runtime dependencies adapt Electron primitives for the bootstrap contract', async () => {
  const eventHandlers = new Map<AppEvent, (...args: unknown[]) => void>()
  const quit = vi.fn()
  const whenReady = vi.fn(() => Promise.resolve())
  const on = vi.fn((event: AppEvent, handler: (...args: unknown[]) => void) => {
    eventHandlers.set(event, handler)
  })
  const loadFile = vi.fn(() => Promise.resolve())
  const loadURL = vi.fn(() => Promise.resolve())
  const getAllWindows = vi.fn().mockReturnValue([{ loadFile, loadURL }])
  const constructor = vi.fn()
  const BrowserWindowDouble = Object.assign(
    function BrowserWindowDouble(options: unknown) {
      constructor(options)

      return {
        loadFile,
        loadURL,
      }
    } as unknown as new (options: unknown) => {
      loadFile: typeof loadFile
      loadURL: typeof loadURL
    },
    {
      getAllWindows,
    },
  )
  const getAiWorkerPreflight = vi.fn().mockResolvedValue({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })

  const runtimeDependencies = createElectronRuntimeDependencies({
    app: {
      on,
      quit,
      whenReady,
    },
    browserWindowConstructor: BrowserWindowDouble,
    getAiWorkerPreflight,
    ipcMain: {
      handle: vi.fn(),
    },
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: 'http://127.0.0.1:5173',
    rendererIndexPath: '/tmp/index.html',
  })

  await runtimeDependencies.app.whenReady()
  runtimeDependencies.app.quit()

  const activateHandler = vi.fn()
  const closeHandler = vi.fn()

  runtimeDependencies.app.on('activate', activateHandler)
  runtimeDependencies.app.on('window-all-closed', closeHandler)

  eventHandlers.get('activate')?.('ignored')
  eventHandlers.get('window-all-closed')?.('ignored')

  runtimeDependencies.browserWindow.create({
    backgroundColor: '#08141f',
    height: 900,
    show: true,
    title: 'CV Maxxing',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/tmp/preload.js',
    },
    width: 1440,
  })

  expect(whenReady).toHaveBeenCalledTimes(1)
  expect(quit).toHaveBeenCalledTimes(1)
  expect(on).toHaveBeenCalledWith('activate', expect.any(Function))
  expect(on).toHaveBeenCalledWith('window-all-closed', expect.any(Function))
  expect(activateHandler).toHaveBeenCalledTimes(1)
  expect(closeHandler).toHaveBeenCalledTimes(1)
  expect(constructor).toHaveBeenCalledTimes(1)
  expect(getAllWindows).not.toHaveBeenCalled()
  expect(runtimeDependencies.browserWindow.getAllWindows()).toEqual([{ loadFile, loadURL }])
  await expect(runtimeDependencies.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
})
