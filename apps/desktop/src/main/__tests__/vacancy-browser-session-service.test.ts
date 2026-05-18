import type { Session } from 'electron';
import { expect, test, vi } from 'vitest';
import { createVacancyBrowserSessionService } from '../vacancy-browser-session-service.js';

async function flushObservation(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

interface Snapshot {
  html: string;
  pageTitle: string | null;
  resolvedUrl: string;
}

class WebFrameDouble {
  constructor(
    private readonly snapshot: Error | Snapshot,
    readonly frames: WebFrameDouble[] = [],
  ) {}

  executeJavaScript(): Promise<Snapshot> {
    if (this.snapshot instanceof Error) {
      return Promise.reject(this.snapshot);
    }

    return Promise.resolve(this.snapshot);
  }

  isDestroyed() {
    return false;
  }
}

interface ScriptHandlerResult {
  handled: boolean;
  value?: unknown;
}

type ScriptHandler = (code: string) => ScriptHandlerResult | Promise<ScriptHandlerResult>;

class WebContentsDouble extends EventTarget {
  public mainFrame: WebFrameDouble;

  private currentSnapshot: Snapshot;
  private frameSnapshots: (Error | Snapshot)[];

  constructor(
    snapshot: Snapshot,
    frameSnapshots: (Error | Snapshot)[] = [],
    private readonly scriptHandler?: ScriptHandler,
  ) {
    super();

    this.currentSnapshot = snapshot;
    this.frameSnapshots = frameSnapshots;
    this.mainFrame = this.createMainFrame();
  }

  async executeJavaScript(code: string): Promise<unknown> {
    const scriptResult = await this.scriptHandler?.(code);

    if (scriptResult?.handled === true) {
      return scriptResult.value;
    }

    return this.currentSnapshot;
  }

  finishLoad(snapshot: Snapshot, frameSnapshots: (Error | Snapshot)[] = []) {
    this.currentSnapshot = snapshot;
    this.frameSnapshots = frameSnapshots;
    this.mainFrame = this.createMainFrame();
    this.dispatchEvent(new Event('did-finish-load'));
  }

  updateSnapshot(snapshot: Snapshot, frameSnapshots: (Error | Snapshot)[] = []) {
    this.currentSnapshot = snapshot;
    this.frameSnapshots = frameSnapshots;
    this.mainFrame = this.createMainFrame();
  }

  on(eventName: string, listener: () => void) {
    this.addEventListener(eventName, listener as EventListener);
  }

  private createMainFrame(): WebFrameDouble {
    const childFrames = this.frameSnapshots.map((snapshot) => {
      return new WebFrameDouble(snapshot);
    });

    return new WebFrameDouble(this.currentSnapshot, childFrames);
  }
}

class BrowserWindowDouble extends EventTarget {
  public readonly webContents: WebContentsDouble;

  private destroyed = false;

  constructor(
    readonly options: Record<string, unknown>,
    snapshot: Snapshot,
    scriptHandler?: ScriptHandler,
  ) {
    super();
    this.webContents = new WebContentsDouble(snapshot, [], scriptHandler);
  }

  close() {
    this.destroyed = true;
    this.dispatchEvent(new Event('closed'));
  }

  isDestroyed() {
    return this.destroyed;
  }

  loadURL(): Promise<void> {
    return Promise.resolve();
  }

  finishLoad(snapshot: Snapshot) {
    this.webContents.finishLoad(snapshot);
  }

  once(eventName: string, listener: () => void) {
    const wrappedListener = () => {
      this.removeEventListener(eventName, wrappedListener as EventListener);
      listener();
    };

    this.addEventListener(eventName, wrappedListener as EventListener);
  }
}

test('uses an app-managed browser session path instead of a shared partition and resolves a captured vacancy page', async () => {
  const sessionDouble = {} as Session;
  const createSession = vi.fn(() => Promise.resolve(sessionDouble));
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Senior Product Designer</h1></main>',
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://jobs.example.com/private/123',
    });
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession,
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: () => true,
    url: 'https://jobs.example.com/private/123',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://jobs.example.com/private/123',
  });
  await flushObservation();
  createdWindow?.close();

  const result = await resultPromise;
  const firstConstructorCall = constructor.mock.calls[0] as [Record<string, unknown>] | undefined;

  expect(createSession).toHaveBeenCalledWith(
    '/tmp/cv-maxxing/browser-sessions/vacancy-browser-session',
  );
  expect(firstConstructorCall).toBeDefined();
  expect(firstConstructorCall?.[0].webPreferences).toBeDefined();
  expect((firstConstructorCall?.[0].webPreferences as { session?: Session }).session).toBe(
    sessionDouble,
  );
  expect(firstConstructorCall?.[0].webPreferences as Record<string, unknown>).not.toHaveProperty(
    'partition',
  );
  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://jobs.example.com/private/123',
  });
});

