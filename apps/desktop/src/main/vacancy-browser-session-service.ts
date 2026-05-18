import { createRequire } from 'node:module';
import path from 'node:path';
import type { Session } from 'electron';
import type { VacancyBrowserReadingActionRequest } from './vacancy-browser-actions.js';

export interface VacancyBrowserPageSnapshot {
  html: string;
  pageTitle: string | null;
  resolvedUrl: string;
}

export interface VacancyBrowserSessionService {
  captureSessionPage: (input: {
    readingActions?: VacancyBrowserReadingActionRequest[];
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
    url: string;
  }) => Promise<VacancyBrowserPageSnapshot | null>;
  openSession: (input: {
    readingActions?: VacancyBrowserReadingActionRequest[];
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
    url: string;
  }) => Promise<VacancyBrowserPageSnapshot | null>;
}

interface BrowserSessionServiceDependencies {
  autoCloseAfterFirstObservation?: boolean;
  browserWindowConstructor?: BrowserWindowConstructor;
  createSession?: (profilePath: string) => Session | Promise<Session>;
  profileRootPath: string;
  testResolvedUrl?: string;
  testSnapshotHtml?: string;
}

interface BrowserWindowLike {
  close: () => void;
  isDestroyed: () => boolean;
  loadURL: (url: string) => Promise<void>;
  once: (eventName: string, listener: () => void) => void;
  webContents: BrowserWebContentsLike;
}

type BrowserWindowConstructor = new (options: Record<string, unknown>) => BrowserWindowLike;

interface BrowserWebContentsLike {
  executeJavaScript: (code: string) => Promise<unknown>;
  mainFrame?: BrowserFrameLike;
  on: (eventName: string, listener: () => void) => void;
}

interface BrowserFrameLike {
  executeJavaScript: (code: string) => Promise<unknown>;
  frames?: BrowserFrameLike[];
  isDestroyed?: () => boolean;
}

interface ElectronRuntime {
  BrowserWindow: BrowserWindowConstructor;
  session: {
    fromPath: (profilePath: string) => Session;
  };
}

const require = createRequire(import.meta.url);

const browserCaptureScript = `(() => {
  return {
    html: document.body?.innerHTML ?? '',
    pageTitle: document.title === '' ? null : document.title,
    resolvedUrl: window.location.href,
  }
})()`;
const SAFE_READING_ACTION_MARKER = 'cvMaxxingVacancySafeReadingAction';
const INTERACTIVE_OBSERVATION_INTERVAL_MS = 500;
const SILENT_CAPTURE_SETTLE_AFTER_VALID_MS = 500;
const SILENT_CAPTURE_OBSERVATION_INTERVAL_MS = 250;
const SILENT_CAPTURE_TIMEOUT_MS = 90_000;

type ReadingActionsState = 'complete' | 'pending' | 'rejected';

interface ReadingActionsProgress {
  nextActionIndex: number;
  state: ReadingActionsState;
}

