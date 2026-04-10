import type { Session } from 'electron'
import { expect, test, vi } from 'vitest'

import { createVacancyBrowserSessionService } from '../vacancy-browser-session-service.js'

interface Snapshot {
  html: string
  pageTitle: string | null
  resolvedUrl: string
}

class WebContentsDouble extends EventTarget {
  constructor(private readonly snapshot: Snapshot) {
    super()
  }

  executeJavaScript(): Promise<Snapshot> {
    return Promise.resolve(this.snapshot)
  }

  on(eventName: string, listener: () => void): void {
    this.addEventListener(eventName, listener as EventListener)
  }
}

class BrowserWindowDouble extends EventTarget {
  public readonly webContents: WebContentsDouble

  private destroyed = false

  constructor(
    readonly options: Record<string, unknown>,
    snapshot: Snapshot,
  ) {
    super()
    this.webContents = new WebContentsDouble(snapshot)
  }

  close(): void {
    this.destroyed = true
    this.dispatchEvent(new Event('closed'))
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  loadURL(): Promise<void> {
    this.webContents.dispatchEvent(new Event('did-finish-load'))

    return Promise.resolve()
  }

  once(eventName: string, listener: () => void): void {
    const wrappedListener = (): void => {
      this.removeEventListener(eventName, wrappedListener as EventListener)
      listener()
    }

    this.addEventListener(eventName, wrappedListener as EventListener)
  }
}

test('uses an app-managed browser session path instead of a shared partition and resolves a captured vacancy page', async () => {
  const sessionDouble = {} as Session
  const createSession = vi.fn(() => Promise.resolve(sessionDouble))
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Senior Product Designer</h1></main>',
      pageTitle: 'Senior Product Designer | LinkedIn',
      resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession,
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const result = await vacancyBrowserSession.openSession({
    shouldCapturePage: () => true,
    url: 'https://www.linkedin.com/jobs/view/123456',
  })
  const firstConstructorCall = constructor.mock.calls[0] as [Record<string, unknown>] | undefined

  expect(createSession).toHaveBeenCalledWith(
    '/tmp/cv-maxxing/browser-sessions/vacancy-browser-session',
  )
  expect(firstConstructorCall).toBeDefined()
  expect(firstConstructorCall?.[0].webPreferences).toBeDefined()
  expect((firstConstructorCall?.[0].webPreferences as { session?: Session }).session).toBe(
    sessionDouble,
  )
  expect(firstConstructorCall?.[0].webPreferences as Record<string, unknown>).not.toHaveProperty(
    'partition',
  )
  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })
})

test('returns the latest observed page when the browser window closes before extraction becomes complete', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Sign in to view this job</h1></main>',
      pageTitle: 'Sign in to view this job | LinkedIn',
      resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    autoCloseAfterFirstObservation: true,
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: () => false,
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  expect(createdWindow).toBeDefined()
  expect(createdWindow?.isDestroyed()).toBe(false)

  createdWindow?.close()

  const result = await resultPromise

  expect(result).toEqual({
    html: '<main><h1>Sign in to view this job</h1></main>',
    pageTitle: 'Sign in to view this job | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })
})

test('auto-closes an incomplete first observation only for synthetic browser-session fixtures', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Sign in to view this job</h1></main>',
      pageTitle: 'Sign in to view this job | LinkedIn',
      resolvedUrl: 'data:text/html,fixture',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    autoCloseAfterFirstObservation: true,
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
    testSnapshotHtml: '<main><h1>Fixture</h1></main>',
  })

  const result = await vacancyBrowserSession.openSession({
    shouldCapturePage: () => false,
    url: 'https://www.linkedin.com/jobs/view/123456',
  })
  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  expect(createdWindow).toBeDefined()
  expect(createdWindow?.isDestroyed()).toBe(true)
  expect(result).toEqual({
    html: '<main><h1>Sign in to view this job</h1></main>',
    pageTitle: 'Sign in to view this job | LinkedIn',
    resolvedUrl: 'data:text/html,fixture',
  })
})
