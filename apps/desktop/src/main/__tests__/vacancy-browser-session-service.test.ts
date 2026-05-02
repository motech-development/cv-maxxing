import type { Session } from 'electron'
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

test('uses an app-managed browser session path instead of a shared partition and resolves a captured vacancy page', async () => {
  const sessionDouble = {} as Session
  const createSession = vi.fn(() => Promise.resolve(sessionDouble))
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Senior Product Designer</h1></main>',
      pageTitle: 'Senior Product Designer | Example Careers',
      resolvedUrl: 'https://careers.example.com/jobs/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession,
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: () => true,
    url: 'https://careers.example.com/jobs/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Careers',
    resolvedUrl: 'https://careers.example.com/jobs/123456',
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
    pageTitle: 'Senior Product Designer | Example Careers',
    resolvedUrl: 'https://careers.example.com/jobs/123456',
  })
})

test('captures a vacancy page silently with the managed browser session before falling back to an interactive window', async () => {
  const sessionDouble = {} as Session
  const createSession = vi.fn(() => Promise.resolve(sessionDouble))
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Senior Product Designer</h1></main>',
      pageTitle: 'Senior Product Designer | Example Careers',
      resolvedUrl: 'https://careers.example.com/jobs/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession,
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    shouldCapturePage: () => true,
    url: 'https://careers.example.com/jobs/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Careers',
    resolvedUrl: 'https://careers.example.com/jobs/123456',
  })

  const result = await resultPromise
  const firstConstructorCall = constructor.mock.calls[0] as [Record<string, unknown>] | undefined

  expect(createSession).toHaveBeenCalledWith(
    '/tmp/cv-maxxing/browser-sessions/vacancy-browser-session',
  )
  expect(firstConstructorCall?.[0].show).toBe(false)
  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Careers',
    resolvedUrl: 'https://careers.example.com/jobs/123456',
  })
  expect(createdWindow?.isDestroyed()).toBe(true)
})

test('tracks the latest valid on-target snapshot across later page loads and returns it when the window closes', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Loading…</h1></main>',
      pageTitle: 'Loading | authenticated job site',
      resolvedUrl: 'https://careers.example.com/jobs/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://careers.example.com/jobs/123456'
    },
    url: 'https://careers.example.com/jobs/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  expect(createdWindow).toBeDefined()
  expect(createdWindow?.isDestroyed()).toBe(false)

  createdWindow?.finishLoad({
    html: '<main><h1>Account home</h1></main>',
    pageTitle: 'Account home',
    resolvedUrl: 'https://careers.example.com/account/',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Careers',
    resolvedUrl: 'https://careers.example.com/jobs/123456',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer Updated</h1></main>',
    pageTitle: 'Senior Product Designer | Example Careers',
    resolvedUrl: 'https://careers.example.com/jobs/123456',
  })
  await flushObservation()
  createdWindow?.close()

  const result = await resultPromise

  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer Updated</h1></main>',
    pageTitle: 'Senior Product Designer | Example Careers',
    resolvedUrl: 'https://careers.example.com/jobs/123456',
  })
})

test('discards a previously valid snapshot if the user later navigates off-target before closing', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Loading…</h1></main>',
      pageTitle: 'Loading | authenticated job site',
      resolvedUrl: 'https://careers.example.com/jobs/123456',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://careers.example.com/jobs/123456'
    },
    url: 'https://careers.example.com/jobs/123456',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer | Example Careers',
    resolvedUrl: 'https://careers.example.com/jobs/123456',
  })
  await flushObservation()
  createdWindow?.finishLoad({
    html: '<main><h1>Account home</h1></main>',
    pageTitle: 'Account home',
    resolvedUrl: 'https://careers.example.com/account/',
  })
  await flushObservation()
  createdWindow?.close()

  await expect(resultPromise).resolves.toBeNull()
})

