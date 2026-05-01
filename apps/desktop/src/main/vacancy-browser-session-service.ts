import { createRequire } from 'node:module'
import path from 'node:path'
import type { Session } from 'electron'

import {
  createVacancyUrlIntakeInteractionScript,
  isVacancyUrlIntakeInteractionResult,
  type VacancyUrlIntakeInteractionRequest,
} from './vacancy-url-intake-interactions.js'

export interface VacancyBrowserPageSnapshot {
  html: string
  pageTitle: string | null
  resolvedUrl: string
}

export type VacancyBrowserInteractionRequester = (
  snapshot: VacancyBrowserPageSnapshot,
) => Promise<VacancyUrlIntakeInteractionRequest | null>

export interface VacancyBrowserSessionService {
  captureSessionPage: (input: {
    requestInteraction?: VacancyBrowserInteractionRequester
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    signal?: AbortSignal
    url: string
  }) => Promise<VacancyBrowserPageSnapshot | null>
  openSession: (input: {
    requestInteraction?: VacancyBrowserInteractionRequester
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    signal?: AbortSignal
    url: string
  }) => Promise<VacancyBrowserPageSnapshot | null>
}

interface BrowserSessionServiceDependencies {
  autoCloseAfterFirstObservation?: boolean
  browserWindowConstructor?: BrowserWindowConstructor
  createSession?: (profilePath: string) => Session | Promise<Session>
  profileRootPath: string
  testResolvedUrl?: string
  testSnapshotHtml?: string
}

interface BrowserWindowLike {
  close: () => void
  isDestroyed: () => boolean
  loadURL: (url: string) => Promise<void>
  once: (eventName: string, listener: () => void) => void
  webContents: BrowserWebContentsLike
}

type BrowserWindowConstructor = new (options: Record<string, unknown>) => BrowserWindowLike

interface BrowserWebContentsLike {
  executeJavaScript: (code: string) => Promise<unknown>
  on: (eventName: string, listener: () => void) => void
}

interface ElectronRuntime {
  BrowserWindow: BrowserWindowConstructor
  session: {
    fromPath: (profilePath: string) => Session
  }
}

const require = createRequire(import.meta.url)

const browserCaptureScript = `(() => {
  const isVisibleFrame = (frameElement) => {
    const style = window.getComputedStyle(frameElement)
    const rect = frameElement.getBoundingClientRect()

    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 &&
      rect.height > 0
  }
  const documentClone = document.body?.cloneNode(true)

  if (documentClone !== undefined && documentClone !== null) {
    const frameElements = Array.from(document.querySelectorAll('iframe, frame'))
    const clonedFrameElements = Array.from(documentClone.querySelectorAll('iframe, frame'))

    for (const [index, frameElement] of frameElements.entries()) {
      if (!isVisibleFrame(frameElement)) {
        continue
      }

      try {
        const frameBodyHtml = frameElement.contentDocument?.body?.innerHTML ?? ''

        if (frameBodyHtml.trim() === '') {
          continue
        }

        const framePlaceholder = document.createElement('section')
        framePlaceholder.setAttribute('data-cv-maxxing-readable-frame', 'true')
        framePlaceholder.innerHTML = frameBodyHtml

        const clonedFrame = clonedFrameElements[index]

        if (clonedFrame !== undefined) {
          clonedFrame.replaceWith(framePlaceholder)
        }
      } catch {
        continue
      }
    }
  }

  return {
    html: documentClone?.innerHTML ?? document.body?.innerHTML ?? '',
    pageTitle: document.title === '' ? null : document.title,
    resolvedUrl: window.location.href,
  }
})()`
const INTERACTIVE_OBSERVATION_INTERVAL_MS = 500
const SILENT_CAPTURE_OBSERVATION_INTERVAL_MS = 250
const SILENT_CAPTURE_TIMEOUT_MS = 3000
const SILENT_INTERACTION_CAPTURE_TIMEOUT_MS = 90_000

