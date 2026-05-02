import { createRequire } from 'node:module'
import path from 'node:path'
import type { Session } from 'electron'

export interface VacancyBrowserPageSnapshot {
  html: string
  pageTitle: string | null
  resolvedUrl: string
}

export type VacancyBrowserPageReadingInteraction =
  | {
      kind: 'click'
      selector: string
    }
  | {
      direction?: 'down' | 'up'
      kind: 'scroll'
      pixels?: number
    }
  | {
      kind: 'submit_form'
      selector?: string
    }
  | {
      kind: 'type'
      selector?: string
      text?: string
    }
  | {
      kind: 'upload_file'
      selector?: string
    }
  | {
      kind: 'wait'
      milliseconds?: number
    }

export type VacancyBrowserPageInteractionResult =
  | {
      kind: 'captured'
      snapshot: VacancyBrowserPageSnapshot
    }
  | {
      kind: 'rejected'
      reason: string
    }

export interface VacancyBrowserPageReviewInput {
  applyReadingInteraction: (
    interaction: VacancyBrowserPageReadingInteraction,
  ) => Promise<VacancyBrowserPageInteractionResult>
  getRemainingTimeMs: () => number
  initialSnapshot: VacancyBrowserPageSnapshot
}

export type VacancyBrowserPageReview = (
  input: VacancyBrowserPageReviewInput,
) => Promise<VacancyBrowserPageSnapshot | null>

interface CaptureSessionPageInput {
  reviewPage?: VacancyBrowserPageReview
  shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
  timeBudgetMs?: number
  url: string
}