test('returns null when the browser window closes without any valid on-target snapshot', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Sign in to view this job</h1></main>',
      pageTitle: 'Sign in to view this job',
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
    url: 'https://careers.example.com/jobs/123456',
  })
  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Sign in to view this job</h1></main>',
    pageTitle: 'Sign in to view this job',
    resolvedUrl: 'data:text/html,fixture',
  })
  await flushObservation()

  const result = await resultPromise

  expect(createdWindow).toBeDefined()
  expect(createdWindow?.isDestroyed()).toBe(true)
  expect(result).toBeNull()
})

test('lets URL intake review request a safe same-page reading interaction before capture settles', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><button data-testid="show-more-description">Show more</button></main>',
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://careers.example.com/jobs/123',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    reviewPage: async ({ applyReadingInteraction, initialSnapshot }) => {
      expect(initialSnapshot.html).toContain('Show more')

      const interactionResult = await applyReadingInteraction({
        kind: 'scroll',
        pixels: 640,
      })

      expect(interactionResult.kind).toBe('captured')

      return interactionResult.kind === 'captured' ? interactionResult.snapshot : null
    },
    shouldCapturePage: () => true,
    url: 'https://careers.example.com/jobs/123',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><button data-testid="show-more-description">Show more</button><section>Full role details</section></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/123#details',
  })

  await expect(resultPromise).resolves.toEqual({
    html: '<main><button data-testid="show-more-description">Show more</button><section>Full role details</section></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/123#details',
  })
})

test('rejects unsafe AI-requested typing interactions before running page JavaScript', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><input name="email" /></main>',
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://careers.example.com/jobs/123',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    reviewPage: async ({ applyReadingInteraction }) => {
      const interactionResult = await applyReadingInteraction({
        kind: 'type',
        selector: 'input[name="email"]',
        text: 'candidate@example.com',
      })

      expect(interactionResult).toEqual({
        kind: 'rejected',
        reason: 'typing is not allowed during vacancy intake',
      })

      return null
    },
    shouldCapturePage: () => true,
    url: 'https://careers.example.com/jobs/123',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><input name="email" /></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/123',
  })

  await expect(resultPromise).resolves.toBeNull()
})

test('rejects AI-requested interactions that change the top-level URL path', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><button>Show more</button></main>',
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://careers.example.com/jobs/123',
    })
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    reviewPage: async ({ applyReadingInteraction }) => {
      const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

      createdWindow?.finishLoad({
        html: '<main><h1>Application form</h1></main>',
        pageTitle: 'Application form',
        resolvedUrl: 'https://careers.example.com/apply/123',
      })

      const interactionResult = await applyReadingInteraction({
        kind: 'click',
        selector: 'button',
      })

      expect(interactionResult.kind).toBe('rejected')

      return null
    },
    shouldCapturePage: () => true,
    url: 'https://careers.example.com/jobs/123',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><button>Show more</button></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/123',
  })

  await expect(resultPromise).resolves.toBeNull()
})

test('enforces the URL intake time budget while AI page review is still running', async () => {
  vi.useFakeTimers()

  try {
    const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
      return new BrowserWindowDouble(options, {
        html: '<main><h1>Senior Product Designer</h1></main>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://careers.example.com/jobs/123',
      })
    })
    const vacancyBrowserSession = createVacancyBrowserSessionService({
      browserWindowConstructor: constructor as never,
      createSession: vi.fn(() => Promise.resolve({} as Session)),
      profileRootPath: '/tmp/cv-maxxing/browser-sessions',
    })

    const resultPromise = vacancyBrowserSession.captureSessionPage({
      reviewPage: () => {
        return new Promise((resolve) => {
          void resolve
        })
      },
      shouldCapturePage: () => true,
      timeBudgetMs: 5,
      url: 'https://careers.example.com/jobs/123',
    })

    await vi.waitFor(() => {
      expect(constructor).toHaveBeenCalledTimes(1)
    })

    const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

    createdWindow?.finishLoad({
      html: '<main><h1>Senior Product Designer</h1></main>',
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://careers.example.com/jobs/123',
    })
    await vi.advanceTimersByTimeAsync(5)

    await expect(resultPromise).resolves.toBeNull()
  } finally {
    vi.useRealTimers()
  }
})
