import { createRequire } from 'node:module'
import path from 'node:path'
import type { Session } from 'electron'

export interface VacancyBrowserPageSnapshot {
  html: string
  pageTitle: string | null
  resolvedUrl: string
}

export interface VacancyBrowserSessionService {
  openSession: (input: {
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
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
  return {
    html: document.body?.innerHTML ?? '',
    pageTitle: document.title === '' ? null : document.title,
    resolvedUrl: window.location.href,
  }
})()`

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
    openSession: async ({
      shouldCapturePage,
      url,
    }: {
      shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
      url: string
    }): Promise<VacancyBrowserPageSnapshot | null> => {
      const profilePath = path.join(profileRootPath, 'vacancy-browser-session')
      const managedSession = await resolvedCreateSession(profilePath)
      const vacancyBrowserWindow = new resolvedBrowserWindowConstructor({
        autoHideMenuBar: true,
        backgroundColor: '#08141f',
        height: 900,
        show: true,
        title: 'Vacancy Browser Session',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          session: managedSession,
        },
        width: 1280,
      })
      let hasSettled = false
      let latestValidSnapshot: VacancyBrowserPageSnapshot | null = null

      return await new Promise<VacancyBrowserPageSnapshot | null>((resolve) => {
        const settle = (snapshot: VacancyBrowserPageSnapshot | null): void => {
          if (hasSettled) {
            return
          }

          hasSettled = true
          resolve(snapshot)
        }

        const closeWindow = (): void => {
          if (vacancyBrowserWindow.isDestroyed()) {
            return
          }

          vacancyBrowserWindow.close()
        }

        const observeCurrentPage = async (): Promise<void> => {
          if (hasSettled || vacancyBrowserWindow.isDestroyed()) {
            return
          }

          const snapshot = await captureCurrentPage({
            fallbackResolvedUrl: testResolvedUrl,
            webContents: vacancyBrowserWindow.webContents,
          })

          if (snapshot === null) {
            return
          }

          latestValidSnapshot = shouldCapturePage(snapshot) ? snapshot : null

          if (shouldAutoCloseAfterObservation) {
            closeWindow()
          }
        }

        vacancyBrowserWindow.once('closed', () => {
          settle(latestValidSnapshot)
        })
        vacancyBrowserWindow.webContents.on('did-finish-load', () => {
          observeCurrentPage().catch(() => {
            settle(latestValidSnapshot)
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
