import { BrowserWindow, session, type Session, type WebContents } from 'electron'
import path from 'node:path'

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
  browserWindowConstructor?: typeof BrowserWindow
  createSession?: (profilePath: string) => Session | Promise<Session>
  profileRootPath: string
  testResolvedUrl?: string
  testSnapshotHtml?: string
}

const browserCaptureScript = `(() => {
  return {
    html: document.body?.innerHTML ?? '',
    pageTitle: document.title === '' ? null : document.title,
    resolvedUrl: window.location.href,
  }
})()`

export function createVacancyBrowserSessionService({
  autoCloseAfterFirstObservation = false,
  browserWindowConstructor = BrowserWindow,
  createSession = (profilePath: string) => {
    return session.fromPath(profilePath)
  },
  profileRootPath,
  testResolvedUrl,
  testSnapshotHtml,
}: BrowserSessionServiceDependencies): VacancyBrowserSessionService {
  return {
    openSession: async ({
      shouldCapturePage,
      url,
    }: {
      shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
      url: string
    }): Promise<VacancyBrowserPageSnapshot | null> => {
      const profilePath = path.join(profileRootPath, 'vacancy-browser-session')
      const managedSession = await createSession(profilePath)
      const vacancyBrowserWindow = new browserWindowConstructor({
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
      let latestSnapshot: VacancyBrowserPageSnapshot | null = null

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

          latestSnapshot = snapshot

          if (shouldCapturePage(snapshot)) {
            settle(snapshot)
            closeWindow()

            return
          }

          if (autoCloseAfterFirstObservation) {
            closeWindow()
          }
        }

        vacancyBrowserWindow.once('closed', () => {
          settle(latestSnapshot)
        })
        vacancyBrowserWindow.webContents.on('did-finish-load', () => {
          observeCurrentPage().catch(() => {
            settle(latestSnapshot)
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
            settle(latestSnapshot)
          })
      })
    },
  }
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
  webContents: WebContents
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
