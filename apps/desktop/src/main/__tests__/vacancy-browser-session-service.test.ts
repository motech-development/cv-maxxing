import type { Session } from 'electron'
import { runInNewContext } from 'node:vm'
import { expect, test, vi } from 'vitest'

import { createVacancyBrowserSessionService } from '../vacancy-browser-session-service.js'

async function flushObservation(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

interface Snapshot {
  html: string
  pageTitle: string | null
  resolvedUrl: string
}

class WebContentsDouble extends EventTarget {
  private currentSnapshot: Snapshot

  constructor(snapshot: Snapshot) {
    super()

    this.currentSnapshot = snapshot
  }

  executeJavaScript(): Promise<Snapshot> {
    return Promise.resolve(this.currentSnapshot)
  }

  finishLoad(snapshot: Snapshot): void {
    this.currentSnapshot = snapshot
    this.dispatchEvent(new Event('did-finish-load'))
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
    return Promise.resolve()
  }

  finishLoad(snapshot: Snapshot): void {
    this.webContents.finishLoad(snapshot)
  }

  once(eventName: string, listener: () => void): void {
    const wrappedListener = (): void => {
      this.removeEventListener(eventName, wrappedListener as EventListener)
      listener()
    }

    this.addEventListener(eventName, wrappedListener as EventListener)
  }
}

class RenderedWebContentsDouble extends EventTarget {
  private currentHtml: string
  private currentPageTitle: string | null
  private currentResolvedUrl: string

  constructor(snapshot: Snapshot) {
    super()
    this.currentHtml = snapshot.html
    this.currentPageTitle = snapshot.pageTitle
    this.currentResolvedUrl = snapshot.resolvedUrl
  }

  executeJavaScript(code: string): Promise<unknown> {
    const documentDouble = createDocumentDouble({
      html: this.currentHtml,
      pageTitle: this.currentPageTitle,
    })
    const windowDouble = {
      getComputedStyle: () => {
        return {
          display: 'block',
          opacity: '1',
          visibility: 'visible',
        }
      },
      location: {
        href: this.currentResolvedUrl,
      },
    }

    return Promise.resolve(
      runInNewContext(code, {
        document: documentDouble,
        window: windowDouble,
      }) as unknown,
    )
  }

  finishLoad(snapshot: Snapshot): void {
    this.currentHtml = snapshot.html
    this.currentPageTitle = snapshot.pageTitle
    this.currentResolvedUrl = snapshot.resolvedUrl
    this.dispatchEvent(new Event('did-finish-load'))
  }

  on(eventName: string, listener: () => void): void {
    this.addEventListener(eventName, listener as EventListener)
  }
}

interface DocumentDouble {
  body: {
    innerHTML: string
  }
  querySelectorAll: (selector: 'iframe') => FrameDouble[]
  title: string
}

interface FrameDouble {
  contentDocument: {
    body: {
      innerHTML: string
    }
  }
  hidden: boolean
}

function createDocumentDouble({
  html,
  pageTitle,
}: {
  html: string
  pageTitle: string | null
}): DocumentDouble {
  const frameSrcdocMatches = [...html.matchAll(/<iframe\b[^>]*\bsrcdoc="([^"]*)"[^>]*>/giu)]
  const frames = frameSrcdocMatches.map((match) => {
    return {
      contentDocument: {
        body: {
          innerHTML: match[1] ?? '',
        },
      },
      hidden: false,
    } satisfies FrameDouble
  })

  return {
    body: {
      innerHTML: html,
    },
    querySelectorAll: () => {
      return frames
    },
    title: pageTitle ?? '',
  }
}

class RenderedBrowserWindowDouble extends EventTarget {
  public readonly webContents: RenderedWebContentsDouble

  private destroyed = false

  constructor(
    readonly options: Record<string, unknown>,
    snapshot: Snapshot,
  ) {
    super()
    this.webContents = new RenderedWebContentsDouble(snapshot)
  }

  close(): void {
    this.destroyed = true
    this.dispatchEvent(new Event('closed'))
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  loadURL(): Promise<void> {
    return Promise.resolve()
  }

  finishLoad(snapshot: Snapshot): void {
    this.webContents.finishLoad(snapshot)
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
      pageTitle: 'Senior Product Designer | Example Jobs',
      resolvedUrl: 'https://jobs.example.com/roles/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession,
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: () => true,
    url: 'https://jobs.example.com/roles/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/roles/123456',
  })
  await flushObservation()
  createdWindow?.close()

  const result = await resultPromise
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
    pageTitle: 'Senior Product Designer | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/roles/123456',
  })
})

