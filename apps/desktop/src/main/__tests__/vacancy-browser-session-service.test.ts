import type { Session } from 'electron'
import { expect, test, vi } from 'vitest'

import { createVacancyBrowserSessionService } from '../vacancy-browser-session-service.js'

async function flushObservation(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}

interface Snapshot {
  html: string
  pageTitle: string | null
  resolvedUrl: string
}

class WebFrameDouble {
  constructor(
    private readonly snapshot: Snapshot,
    readonly frames: WebFrameDouble[] = [],
  ) {}

  executeJavaScript(): Promise<Snapshot> {
    return Promise.resolve(this.snapshot)
  }

  isDestroyed(): boolean {
    return false
  }
}

class WebContentsDouble extends EventTarget {
  public mainFrame: WebFrameDouble

  private currentSnapshot: Snapshot
  private frameSnapshots: Snapshot[]

  constructor(snapshot: Snapshot, frameSnapshots: Snapshot[] = []) {
    super()

    this.currentSnapshot = snapshot
    this.frameSnapshots = frameSnapshots
    this.mainFrame = this.createMainFrame()
  }

  executeJavaScript(): Promise<Snapshot> {
    return Promise.resolve(this.currentSnapshot)
  }

  finishLoad(snapshot: Snapshot, frameSnapshots: Snapshot[] = []): void {
    this.currentSnapshot = snapshot
    this.frameSnapshots = frameSnapshots
    this.mainFrame = this.createMainFrame()
    this.dispatchEvent(new Event('did-finish-load'))
  }

  on(eventName: string, listener: () => void): void {
    this.addEventListener(eventName, listener as EventListener)
  }

  private createMainFrame(): WebFrameDouble {
    const childFrames = this.frameSnapshots.map((snapshot) => {
      return new WebFrameDouble(snapshot)
    })

    return new WebFrameDouble(this.currentSnapshot, childFrames)
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

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: () => true,
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
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
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })
})

test('captures a vacancy page silently with the managed browser session before falling back to an interactive window', async () => {
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

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    shouldCapturePage: () => true,
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })

  const result = await resultPromise
  const firstConstructorCall = constructor.mock.calls[0] as [Record<string, unknown>] | undefined

  expect(createSession).toHaveBeenCalledWith(
    '/tmp/cv-maxxing/browser-sessions/vacancy-browser-session',
  )
  expect(firstConstructorCall?.[0].show).toBe(false)
  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })
  expect(createdWindow?.isDestroyed()).toBe(true)
})

test('includes rendered embedded frame content in captured vacancy page evidence', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Careers</h1><iframe src="https://jobs.example.test/embed/123"></iframe></main>',
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    shouldCapturePage: () => true,
    url: 'https://careers.example.test/jobs/product-designer',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.webContents.finishLoad(
    {
      html: '<main><h1>Careers</h1><iframe src="https://jobs.example.test/embed/123"></iframe></main>',
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    },
    [
      {
        html: '<article><h1>Senior Product Designer</h1><p>Lead browser-mediated intake work.</p></article>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://jobs.example.test/embed/123',
      },
    ],
  )

  const result = await resultPromise

  expect(result?.html).toContain('<iframe')
  expect(result?.html).toContain(
    '<article data-cv-maxxing-frame-url="https://jobs.example.test/embed/123">',
  )
  expect(result?.html).toContain('Senior Product Designer')
  expect(result?.html).toContain('Lead browser-mediated intake work.')
})

test('tracks the latest valid on-target snapshot across later page loads and returns it when the window closes', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Loading…</h1></main>',
      pageTitle: 'Loading | LinkedIn',
      resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://www.linkedin.com/jobs/view/123456'
    },
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  expect(createdWindow).toBeDefined()
  expect(createdWindow?.isDestroyed()).toBe(false)

  createdWindow?.finishLoad({
    html: '<main><h1>LinkedIn Feed</h1></main>',
    pageTitle: 'Feed | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/feed/',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer Updated</h1></main>',
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })
  await flushObservation()
  createdWindow?.close()

  const result = await resultPromise

  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer Updated</h1></main>',
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })
})

test('discards a previously valid snapshot if the user later navigates off-target before closing', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Loading…</h1></main>',
      pageTitle: 'Loading | LinkedIn',
      resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://www.linkedin.com/jobs/view/123456'
    },
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>LinkedIn Feed</h1></main>',
    pageTitle: 'Feed | LinkedIn',
    resolvedUrl: 'https://www.linkedin.com/feed/',
  })
  await flushObservation()
  createdWindow?.close()

  await expect(resultPromise).resolves.toBeNull()
})

test('returns null when the browser window closes without any valid on-target snapshot', async () => {
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

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: () => false,
    url: 'https://www.linkedin.com/jobs/view/123456',
  })
  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Sign in to view this job</h1></main>',
    pageTitle: 'Sign in to view this job | LinkedIn',
    resolvedUrl: 'data:text/html,fixture',
  })
  await flushObservation()

  const result = await resultPromise

  expect(createdWindow).toBeDefined()
  expect(createdWindow?.isDestroyed()).toBe(true)
  expect(result).toBeNull()
})