export interface VacancyBrowserSessionService {
  captureSessionPage: (input: CaptureSessionPageInput) => Promise<VacancyBrowserPageSnapshot | null>
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

const browserCaptureScript = String.raw`(() => {
  const isVisible = (element) => {
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number.parseFloat(style.opacity || '1') > 0 &&
      rect.width > 0 &&
      rect.height > 0
    )
  }
  const embeddedFrameSections = Array.from(document.querySelectorAll('iframe, frame'))
    .filter(isVisible)
    .map((frame, index) => {
      try {
        const frameDocument = frame.contentDocument
        const frameHtml = frameDocument?.body?.innerHTML?.trim() ?? ''

        if (frameHtml === '') {
          return ''
        }

        const frameTitle =
          frame.getAttribute('title') ??
          frame.getAttribute('aria-label') ??
          frameDocument?.title ??
          'embedded frame'

        return '<section data-cv-maxxing-embedded-frame="' + String(index) + '" aria-label="' +
          String(frameTitle).replaceAll('"', '&quot;') + '">' + frameHtml + '</section>'
      } catch {
        return ''
      }
    })
    .filter((html) => html !== '')

  return {
    html: [document.body?.innerHTML ?? '', ...embeddedFrameSections].join('\n'),
    pageTitle: document.title === '' ? null : document.title,
    resolvedUrl: window.location.href,
  }
})()`
const browserInteractionScript = String.raw`async (interaction, originalUrl) => {
  const wait = async (milliseconds) => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds)
    })
  }
  const capture = () => {
    const embeddedFrameSections = Array.from(document.querySelectorAll('iframe, frame'))
      .filter(isVisible)
      .map((frame, index) => {
        try {
          const frameDocument = frame.contentDocument
          const frameHtml = frameDocument?.body?.innerHTML?.trim() ?? ''

          if (frameHtml === '') {
            return ''
          }

          const frameTitle =
            frame.getAttribute('title') ??
            frame.getAttribute('aria-label') ??
            frameDocument?.title ??
            'embedded frame'

          return '<section data-cv-maxxing-embedded-frame="' + String(index) + '" aria-label="' +
            String(frameTitle).replaceAll('"', '&quot;') + '">' + frameHtml + '</section>'
        } catch {
          return ''
        }
      })
      .filter((html) => html !== '')

    return {
      html: [document.body?.innerHTML ?? '', ...embeddedFrameSections].join('\n'),
      pageTitle: document.title === '' ? null : document.title,
      resolvedUrl: window.location.href,
    }
  }
  const reject = (reason) => {
    return {
      kind: 'rejected',
      reason,
    }
  }
  const hasSameTopLevelUrl = () => {
    const requestedUrl = new URL(originalUrl)
    const currentUrl = new URL(window.location.href)

    return (
      currentUrl.origin === requestedUrl.origin &&
      currentUrl.pathname === requestedUrl.pathname &&
      currentUrl.search === requestedUrl.search
    )
  }
  const isVisible = (element) => {
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number.parseFloat(style.opacity || '1') > 0 &&
      rect.width > 0 &&
      rect.height > 0
    )
  }
  const textFor = (element) => {
    return [
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('value'),
      element.getAttribute('href'),
    ]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase()
  }
  const unsafeActionPattern =
    /\b(apply|submit|easy apply|start application|continue application|send application|sign in|log in|login|log out|logout|sign up|register|join|account|profile|settings|password)\b/u

  if (!hasSameTopLevelUrl()) {
    return reject('top-level navigation is not allowed during vacancy intake')
  }

  if (interaction.kind === 'wait') {
    await wait(Math.min(Math.max(Number(interaction.milliseconds ?? 250), 0), 3000))

    return {
      kind: 'captured',
      snapshot: capture(),
    }
  }

  if (interaction.kind === 'scroll') {
    const requestedPixels = Number(interaction.pixels ?? 800)
    const boundedPixels = Math.min(Math.max(Math.abs(requestedPixels), 1), 2400)
    const direction = interaction.direction === 'up' ? -1 : 1

    window.scrollBy({
      behavior: 'instant',
      left: 0,
      top: boundedPixels * direction,
    })
    await wait(120)

    return {
      kind: 'captured',
      snapshot: capture(),
    }
  }

  if (interaction.kind !== 'click') {
    return reject('only reading interactions are allowed during vacancy intake')
  }

  if (typeof interaction.selector !== 'string' || interaction.selector.trim() === '') {
    return reject('click interactions require a selector')
  }

  const target = document.querySelector(interaction.selector)

  if (!(target instanceof HTMLElement) || !isVisible(target)) {
    return reject('click target is not readable')
  }

  const tagName = target.tagName.toLowerCase()
  const closestForm = target.closest('form')

  if (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    closestForm !== null
  ) {
    return reject('form interactions are not allowed during vacancy intake')
  }

  if (unsafeActionPattern.test(textFor(target))) {
    return reject('application or account actions are not allowed during vacancy intake')
  }

  const closestLink = target.closest('a[href]')

  if (closestLink !== null) {
    const linkUrl = new URL(closestLink.getAttribute('href'), window.location.href)
    const requestedUrl = new URL(originalUrl)

    if (
      linkUrl.origin !== requestedUrl.origin ||
      linkUrl.pathname !== requestedUrl.pathname ||
      linkUrl.search !== requestedUrl.search
    ) {
      return reject('external links are not allowed during vacancy intake')
    }
  }

  target.click()
  await wait(180)

  if (!hasSameTopLevelUrl()) {
    return reject('top-level navigation is not allowed during vacancy intake')
  }

  return {
    kind: 'captured',
    snapshot: capture(),
  }
}`
const INTERACTIVE_OBSERVATION_INTERVAL_MS = 500
const SILENT_CAPTURE_OBSERVATION_INTERVAL_MS = 250
const SILENT_CAPTURE_TIMEOUT_MS = 3000
const URL_INTAKE_TIME_BUDGET_MS = 90_000

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
      reviewPage,
      shouldCapturePage,
      timeBudgetMs = URL_INTAKE_TIME_BUDGET_MS,
      url,
    }: CaptureSessionPageInput): Promise<VacancyBrowserPageSnapshot | null> => {
      const vacancyBrowserWindow = await createVacancyBrowserWindow({
        browserWindowConstructor: resolvedBrowserWindowConstructor,
        createSession: resolvedCreateSession,
        profileRootPath,
        show: false,
      })
      const intakeStartedAt = Date.now()
      let hasSettled = false
      let isReviewingPage = false
      let latestValidSnapshot: VacancyBrowserPageSnapshot | null = null
      let observationIntervalId: ReturnType<typeof setInterval> | null = null
      let observationTimeoutId: ReturnType<typeof setTimeout> | null = null

      return await new Promise<VacancyBrowserPageSnapshot | null>((resolve, reject) => {
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

          closeWindow()
          resolve(snapshot)
        }

        const fail = (error: Error): void => {
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

          closeWindow()
          reject(error)
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

          if (!shouldCapturePage(snapshot)) {
            // Drop stale vacancy snapshots when later observations go off-target.
            latestValidSnapshot = null

            return
          }

          latestValidSnapshot = snapshot

          if (reviewPage === undefined || isReviewingPage) {
            return
          }

          isReviewingPage = true

          if (observationIntervalId !== null) {
            clearInterval(observationIntervalId)
            observationIntervalId = null
          }

          const reviewedSnapshot = await reviewPage({
            applyReadingInteraction: async (interaction) => {
              return await applyReadingInteraction({
                fallbackResolvedUrl: testResolvedUrl,
                interaction,
                originalUrl: url,
                shouldCapturePage,
                webContents: vacancyBrowserWindow.webContents,
              })
            },
            getRemainingTimeMs: () => {
              return Math.max(0, timeBudgetMs - (Date.now() - intakeStartedAt))
            },
            initialSnapshot: snapshot,
          })

          settle(reviewedSnapshot)
        }

        const startSilentObservation = (): void => {
          if (observationIntervalId !== null) {
            return
          }

          observeCurrentPage().catch((error: unknown) => {
            if (reviewPage === undefined) {
              settle(latestValidSnapshot)

              return
            }

            fail(error instanceof Error ? error : new Error('Vacancy page review failed.'))
          })

          observationIntervalId = setInterval(() => {
            observeCurrentPage().catch((error: unknown) => {
              if (reviewPage === undefined) {
                settle(latestValidSnapshot)

                return
              }

              fail(error instanceof Error ? error : new Error('Vacancy page review failed.'))
            })
          }, SILENT_CAPTURE_OBSERVATION_INTERVAL_MS)

          observationTimeoutId = setTimeout(
            () => {
              settle(reviewPage === undefined ? latestValidSnapshot : null)
            },
            reviewPage === undefined ? SILENT_CAPTURE_TIMEOUT_MS : timeBudgetMs,
          )
        }

        vacancyBrowserWindow.once('closed', () => {
          settle(latestValidSnapshot)
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
      shouldCapturePage,
      url,
    }: {
      shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
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

          // Drop stale vacancy snapshots when later observations go off-target.
          latestValidSnapshot = shouldCapturePage(snapshot) ? snapshot : null

          if (shouldAutoCloseAfterObservation) {
            closeWindow()
          }
        }

        const startInteractiveObservation = (): void => {
          if (observationIntervalId !== null) {
            return
          }

          observeCurrentPage().catch(() => {
            settle(latestValidSnapshot)
          })

          observationIntervalId = setInterval(() => {
            observeCurrentPage().catch(() => {
              settle(latestValidSnapshot)
            })
          }, INTERACTIVE_OBSERVATION_INTERVAL_MS)
        }

        vacancyBrowserWindow.once('closed', () => {
          settle(latestValidSnapshot)
        })
        vacancyBrowserWindow.webContents.on('did-finish-load', () => {
          startInteractiveObservation()

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

async function applyReadingInteraction({
  fallbackResolvedUrl,
  interaction,
  originalUrl,
  shouldCapturePage,
  webContents,
}: {
  fallbackResolvedUrl: string | undefined
  interaction: VacancyBrowserPageReadingInteraction
  originalUrl: string
  shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
  webContents: BrowserWebContentsLike
}): Promise<VacancyBrowserPageInteractionResult> {
  const unsafeReason = getUnsafeInteractionReason(interaction)

  if (unsafeReason !== null) {
    return {
      kind: 'rejected',
      reason: unsafeReason,
    }
  }

  const interactionResult = await executeReadingInteraction({
    fallbackResolvedUrl,
    interaction,
    originalUrl,
    webContents,
  })

  if (interactionResult.kind === 'rejected') {
    return interactionResult
  }

  if (
    !hasSameTopLevelUrl({
      originalUrl,
      resolvedUrl: interactionResult.snapshot.resolvedUrl,
    }) ||
    !shouldCapturePage(interactionResult.snapshot)
  ) {
    return {
      kind: 'rejected',
      reason: 'top-level navigation is not allowed during vacancy intake',
    }
  }

  return interactionResult
}

async function executeReadingInteraction({
  fallbackResolvedUrl,
  interaction,
  originalUrl,
  webContents,
}: {
  fallbackResolvedUrl: string | undefined
  interaction: VacancyBrowserPageReadingInteraction
  originalUrl: string
  webContents: BrowserWebContentsLike
}): Promise<VacancyBrowserPageInteractionResult> {
  try {
    const rawResult = await webContents.executeJavaScript(
      `(${browserInteractionScript})(${JSON.stringify(interaction)}, ${JSON.stringify(
        originalUrl,
      )})`,
    )
    const interactionResult = normalizeInteractionResult({
      fallbackResolvedUrl,
      rawResult,
    })

    if (interactionResult !== null) {
      return interactionResult
    }

    return {
      kind: 'rejected',
      reason: 'page interaction returned an unreadable result',
    }
  } catch {
    return {
      kind: 'rejected',
      reason: 'page interaction failed',
    }
  }
}

function normalizeInteractionResult({
  fallbackResolvedUrl,
  rawResult,
}: {
  fallbackResolvedUrl: string | undefined
  rawResult: unknown
}): VacancyBrowserPageInteractionResult | null {
  if (isVacancyBrowserPageSnapshot(rawResult)) {
    return {
      kind: 'captured',
      snapshot: {
        html: rawResult.html,
        pageTitle: rawResult.pageTitle,
        resolvedUrl: fallbackResolvedUrl ?? rawResult.resolvedUrl,
      },
    }
  }

  if (rawResult === null || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    return null
  }

  const candidate = rawResult as Record<string, unknown>

  if (candidate.kind === 'rejected' && typeof candidate.reason === 'string') {
    return {
      kind: 'rejected',
      reason: candidate.reason,
    }
  }

  if (candidate.kind !== 'captured' || !isVacancyBrowserPageSnapshot(candidate.snapshot)) {
    return null
  }

  return {
    kind: 'captured',
    snapshot: {
      html: candidate.snapshot.html,
      pageTitle: candidate.snapshot.pageTitle,
      resolvedUrl: fallbackResolvedUrl ?? candidate.snapshot.resolvedUrl,
    },
  }
}

function getUnsafeInteractionReason(
  interaction: VacancyBrowserPageReadingInteraction,
): string | null {
  if (interaction.kind === 'type') {
    return 'typing is not allowed during vacancy intake'
  }

  if (interaction.kind === 'submit_form') {
    return 'form submission is not allowed during vacancy intake'
  }

  if (interaction.kind === 'upload_file') {
    return 'file upload is not allowed during vacancy intake'
  }

  return null
}

function hasSameTopLevelUrl({
  originalUrl,
  resolvedUrl,
}: {
  originalUrl: string
  resolvedUrl: string
}): boolean {
  try {
    const requestedUrl = new URL(originalUrl)
    const currentUrl = new URL(resolvedUrl)

    return (
      currentUrl.origin === requestedUrl.origin &&
      currentUrl.pathname === requestedUrl.pathname &&
      currentUrl.search === requestedUrl.search
    )
  } catch {
    return false
  }
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

    if (!isVacancyBrowserPageSnapshot(snapshot)) {
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

function isVacancyBrowserPageSnapshot(value: unknown): value is VacancyBrowserPageSnapshot {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).html === 'string' &&
    typeof (value as Record<string, unknown>).resolvedUrl === 'string' &&
    (!Object.hasOwn(value, 'pageTitle') ||
      (value as Record<string, unknown>).pageTitle === null ||
      typeof (value as Record<string, unknown>).pageTitle === 'string')
  )
}