test('captures a vacancy page silently with the managed browser session before falling back to an interactive window', async () => {
  const sessionDouble = {} as Session
  const createSession = vi.fn(() => Promise.resolve(sessionDouble))
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Senior Product Designer</h1></main>',
      pageTitle: 'Senior Product Designer | Example Jobs',
      resolvedUrl: 'https://jobs.example.com/roles/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession,
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    shouldCapturePage: () => true,
    url: 'https://jobs.example.com/roles/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/roles/123456',
  })

  const result = await resultPromise
  const firstConstructorCall = constructor.mock.calls[0] as [Record<string, unknown>] | undefined

  expect(createSession).toHaveBeenCalledWith(
    '/tmp/cv-maxxing/browser-sessions/vacancy-browser-session',
  )
  expect(firstConstructorCall?.[0].show).toBe(false)
  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/roles/123456',
  })
  expect(createdWindow?.isDestroyed()).toBe(true)
})

test('captures visible embedded board content as readable browser evidence', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new RenderedBrowserWindowDouble(options, {
      html: [
        '<main>',
        '<h1>Careers</h1>',
        '<iframe srcdoc="<article><h2>Senior Product Designer</h2><p>Lead product design for embedded workflows.</p></article>"></iframe>',
        '</main>',
      ].join(''),
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://jobs.example.com/roles/123',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    shouldCapturePage: () => true,
    url: 'https://jobs.example.com/roles/123',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as
    | RenderedBrowserWindowDouble
    | undefined

  createdWindow?.finishLoad({
    html: [
      '<main>',
      '<h1>Careers</h1>',
      '<iframe srcdoc="<article><h2>Senior Product Designer</h2><p>Lead product design for embedded workflows.</p></article>"></iframe>',
      '</main>',
    ].join(''),
    pageTitle: 'Example Labs Careers',
    resolvedUrl: 'https://jobs.example.com/roles/123',
  })

  const result = await resultPromise

  expect(result?.html).toContain('Senior Product Designer')
  expect(result?.html).toContain('Lead product design for embedded workflows.')
})

test('tracks the latest valid on-target snapshot across later page loads and returns it when the window closes', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Loading…</h1></main>',
      pageTitle: 'Loading | Example Jobs',
      resolvedUrl: 'https://jobs.example.com/roles/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://jobs.example.com/roles/123456'
    },
    url: 'https://jobs.example.com/roles/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  expect(createdWindow).toBeDefined()
  expect(createdWindow?.isDestroyed()).toBe(false)

  createdWindow?.finishLoad({
    html: '<main><h1>Jobs feed</h1></main>',
    pageTitle: 'Feed | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/feed/',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/roles/123456',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer Updated</h1></main>',
    pageTitle: 'Senior Product Designer | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/roles/123456',
  })
  await flushObservation()
  createdWindow?.close()

  const result = await resultPromise

  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer Updated</h1></main>',
    pageTitle: 'Senior Product Designer | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/roles/123456',
  })
})

test('discards a previously valid snapshot if the user later navigates off-target before closing', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Loading…</h1></main>',
      pageTitle: 'Loading | Example Jobs',
      resolvedUrl: 'https://jobs.example.com/roles/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://jobs.example.com/roles/123456'
    },
    url: 'https://jobs.example.com/roles/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/roles/123456',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>Jobs feed</h1></main>',
    pageTitle: 'Feed | Example Jobs',
    resolvedUrl: 'https://jobs.example.com/feed/',
  })
  await flushObservation()
  createdWindow?.close()

  await expect(resultPromise).resolves.toBeNull()
})

test('returns null when the browser window closes without any valid on-target snapshot', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Sign in to view this job</h1></main>',
      pageTitle: 'Sign in to view this job | Example Jobs',
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

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: () => false,
    url: 'https://jobs.example.com/roles/123456',
  })
  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Sign in to view this job</h1></main>',
    pageTitle: 'Sign in to view this job | Example Jobs',
    resolvedUrl: 'data:text/html,fixture',
  })
  await flushObservation()

  const result = await resultPromise

  expect(createdWindow).toBeDefined()
  expect(createdWindow?.isDestroyed()).toBe(true)
  expect(result).toBeNull()
})