export function createVacancyBrowserSessionService({
  autoCloseAfterFirstObservation = false,
  browserWindowConstructor,
  createSession,
  profileRootPath,
  testResolvedUrl,
  testSnapshotHtml,
}: BrowserSessionServiceDependencies): VacancyBrowserSessionService {
  const resolvedBrowserWindowConstructor =
    browserWindowConstructor ?? loadElectronRuntime().BrowserWindow;
  const resolvedCreateSession =
    createSession ??
    ((profilePath: string) => {
      return loadElectronRuntime().session.fromPath(profilePath);
    });
  const shouldAutoCloseAfterObservation =
    autoCloseAfterFirstObservation && testSnapshotHtml !== undefined;

  return {
    captureSessionPage: async ({
      readingActions = [],
      shouldCapturePage,
      url,
    }: {
      readingActions?: VacancyBrowserReadingActionRequest[];
      shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
      url: string;
    }): Promise<VacancyBrowserPageSnapshot | null> => {
      const vacancyBrowserWindow = await createVacancyBrowserWindow({
        browserWindowConstructor: resolvedBrowserWindowConstructor,
        createSession: resolvedCreateSession,
        profileRootPath,
        show: false,
      });
      let hasSettled = false;
      let latestValidSnapshot: VacancyBrowserPageSnapshot | null = null;
      let observationIntervalId: ReturnType<typeof setInterval> | null = null;
      let nextReadingActionIndex = 0;
      let readingActionsState: ReadingActionsState =
        readingActions.length === 0 ? 'complete' : 'pending';
      let validSnapshotSettleTimeoutId: ReturnType<typeof setTimeout> | null = null;
      let observationTimeoutId: ReturnType<typeof setTimeout> | null = null;

      return await new Promise<VacancyBrowserPageSnapshot | null>((resolve) => {
        const settle = (snapshot: VacancyBrowserPageSnapshot | null) => {
          if (hasSettled) {
            return;
          }

          hasSettled = true;

          if (observationIntervalId !== null) {
            clearInterval(observationIntervalId);
            observationIntervalId = null;
          }

          if (observationTimeoutId !== null) {
            clearTimeout(observationTimeoutId);
            observationTimeoutId = null;
          }

          if (validSnapshotSettleTimeoutId !== null) {
            clearTimeout(validSnapshotSettleTimeoutId);
            validSnapshotSettleTimeoutId = null;
          }

          resolve(snapshot);
        };

        const closeWindow = () => {
          if (vacancyBrowserWindow.isDestroyed()) {
            return;
          }

          vacancyBrowserWindow.close();
        };

        const observeCurrentPage = async (): Promise<void> => {
          if (hasSettled || vacancyBrowserWindow.isDestroyed()) {
            return;
          }

          const readingActionsProgress = await resolveReadingActionsState({
            nextActionIndex: nextReadingActionIndex,
            readingActions,
            readingActionsState,
            webContents: vacancyBrowserWindow.webContents,
          });

          nextReadingActionIndex = readingActionsProgress.nextActionIndex;
          readingActionsState = readingActionsProgress.state;

          if (readingActionsState === 'rejected') {
            closeWindow();
            settle(null);

            return;
          }

          const snapshot = await captureCurrentPage({
            fallbackResolvedUrl: testResolvedUrl,
            webContents: vacancyBrowserWindow.webContents,
          });

          if (snapshot === null) {
            return;
          }

          if (!shouldCapturePage(snapshot)) {
            latestValidSnapshot = null;

            if (validSnapshotSettleTimeoutId !== null) {
              clearTimeout(validSnapshotSettleTimeoutId);
              validSnapshotSettleTimeoutId = null;
            }

            return;
          }

          latestValidSnapshot = snapshot;

          if (validSnapshotSettleTimeoutId !== null) {
            return;
          }

          validSnapshotSettleTimeoutId = setTimeout(() => {
            closeWindow();
            settle(latestValidSnapshot);
          }, SILENT_CAPTURE_SETTLE_AFTER_VALID_MS);
        };

        const startSilentObservation = () => {
          if (observationIntervalId !== null) {
            return;
          }

          observeCurrentPage().catch(() => {
            closeWindow();
            settle(latestValidSnapshot);
          });

          observationIntervalId = setInterval(() => {
            observeCurrentPage().catch(() => {
              closeWindow();
              settle(latestValidSnapshot);
            });
          }, SILENT_CAPTURE_OBSERVATION_INTERVAL_MS);

          observationTimeoutId = setTimeout(() => {
            closeWindow();
            settle(latestValidSnapshot);
          }, SILENT_CAPTURE_TIMEOUT_MS);
        };

        vacancyBrowserWindow.once('closed', () => {
          settle(latestValidSnapshot);
        });
        vacancyBrowserWindow.webContents.on('did-finish-load', () => {
          startSilentObservation();
        });

        vacancyBrowserWindow
          .loadURL(
            createBrowserSessionUrl({
              testSnapshotHtml,
              url,
            }),
          )
          .catch(() => {
            closeWindow();
            settle(latestValidSnapshot);
          });
      });
    },
    openSession: async ({
      readingActions = [],
      shouldCapturePage,
      url,
    }: {
      readingActions?: VacancyBrowserReadingActionRequest[];
      shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
      url: string;
    }): Promise<VacancyBrowserPageSnapshot | null> => {
      const vacancyBrowserWindow = await createVacancyBrowserWindow({
        browserWindowConstructor: resolvedBrowserWindowConstructor,
        createSession: resolvedCreateSession,
        profileRootPath,
        show: true,
      });
      let hasSettled = false;
      let latestValidSnapshot: VacancyBrowserPageSnapshot | null = null;
      let nextReadingActionIndex = 0;
      let observationIntervalId: ReturnType<typeof setInterval> | null = null;
      let readingActionsState: ReadingActionsState =
        readingActions.length === 0 ? 'complete' : 'pending';

      return await new Promise<VacancyBrowserPageSnapshot | null>((resolve) => {
        const settle = (snapshot: VacancyBrowserPageSnapshot | null) => {
          if (hasSettled) {
            return;
          }

          hasSettled = true;

          if (observationIntervalId !== null) {
            clearInterval(observationIntervalId);
            observationIntervalId = null;
          }

          resolve(snapshot);
        };

        const closeWindow = () => {
          if (vacancyBrowserWindow.isDestroyed()) {
            return;
          }

          vacancyBrowserWindow.close();
        };

        const observeCurrentPage = async (): Promise<void> => {
          if (hasSettled || vacancyBrowserWindow.isDestroyed()) {
            return;
          }

          const readingActionsProgress = await resolveReadingActionsState({
            nextActionIndex: nextReadingActionIndex,
            readingActions,
            readingActionsState,
            webContents: vacancyBrowserWindow.webContents,
          });

          nextReadingActionIndex = readingActionsProgress.nextActionIndex;
          readingActionsState = readingActionsProgress.state;

          if (readingActionsState === 'rejected') {
            closeWindow();
            settle(null);

            return;
          }

          const snapshot = await captureCurrentPage({
            fallbackResolvedUrl: testResolvedUrl,
            webContents: vacancyBrowserWindow.webContents,
          });

          if (snapshot === null) {
            return;
          }

          // Drop stale vacancy snapshots when later observations go off-target.
          latestValidSnapshot = shouldCapturePage(snapshot) ? snapshot : null;

          if (shouldAutoCloseAfterObservation) {
            closeWindow();
          }
        };

        const observeAndSettleOnFailure = () => {
          observeCurrentPage().catch(() => {
            closeWindow();
            settle(latestValidSnapshot);
          });
        };

        const startInteractiveObservation = () => {
          if (observationIntervalId !== null) {
            if (readingActionsState !== 'pending') {
              observeAndSettleOnFailure();
            }

            return;
          }

          observeAndSettleOnFailure();

          observationIntervalId = setInterval(() => {
            observeAndSettleOnFailure();
          }, INTERACTIVE_OBSERVATION_INTERVAL_MS);
        };

        vacancyBrowserWindow.once('closed', () => {
          settle(latestValidSnapshot);
        });
        vacancyBrowserWindow.webContents.on('did-finish-load', () => {
          startInteractiveObservation();
        });

        vacancyBrowserWindow
          .loadURL(
            createBrowserSessionUrl({
              testSnapshotHtml,
              url,
            }),
          )
          .catch(() => {
            closeWindow();
            settle(latestValidSnapshot);
          });
      });
    },
  };
}