test('captures a vacancy page silently with the managed browser session before falling back to an interactive window', async () => {
  const sessionDouble = {} as Session;
  const createSession = vi.fn(() => Promise.resolve(sessionDouble));
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Senior Product Designer</h1></main>',
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://jobs.example.com/private/123',
    });
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession,
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    shouldCapturePage: () => true,
    url: 'https://jobs.example.com/private/123',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://jobs.example.com/private/123',
  });

  const result = await resultPromise;
  const firstConstructorCall = constructor.mock.calls[0] as [Record<string, unknown>] | undefined;

  expect(createSession).toHaveBeenCalledWith(
    '/tmp/cv-maxxing/browser-sessions/vacancy-browser-session',
  );
  expect(firstConstructorCall?.[0].show).toBe(false);
  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://jobs.example.com/private/123',
  });
  expect(createdWindow?.isDestroyed()).toBe(true);
});

test('keeps silent capture open long enough for JavaScript-rendered vacancy content', async () => {
  vi.useFakeTimers();

  try {
    const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
      return new BrowserWindowDouble(options, {
        html: '<main><h1>Loading job details</h1></main>',
        pageTitle: 'Example Labs Careers',
        resolvedUrl: 'https://careers.example.test/jobs/product-designer',
      });
    });
    const vacancyBrowserSession = createVacancyBrowserSessionService({
      browserWindowConstructor: constructor as never,
      createSession: vi.fn(() => Promise.resolve({} as Session)),
      profileRootPath: '/tmp/cv-maxxing/browser-sessions',
    });

    const resultPromise = vacancyBrowserSession.captureSessionPage({
      shouldCapturePage: (snapshot) => {
        return snapshot.html.includes('Senior Product Designer');
      },
      url: 'https://careers.example.test/jobs/product-designer',
    });

    await flushObservation();

    const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

    expect(createdWindow).toBeDefined();

    createdWindow?.finishLoad({
      html: '<main><h1>Loading job details</h1></main>',
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    });
    await flushObservation();
    await vi.advanceTimersByTimeAsync(4000);

    expect(createdWindow?.isDestroyed()).toBe(false);

    createdWindow?.webContents.updateSnapshot({
      html: '<main><h1>Senior Product Designer</h1><p>Lead browser-mediated intake work.</p></main>',
      pageTitle: 'Senior Product Designer at Example Labs',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    });
    await vi.advanceTimersByTimeAsync(250);
    await flushObservation();
    createdWindow?.close();

    await expect(resultPromise).resolves.toEqual({
      html: '<main><h1>Senior Product Designer</h1><p>Lead browser-mediated intake work.</p></main>',
      pageTitle: 'Senior Product Designer at Example Labs',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    });
  } finally {
    vi.useRealTimers();
  }
});

test('includes rendered embedded frame content in captured vacancy page evidence', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Careers</h1><iframe src="https://jobs.example.test/embed/123"></iframe></main>',
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    });
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    shouldCapturePage: () => true,
    url: 'https://careers.example.test/jobs/product-designer',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

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
  );

  const result = await resultPromise;

  expect(result?.html).toContain('<iframe');
  expect(result?.html).toContain(
    '<article data-cv-maxxing-frame-url="https://jobs.example.test/embed/123">',
  );
  expect(result?.html).toContain('Senior Product Designer');
  expect(result?.html).toContain('Lead browser-mediated intake work.');
});

test('runs safe same-page reading actions before capturing rendered vacancy evidence', async () => {
  let didRunReadingAction = false;
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    const window = new BrowserWindowDouble(
      options,
      {
        html: '<main><button id="show-details">Show details</button></main>',
        pageTitle: 'Example Labs Careers',
        resolvedUrl: 'https://careers.example.test/jobs/product-designer',
      },
      (code) => {
        if (code.includes('cvMaxxingVacancySafeReadingAction')) {
          didRunReadingAction = true;
          window.webContents.updateSnapshot({
            html: '<main><h1>Senior Product Designer</h1><p>Lead browser-mediated intake work.</p></main>',
            pageTitle: 'Senior Product Designer',
            resolvedUrl: 'https://careers.example.test/jobs/product-designer#details',
          });

          return {
            handled: true,
            value: {
              kind: 'completed',
              marker: 'cvMaxxingVacancySafeReadingAction',
            },
          };
        }

        return {
          handled: false,
        };
      },
    );

    return window;
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    readingActions: [
      {
        kind: 'click',
        selector: '#show-details',
      },
    ],
    shouldCapturePage: (snapshot) => {
      return snapshot.html.includes('Senior Product Designer');
    },
    url: 'https://careers.example.test/jobs/product-designer',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  createdWindow?.finishLoad({
    html: '<main><button id="show-details">Show details</button></main>',
    pageTitle: 'Example Labs Careers',
    resolvedUrl: 'https://careers.example.test/jobs/product-designer',
  });

  const result = await resultPromise;

  expect(didRunReadingAction).toBe(true);
  expect(result?.html).toContain('Senior Product Designer');
  expect(result?.resolvedUrl).toBe('https://careers.example.test/jobs/product-designer#details');
});

