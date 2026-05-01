import type { Session } from 'electron'
import { expect, test, vi } from 'vitest'

import {
  createVacancyBrowserSessionService,
  type VacancyBrowserPageSnapshot,
} from '../vacancy-browser-session-service.js'

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
  private readonly scriptResults: unknown[]

  constructor(snapshot: Snapshot, scriptResults: unknown[] = []) {
    super()

    this.currentSnapshot = snapshot
    this.scriptResults = scriptResults
  }

  executeJavaScript(): Promise<unknown> {
    const scriptedResult = this.scriptResults.shift()

    if (scriptedResult !== undefined) {
      return Promise.resolve(scriptedResult)
    }

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
    scriptResults: unknown[] = [],
  ) {
    super()
    this.webContents = new WebContentsDouble(snapshot, scriptResults)
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

test('runs an AI-requested safe same-page reading click before returning the captured URL page', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(
      options,
      {
        html: '<main><h1>Senior Product Designer</h1><button id="read-more">Read more</button></main>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://careers.example.com/jobs/product-designer',
      },
      [
        {
          afterUrl: 'https://careers.example.com/jobs/product-designer',
          status: 'applied',
        },
        {
          html: '<main><h1>Senior Product Designer</h1><section>Lead product design for desktop workflows.</section></main>',
          pageTitle: 'Senior Product Designer',
          resolvedUrl: 'https://careers.example.com/jobs/product-designer',
        },
      ],
    )
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    requestInteraction: vi.fn((snapshot: VacancyBrowserPageSnapshot) => {
      if (snapshot.html.includes('Lead product design')) {
        return Promise.resolve(null)
      }

      return Promise.resolve({
        action: 'click',
        selector: '#read-more',
      } as const)
    }),
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://careers.example.com/jobs/product-designer'
    },
    url: 'https://careers.example.com/jobs/product-designer',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1><button id="read-more">Read more</button></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/product-designer',
  })

  await expect(resultPromise).resolves.toEqual({
    html: '<main><h1>Senior Product Designer</h1><section>Lead product design for desktop workflows.</section></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/product-designer',
  })
  expect(createdWindow?.isDestroyed()).toBe(true)
})

test('rejects an AI-requested apply action without returning misleading vacancy data', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(
      options,
      {
        html: '<main><h1>Senior Product Designer</h1><button id="apply">Apply now</button></main>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://careers.example.com/jobs/product-designer',
      },
      [
        {
          afterUrl: 'https://careers.example.com/jobs/product-designer',
          reason: 'blocked-action-text',
          status: 'rejected',
        },
      ],
    )
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    requestInteraction: vi.fn(() => {
      return Promise.resolve({
        action: 'click',
        selector: '#apply',
      } as const)
    }),
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://careers.example.com/jobs/product-designer'
    },
    url: 'https://careers.example.com/jobs/product-designer',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1><button id="apply">Apply now</button></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/product-designer',
  })

  await expect(resultPromise).resolves.toBeNull()
  expect(createdWindow?.isDestroyed()).toBe(true)
})

test('rejects an AI-requested click that changes the top-level URL path', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(
      options,
      {
        html: '<main><h1>Senior Product Designer</h1><a id="details" href="/jobs/other-role">Details</a></main>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://careers.example.com/jobs/product-designer',
      },
      [
        {
          afterUrl: 'https://careers.example.com/jobs/other-role',
          status: 'applied',
        },
      ],
    )
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    requestInteraction: vi.fn(() => {
      return Promise.resolve({
        action: 'click',
        selector: '#details',
      } as const)
    }),
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://careers.example.com/jobs/product-designer'
    },
    url: 'https://careers.example.com/jobs/product-designer',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1><a id="details" href="/jobs/other-role">Details</a></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/product-designer',
  })

  await expect(resultPromise).resolves.toBeNull()
  expect(createdWindow?.isDestroyed()).toBe(true)
})

test('allows hash-only same-page interaction changes', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(
      options,
      {
        html: '<main><h1>Senior Product Designer</h1><a id="requirements" href="#requirements">Requirements</a></main>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://careers.example.com/jobs/product-designer',
      },
      [
        {
          afterUrl: 'https://careers.example.com/jobs/product-designer#requirements',
          status: 'applied',
        },
        {
          html: '<main><h1>Senior Product Designer</h1><section id="requirements">Experience shipping workflow software.</section></main>',
          pageTitle: 'Senior Product Designer',
          resolvedUrl: 'https://careers.example.com/jobs/product-designer#requirements',
        },
      ],
    )
  })
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  })

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    requestInteraction: vi.fn((snapshot: VacancyBrowserPageSnapshot) => {
      if (snapshot.resolvedUrl.endsWith('#requirements')) {
        return Promise.resolve(null)
      }

      return Promise.resolve({
        action: 'click',
        selector: '#requirements',
      } as const)
    }),
    shouldCapturePage: (snapshot) => {
      return (
        snapshot.resolvedUrl === 'https://careers.example.com/jobs/product-designer' ||
        snapshot.resolvedUrl === 'https://careers.example.com/jobs/product-designer#requirements'
      )
    },
    url: 'https://careers.example.com/jobs/product-designer',
  })

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1><a id="requirements" href="#requirements">Requirements</a></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/product-designer',
  })

  await expect(resultPromise).resolves.toEqual({
    html: '<main><h1>Senior Product Designer</h1><section id="requirements">Experience shipping workflow software.</section></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.com/jobs/product-designer#requirements',
  })
  expect(createdWindow?.isDestroyed()).toBe(true)
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