async function resolveReadingActionsState({
  nextActionIndex,
  readingActions,
  readingActionsState,
  webContents,
}: {
  nextActionIndex: number;
  readingActions: VacancyBrowserReadingActionRequest[];
  readingActionsState: ReadingActionsState;
  webContents: BrowserWebContentsLike;
}): Promise<ReadingActionsProgress> {
  if (readingActionsState !== 'pending') {
    return {
      nextActionIndex,
      state: readingActionsState,
    };
  }

  return await runSafeReadingActions({
    nextActionIndex,
    readingActions,
    webContents,
  });
}

async function runSafeReadingActions({
  nextActionIndex,
  readingActions,
  webContents,
}: {
  nextActionIndex: number;
  readingActions: VacancyBrowserReadingActionRequest[];
  webContents: BrowserWebContentsLike;
}): Promise<ReadingActionsProgress> {
  for (let actionIndex = nextActionIndex; actionIndex < readingActions.length; actionIndex += 1) {
    const readingAction = readingActions[actionIndex];

    if (readingAction === undefined) {
      return {
        nextActionIndex: actionIndex,
        state: 'rejected',
      };
    }

    const result = await webContents.executeJavaScript(
      createSafeReadingActionScript(readingAction),
    );
    const resultState = resolveSafeReadingActionState(result);

    if (resultState !== 'complete') {
      return {
        nextActionIndex: actionIndex,
        state: resultState,
      };
    }
  }

  return {
    nextActionIndex: readingActions.length,
    state: 'complete',
  };
}