test('resumes safe reading actions from the first unfinished action while selectors render', async () => {
  vi.useFakeTimers();

  try {
    let clickAttempts = 0;
    let readAttempts = 0;
    const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
      const window = new BrowserWindowDouble(
        options,
        {
          html: '<main><p>Loading job details</p></main>',
          pageTitle: 'Example Labs Careers',
          resolvedUrl: 'https://careers.example.test/jobs/product-designer',
        },
        (code) => {
          if (!code.includes('cvMaxxingVacancySafeReadingAction')) {
            return {
              handled: false,
            };
          }

          if (code.includes('#show-details')) {
            clickAttempts += 1;

            window.webContents.updateSnapshot({
              html: '<main><button id="show-details">Show details</button><section><p>Loading details</p></section></main>',
              pageTitle: 'Example Labs Careers',
              resolvedUrl: 'https://careers.example.test/jobs/product-designer#details',
            });

            return {
              handled: true,
              value: {
                kind: 'completed',
                marker: 'cvMaxxingVacancySafeReadingAction',
              },
            };
          }

          readAttempts += 1;

          if (readAttempts === 1) {
            return {
              handled: true,
              value: {
                kind: 'rejected',
                marker: 'cvMaxxingVacancySafeReadingAction',
                reason: 'missing_target',
              },
            };
          }

          window.webContents.updateSnapshot({
            html: '<main><h1>Senior Product Designer</h1><p>Lead browser-mediated intake work.</p></main>',
            pageTitle: 'Senior Product Designer',
            resolvedUrl: 'https://careers.example.test/jobs/product-designer#details',
          });

          return {
            handled: true,
            value: {
              kind: 'completed',
              marker: 'cvMaxxingVacancySafeReadingAction',
            },
          };
        },
      );

      return window;
    });
    const vacancyBrowserSession = createVacancyBrowserSessionService({
      browserWindowConstructor: constructor as never,
      createSession: vi.fn(() => Promise.resolve({} as Session)),
      profileRootPath: '/tmp/cv-maxxing/browser-sessions',
    });

    const resultPromise = vacancyBrowserSession.captureSessionPage({
      readingActions: [
        {
          kind: 'click',
          selector: '#show-details',
        },
        {
          kind: 'read',
          selector: '#details',
        },
      ],
      shouldCapturePage: (snapshot) => {
        return snapshot.html.includes('Senior Product Designer');
      },
      url: 'https://careers.example.test/jobs/product-designer',
    });

    await vi.waitFor(() => {
      expect(constructor).toHaveBeenCalledTimes(1);
    });

    const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

    createdWindow?.finishLoad({
      html: '<main><p>Loading job details</p></main>',
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    });
    await flushObservation();

    expect(createdWindow?.isDestroyed()).toBe(false);
    expect(clickAttempts).toBe(1);
    expect(readAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);

    await expect(resultPromise).resolves.toMatchObject({
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer#details',
    });
    expect(clickAttempts).toBe(1);
    expect(readAttempts).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test('rejects unsafe same-page reading actions without capturing job data', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    const window = new BrowserWindowDouble(
      options,
      {
        html: '<main><button id="apply">Apply now</button></main>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://careers.example.test/jobs/product-designer',
      },
      (code) => {
        if (code.includes('cvMaxxingVacancySafeReadingAction')) {
          return {
            handled: true,
            value: {
              kind: 'rejected',
              reason: 'application_action',
            },
          };
        }

        return {
          handled: false,
        };
      },
    );

    return window;
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });
  const shouldCapturePage = vi.fn(() => true);

  const resultPromise = vacancyBrowserSession.captureSessionPage({
    readingActions: [
      {
        kind: 'click',
        selector: '#apply',
      },
    ],
    shouldCapturePage,
    url: 'https://careers.example.test/jobs/product-designer',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  createdWindow?.finishLoad({
    html: '<main><button id="apply">Apply now</button></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://careers.example.test/jobs/product-designer',
  });

  await expect(resultPromise).resolves.toBeNull();
  expect(shouldCapturePage).not.toHaveBeenCalled();
});