export function createVacancyBrowserSessionService({
  autoCloseAfterFirstObservation = false,
  browserWindowConstructor,
  createSession,
  profileRootPath,
  testResolvedUrl,
  testSnapshotHtml,
}: BrowserSessionServiceDependencies): VacancyBrowserSessionService {
  const resolvedBrowserWindowConstructor =
    browserWindowConstructor ?? loadElectronRuntime().BrowserWindow
  const resolvedCreateSession =
    createSession ??
    ((profilePath: string) => {
      return loadElectronRuntime().session.fromPath(profilePath)
    })
  const shouldAutoCloseAfterObservation =
    autoCloseAfterFirstObservation && testSnapshotHtml !== undefined

  return {
    captureSessionPage: async ({
      requestInteraction,
      shouldCapturePage,
      signal,
      url,
    }: {
      requestInteraction?: VacancyBrowserInteractionRequester
      shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
      signal?: AbortSignal
      url: string
    }): Promise<VacancyBrowserPageSnapshot | null> => {
      const vacancyBrowserWindow = await createVacancyBrowserWindow({
        browserWindowConstructor: resolvedBrowserWindowConstructor,
        createSession: resolvedCreateSession,
        profileRootPath,
        show: false,
      })
      let hasSettled = false
      let latestValidSnapshot: VacancyBrowserPageSnapshot | null = null
      let observationIntervalId: ReturnType<typeof setInterval> | null = null
      let observationTimeoutId: ReturnType<typeof setTimeout> | null = null
      let isProcessingSnapshot = false

      return await new Promise<VacancyBrowserPageSnapshot | null>((resolve) => {
        const settle = (snapshot: VacancyBrowserPageSnapshot | null): void => {
          if (hasSettled) {
            return
          }

          hasSettled = true

          if (observationIntervalId !== null) {
            clearInterval(observationIntervalId)
            observationIntervalId = null
          }

          if (observationTimeoutId !== null) {
            clearTimeout(observationTimeoutId)
            observationTimeoutId = null
          }

          signal?.removeEventListener('abort', abortHandler)
          resolve(snapshot)
        }

        const abortHandler = (): void => {
          closeWindow()
          settle(null)
        }

        const closeWindow = (): void => {
          if (vacancyBrowserWindow.isDestroyed()) {
            return
          }

          vacancyBrowserWindow.close()
        }

        const observeCurrentPage = async (): Promise<void> => {
          if (hasSettled || isProcessingSnapshot || vacancyBrowserWindow.isDestroyed()) {
            return
          }

          isProcessingSnapshot = true

          const snapshot = await captureCurrentPage({
            fallbackResolvedUrl: testResolvedUrl,
            webContents: vacancyBrowserWindow.webContents,
          })

          if (snapshot === null) {
            isProcessingSnapshot = false

            return
          }

          // Drop stale vacancy snapshots when later observations go off-target.
          latestValidSnapshot = shouldCapturePage(snapshot) ? snapshot : null

          if (latestValidSnapshot === null || requestInteraction === undefined) {
            isProcessingSnapshot = false

            return
          }

          const interaction = await requestInteraction(latestValidSnapshot)

          if (interaction === null) {
            closeWindow()
            settle(latestValidSnapshot)
            isProcessingSnapshot = false

            return
          }

          const interactionResult = await executeVacancyUrlIntakeInteraction({
            interaction,
            shouldCapturePage,
            webContents: vacancyBrowserWindow.webContents,
          })

          if (interactionResult === 'rejected') {
            latestValidSnapshot = null
            closeWindow()
            settle(null)
            isProcessingSnapshot = false

            return
          }

          const interactedSnapshot = await captureCurrentPage({
            fallbackResolvedUrl: testResolvedUrl,
            webContents: vacancyBrowserWindow.webContents,
          })

          latestValidSnapshot =
            interactedSnapshot !== null && shouldCapturePage(interactedSnapshot)
              ? interactedSnapshot
              : null
          isProcessingSnapshot = false
        }

        const startSilentObservation = (): void => {
          if (observationIntervalId !== null) {
            return
          }

          observeCurrentPage().catch(() => {
            settle(requestInteraction === undefined ? latestValidSnapshot : null)
          })

          observationIntervalId = setInterval(() => {
            observeCurrentPage().catch(() => {
              settle(requestInteraction === undefined ? latestValidSnapshot : null)
            })
          }, SILENT_CAPTURE_OBSERVATION_INTERVAL_MS)

          const observationTimeoutMs =
            requestInteraction === undefined
              ? SILENT_CAPTURE_TIMEOUT_MS
              : SILENT_INTERACTION_CAPTURE_TIMEOUT_MS

          observationTimeoutId = setTimeout(() => {
            closeWindow()
            settle(requestInteraction === undefined ? latestValidSnapshot : null)
          }, observationTimeoutMs)
        }

        vacancyBrowserWindow.once('closed', () => {
          settle(latestValidSnapshot)
        })
        signal?.addEventListener('abort', abortHandler, {
          once: true,
        })
        vacancyBrowserWindow.webContents.on('did-finish-load', () => {
          startSilentObservation()
        })

        vacancyBrowserWindow
          .loadURL(
            createBrowserSessionUrl({
              testSnapshotHtml,
              url,
            }),
          )
          .catch(() => {
            settle(latestValidSnapshot)
          })
      })
    },
    openSession: async ({
      requestInteraction,
      shouldCapturePage,
      signal,
      url,
    }: {
      requestInteraction?: VacancyBrowserInteractionRequester
      shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
      signal?: AbortSignal
      url: string
    }): Promise<VacancyBrowserPageSnapshot | null> => {
      const vacancyBrowserWindow = await createVacancyBrowserWindow({
        browserWindowConstructor: resolvedBrowserWindowConstructor,
        createSession: resolvedCreateSession,
        profileRootPath,
        show: true,
      })
      let hasSettled = false
      let latestValidSnapshot: VacancyBrowserPageSnapshot | null = null
      let observationIntervalId: ReturnType<typeof setInterval> | null = null
      let isProcessingSnapshot = false

      return await new Promise<VacancyBrowserPageSnapshot | null>((resolve) => {
        const settle = (snapshot: VacancyBrowserPageSnapshot | null): void => {
          if (hasSettled) {
            return
          }

          hasSettled = true

          if (observationIntervalId !== null) {
            clearInterval(observationIntervalId)
            observationIntervalId = null
          }

          signal?.removeEventListener('abort', abortHandler)
          resolve(snapshot)
        }

        const abortHandler = (): void => {
          closeWindow()
          settle(null)
        }

        const closeWindow = (): void => {
          if (vacancyBrowserWindow.isDestroyed()) {
            return
          }

          vacancyBrowserWindow.close()
        }

        const observeCurrentPage = async (): Promise<void> => {
          if (hasSettled || isProcessingSnapshot || vacancyBrowserWindow.isDestroyed()) {
            return
          }

          isProcessingSnapshot = true

          const snapshot = await captureCurrentPage({
            fallbackResolvedUrl: testResolvedUrl,
            webContents: vacancyBrowserWindow.webContents,
          })

          if (snapshot === null) {
            isProcessingSnapshot = false

            return
          }

          // Drop stale vacancy snapshots when later observations go off-target.
          latestValidSnapshot = shouldCapturePage(snapshot) ? snapshot : null

          if (latestValidSnapshot !== null && requestInteraction !== undefined) {
            const interaction = await requestInteraction(latestValidSnapshot)

            if (interaction === null) {
              isProcessingSnapshot = false

              return
            }

            const interactionResult = await executeVacancyUrlIntakeInteraction({
              interaction,
              shouldCapturePage,
              webContents: vacancyBrowserWindow.webContents,
            })

            if (interactionResult === 'rejected') {
              latestValidSnapshot = null
              closeWindow()
              settle(null)
              isProcessingSnapshot = false

              return
            }

            const interactedSnapshot = await captureCurrentPage({
              fallbackResolvedUrl: testResolvedUrl,
              webContents: vacancyBrowserWindow.webContents,
            })

            latestValidSnapshot =
              interactedSnapshot !== null && shouldCapturePage(interactedSnapshot)
                ? interactedSnapshot
                : null
          }

          if (shouldAutoCloseAfterObservation) {
            closeWindow()
          }

          isProcessingSnapshot = false
        }

        const startInteractiveObservation = (): void => {
          if (observationIntervalId !== null) {
            return
          }

          observeCurrentPage().catch(() => {
            settle(requestInteraction === undefined ? latestValidSnapshot : null)
          })

          observationIntervalId = setInterval(() => {
            observeCurrentPage().catch(() => {
              settle(requestInteraction === undefined ? latestValidSnapshot : null)
            })
          }, INTERACTIVE_OBSERVATION_INTERVAL_MS)
        }

        vacancyBrowserWindow.once('closed', () => {
          settle(latestValidSnapshot)
        })
        signal?.addEventListener('abort', abortHandler, {
          once: true,
        })
        vacancyBrowserWindow.webContents.on('did-finish-load', () => {
          startInteractiveObservation()

          observeCurrentPage().catch(() => {
            settle(requestInteraction === undefined ? latestValidSnapshot : null)
          })
        })

        vacancyBrowserWindow
          .loadURL(
            createBrowserSessionUrl({
              testSnapshotHtml,
              url,
            }),
          )
          .catch(() => {
            settle(latestValidSnapshot)
          })
      })
    },
  }
}