function createSafeReadingActionScript(action: VacancyBrowserReadingActionRequest) {
  return String.raw`(() => {
    const marker = ${JSON.stringify(SAFE_READING_ACTION_MARKER)};
    const action = ${JSON.stringify(action)};
    const forbiddenTextPattern = /\b(?:apply|submit|sign\s*in|log\s*in|account|upload|attach|delete|purchase|checkout)\b/iu;
    const wait = (delayMs) => new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
    const reject = (reason) => ({
      kind: 'rejected',
      marker,
      reason,
    });

    const target = document.querySelector(action.selector);

    if (target === null) {
      return reject('missing_target');
    }

    if (action.kind === 'read') {
      return {
        kind: 'completed',
        marker,
      };
    }

    const targetElement = target instanceof HTMLElement ? target : target.closest('*');
    const formControl = target.closest('input, textarea, select, form');
    const activationTarget = target.closest('a, button, [role="button"], [role="link"]');
    const actionTarget = activationTarget ?? targetElement;
    const actionText = [actionTarget?.textContent, actionTarget?.getAttribute('aria-label'), actionTarget?.getAttribute('title')]
      .filter((value) => value !== null && value !== undefined)
      .join(' ');

    if (targetElement === null || actionTarget === null || formControl !== null) {
      return reject('form_action');
    }

    if (forbiddenTextPattern.test(actionText)) {
      return reject('application_action');
    }

    if (activationTarget instanceof HTMLAnchorElement && activationTarget.href !== '') {
      const currentUrl = new URL(window.location.href);
      const nextUrl = new URL(activationTarget.href, window.location.href);
      const sameDocument =
        currentUrl.hostname === nextUrl.hostname &&
        currentUrl.pathname === nextUrl.pathname &&
        currentUrl.search === nextUrl.search;

      if (!sameDocument) {
        return reject('external_or_off_target_link');
      }
    }

    const beforeUrl = new URL(window.location.href);
    actionTarget.click();

    return wait(200).then(() => {
      const afterUrl = new URL(window.location.href);
      const sameDocument =
        beforeUrl.hostname === afterUrl.hostname &&
        beforeUrl.pathname === afterUrl.pathname &&
        beforeUrl.search === afterUrl.search;

      if (!sameDocument) {
        return reject('off_target_navigation');
      }

      return {
        kind: 'completed',
        marker,
      };
    });
  })()`;
}

function resolveSafeReadingActionState(value: unknown): ReadingActionsState {
  if (value === null || typeof value !== 'object') {
    return 'rejected';
  }

  if (!('marker' in value) || value.marker !== SAFE_READING_ACTION_MARKER) {
    return 'rejected';
  }

  if (!('kind' in value)) {
    return 'rejected';
  }

  if (value.kind === 'completed') {
    return 'complete';
  }

  if (value.kind !== 'rejected') {
    return 'rejected';
  }

  return 'reason' in value && value.reason === 'missing_target' ? 'pending' : 'rejected';
}

async function createVacancyBrowserWindow({
  browserWindowConstructor,
  createSession,
  profileRootPath,
  show,
}: {
  browserWindowConstructor: BrowserWindowConstructor;
  createSession: (profilePath: string) => Session | Promise<Session>;
  profileRootPath: string;
  show: boolean;
}): Promise<BrowserWindowLike> {
  const profilePath = path.join(profileRootPath, 'vacancy-browser-session');
  const managedSession = await createSession(profilePath);

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
  });
}