test('keeps readable vacancy page evidence when one embedded frame cannot be captured', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Careers</h1><iframe src="https://jobs.example.test/embed/123"></iframe></main>',
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    });
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });
  const shouldCapturePage = vi.fn(() => true);

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage,
    url: 'https://careers.example.test/jobs/product-designer',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  createdWindow?.webContents.finishLoad(
    {
      html: '<main><h1>Careers</h1><iframe src="https://jobs.example.test/embed/123"></iframe></main>',
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://careers.example.test/jobs/product-designer',
    },
    [
      new Error('Frame navigated while capture was running.'),
      {
        html: '<article><h1>Senior Product Designer</h1><p>Lead browser-mediated intake work.</p></article>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://jobs.example.test/embed/123',
      },
    ],
  );
  await vi.waitFor(() => {
    expect(shouldCapturePage).toHaveBeenCalled();
  });
  createdWindow?.close();

  const result = await resultPromise;

  expect(result?.html).toContain('<main><h1>Careers</h1>');
  expect(result?.html).toContain(
    '<article data-cv-maxxing-frame-url="https://jobs.example.test/embed/123">',
  );
  expect(result?.html).toContain('Senior Product Designer');
});

test('rejects browser snapshots that omit the page title property', async () => {
  const snapshotWithoutPageTitle = {
    html: '<main><h1>Senior Product Designer</h1></main>',
    resolvedUrl: 'https://careers.example.test/jobs/product-designer',
  } as Snapshot;
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, snapshotWithoutPageTitle);
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });
  const shouldCapturePage = vi.fn(() => true);

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage,
    url: 'https://careers.example.test/jobs/product-designer',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  createdWindow?.finishLoad(snapshotWithoutPageTitle);
  await flushObservation();
  createdWindow?.close();

  await expect(resultPromise).resolves.toBeNull();
  expect(shouldCapturePage).not.toHaveBeenCalled();
});

test('tracks the latest valid on-target snapshot across later page loads and returns it when the window closes', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Loading…</h1></main>',
      pageTitle: 'Loading',
      resolvedUrl: 'https://jobs.example.com/private/123',
    });
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://jobs.example.com/private/123';
    },
    url: 'https://jobs.example.com/private/123',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  expect(createdWindow).toBeDefined();
  expect(createdWindow?.isDestroyed()).toBe(false);

  createdWindow?.finishLoad({
    html: '<main><h1>Account feed</h1></main>',
    pageTitle: 'Account feed',
    resolvedUrl: 'https://jobs.example.com/feed/',
  });
  await flushObservation();
  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://jobs.example.com/private/123',
  });
  await flushObservation();
  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer Updated</h1></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://jobs.example.com/private/123',
  });
  await flushObservation();
  createdWindow?.close();

  const result = await resultPromise;

  expect(result).toEqual({
    html: '<main><h1>Senior Product Designer Updated</h1></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://jobs.example.com/private/123',
  });
});

test('discards a previously valid snapshot if the user later navigates off-target before closing', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Loading…</h1></main>',
      pageTitle: 'Loading',
      resolvedUrl: 'https://jobs.example.com/private/123',
    });
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
  });

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: (snapshot) => {
      return snapshot.resolvedUrl === 'https://jobs.example.com/private/123';
    },
    url: 'https://jobs.example.com/private/123',
  });

  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  createdWindow?.finishLoad({
    html: '<main><h1>Senior Product Designer</h1></main>',
    pageTitle: 'Senior Product Designer',
    resolvedUrl: 'https://jobs.example.com/private/123',
  });
  await flushObservation();
  createdWindow?.finishLoad({
    html: '<main><h1>Account feed</h1></main>',
    pageTitle: 'Account feed',
    resolvedUrl: 'https://jobs.example.com/feed/',
  });
  await flushObservation();
  createdWindow?.close();

  await expect(resultPromise).resolves.toBeNull();
});

test('returns null when the browser window closes without any valid on-target snapshot', async () => {
  const constructor = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
    return new BrowserWindowDouble(options, {
      html: '<main><h1>Sign in to view this job</h1></main>',
      pageTitle: 'Sign in to view this job',
      resolvedUrl: 'data:text/html,fixture',
    });
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    autoCloseAfterFirstObservation: true,
    browserWindowConstructor: constructor as never,
    createSession: vi.fn(() => Promise.resolve({} as Session)),
    profileRootPath: '/tmp/cv-maxxing/browser-sessions',
    testSnapshotHtml: '<main><h1>Fixture</h1></main>',
  });

  const resultPromise = vacancyBrowserSession.openSession({
    shouldCapturePage: () => false,
    url: 'https://jobs.example.com/private/123',
  });
  await vi.waitFor(() => {
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  const createdWindow = constructor.mock.results[0]?.value as BrowserWindowDouble | undefined;

  createdWindow?.finishLoad({
    html: '<main><h1>Sign in to view this job</h1></main>',
    pageTitle: 'Sign in to view this job',
    resolvedUrl: 'data:text/html,fixture',
  });
  await flushObservation();

  const result = await resultPromise;

  expect(createdWindow).toBeDefined();
  expect(createdWindow?.isDestroyed()).toBe(true);
  expect(result).toBeNull();
});