async function createVacancyBrowserWindow({
  browserWindowConstructor,
  createSession,
  profileRootPath,
  show,
}: {
  browserWindowConstructor: BrowserWindowConstructor
  createSession: (profilePath: string) => Session | Promise<Session>
  profileRootPath: string
  show: boolean
}): Promise<BrowserWindowLike> {
  const profilePath = path.join(profileRootPath, 'vacancy-browser-session')
  const managedSession = await createSession(profilePath)

  return new browserWindowConstructor({
    autoHideMenuBar: true,
    backgroundColor: '#08141f',
    height: 900,
    show,
    title: 'Vacancy Browser Session',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: managedSession,
    },
    width: 1280,
  })
}

function loadElectronRuntime(): ElectronRuntime {
  return require('electron') as ElectronRuntime
}

function createBrowserSessionUrl({
  testSnapshotHtml,
  url,
}: {
  testSnapshotHtml: string | undefined
  url: string
}): string {
  if (testSnapshotHtml === undefined) {
    return url
  }

  return `data:text/html;charset=utf-8,${encodeURIComponent(testSnapshotHtml)}`
}

async function captureCurrentPage({
  fallbackResolvedUrl,
  webContents,
}: {
  fallbackResolvedUrl: string | undefined
  webContents: BrowserWebContentsLike
}): Promise<VacancyBrowserPageSnapshot | null> {
  try {
    const snapshot = (await webContents.executeJavaScript(
      browserCaptureScript,
    )) as VacancyBrowserPageSnapshot | null

    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      typeof snapshot.html !== 'string' ||
      typeof snapshot.resolvedUrl !== 'string' ||
      ('pageTitle' in snapshot &&
        snapshot.pageTitle !== null &&
        typeof snapshot.pageTitle !== 'string')
    ) {
      return null
    }

    return {
      html: snapshot.html,
      pageTitle: snapshot.pageTitle,
      resolvedUrl: fallbackResolvedUrl ?? snapshot.resolvedUrl,
    }
  } catch {
    return null
  }
}

async function executeVacancyUrlIntakeInteraction({
  interaction,
  shouldCapturePage,
  webContents,
}: {
  interaction: VacancyUrlIntakeInteractionRequest
  shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
  webContents: BrowserWebContentsLike
}): Promise<'applied' | 'rejected'> {
  const result = await webContents.executeJavaScript(
    createVacancyUrlIntakeInteractionScript({
      interaction,
    }),
  )

  if (!isVacancyUrlIntakeInteractionResult(result)) {
    return 'rejected'
  }

  if (result.status === 'rejected') {
    return 'rejected'
  }

  const syntheticSnapshot = {
    html: '',
    pageTitle: null,
    resolvedUrl: result.afterUrl,
  } satisfies VacancyBrowserPageSnapshot

  return shouldCapturePage(syntheticSnapshot) ? 'applied' : 'rejected'
}