function loadElectronRuntime(): ElectronRuntime {
  return require('electron') as ElectronRuntime;
}

function createBrowserSessionUrl({
  testSnapshotHtml,
  url,
}: {
  testSnapshotHtml: string | undefined;
  url: string;
}) {
  if (testSnapshotHtml === undefined) {
    return url;
  }

  return `data:text/html;charset=utf-8,${encodeURIComponent(testSnapshotHtml)}`;
}

async function captureCurrentPage({
  fallbackResolvedUrl,
  webContents,
}: {
  fallbackResolvedUrl: string | undefined;
  webContents: BrowserWebContentsLike;
}): Promise<VacancyBrowserPageSnapshot | null> {
  try {
    const snapshot = await capturePageSnapshot({
      executeJavaScript: (code) => {
        return webContents.executeJavaScript(code);
      },
    });

    if (snapshot === null) {
      return null;
    }

    const frameSnapshots = await captureEmbeddedFrameSnapshots(webContents.mainFrame);

    return {
      html: appendEmbeddedFrameEvidence({
        frameSnapshots,
        html: snapshot.html,
      }),
      pageTitle: snapshot.pageTitle,
      resolvedUrl: fallbackResolvedUrl ?? snapshot.resolvedUrl,
    };
  } catch {
    return null;
  }
}

async function capturePageSnapshot({
  executeJavaScript,
}: {
  executeJavaScript: (code: string) => Promise<unknown>;
}): Promise<VacancyBrowserPageSnapshot | null> {
  const snapshot = await executeJavaScript(browserCaptureScript);

  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    !('html' in snapshot) ||
    typeof snapshot.html !== 'string' ||
    !('resolvedUrl' in snapshot) ||
    typeof snapshot.resolvedUrl !== 'string' ||
    !('pageTitle' in snapshot) ||
    (snapshot.pageTitle !== null && typeof snapshot.pageTitle !== 'string')
  ) {
    return null;
  }

  return {
    html: snapshot.html,
    pageTitle: snapshot.pageTitle,
    resolvedUrl: snapshot.resolvedUrl,
  };
}

async function captureEmbeddedFrameSnapshots(
  mainFrame: BrowserFrameLike | undefined,
): Promise<VacancyBrowserPageSnapshot[]> {
  if (mainFrame === undefined) {
    return [];
  }

  const frames = collectChildFrames(mainFrame);
  const capturedSnapshots = await Promise.all(
    frames.map((frame) => {
      return captureEmbeddedFrameSnapshot(frame);
    }),
  );

  return capturedSnapshots.filter((snapshot): snapshot is VacancyBrowserPageSnapshot => {
    return snapshot !== null && snapshot.html.trim() !== '';
  });
}

async function captureEmbeddedFrameSnapshot(
  frame: BrowserFrameLike,
): Promise<VacancyBrowserPageSnapshot | null> {
  if (frame.isDestroyed?.() === true) {
    return null;
  }

  try {
    return await capturePageSnapshot({
      executeJavaScript: (code) => {
        return frame.executeJavaScript(code);
      },
    });
  } catch {
    return null;
  }
}

function collectChildFrames(frame: BrowserFrameLike): BrowserFrameLike[] {
  const childFrames = frame.frames ?? [];

  return childFrames.flatMap((childFrame) => {
    return [childFrame, ...collectChildFrames(childFrame)];
  });
}

function appendEmbeddedFrameEvidence({
  frameSnapshots,
  html,
}: {
  frameSnapshots: VacancyBrowserPageSnapshot[];
  html: string;
}) {
  if (frameSnapshots.length === 0) {
    return html;
  }

  const frameEvidenceHtml = frameSnapshots
    .map((snapshot) => {
      return `<article data-cv-maxxing-frame-url="${escapeHtmlAttribute(
        snapshot.resolvedUrl,
      )}">${snapshot.html}</article>`;
    })
    .join('\n');

  return `${html}\n<section data-cv-maxxing-embedded-frames="true">${frameEvidenceHtml}</section>`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
