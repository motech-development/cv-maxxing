import { expect, test, vi } from 'vitest';
import { SETTINGS_IPC_CHANNELS } from '../../shared/ipc.js';
import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../../shared/settings.js';
import { createDesktopAppBootstrap } from '../main.js';

type AppEvent = 'activate' | 'window-all-closed';

function createAppDouble() {
  return {
    on: vi.fn((event: AppEvent, handler: () => void) => {
      void event;
      void handler;
    }),
    quit: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  };
}

function createBrowserWindowDouble() {
  const loadFile = vi.fn(() => Promise.resolve());
  const loadURL = vi.fn(() => Promise.resolve());

  return {
    create: vi.fn(() => {
      return {
        loadFile,
        loadURL,
      };
    }),
    getAllWindows: vi.fn().mockReturnValue([]),
  };
}

test('bootstrap registers settings IPC handlers and delegates privacy actions to the settings service', async () => {
  const app = createAppDouble();
  const browserWindow = createBrowserWindowDouble();
  const registeredHandlers = new Map<
    string,
    (_event?: unknown, payload?: unknown) => Promise<unknown>
  >();
  const handle = vi.fn(
    (channel: string, handler: (_event: unknown, payload?: unknown) => Promise<unknown>) => {
      registeredHandlers.set(channel, handler);
    },
  );
  const settings = {
    clearJobSiteBrowserData: vi.fn(() => Promise.resolve()),
    getSettingsSnapshot: vi.fn().mockResolvedValue({
      appVersion: '1.0.0',
      workerCommand: 'codex',
      workerProvider: 'codex',
    }),
    resetLocalAppData: vi.fn(() => Promise.resolve()),
  };

  const bootstrap = createDesktopAppBootstrap({
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('first_launch'),
      openAiWorkerSetupGuide: vi.fn(() => Promise.resolve()),
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      startAiWorkerSignIn: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    app,
    browserWindow,
    ipcMain: {
      handle,
    },
    onOriginalCvImported: vi.fn(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
    settings,
    tailoredApplication: {
      abandonPendingGeneration: vi.fn(() => Promise.resolve()),
      completePendingGeneration: vi.fn(() =>
        Promise.resolve({
          workspaceState: {
            activeApplicationId: null,
            applications: [],
          },
        }),
      ),
      deleteTailoredApplication: vi.fn(() => Promise.resolve()),
      exportAdaptedCvPdf: vi.fn(() => Promise.resolve(null)),
      exportCoverLetterPdf: vi.fn(() => Promise.resolve(null)),
      getPendingGenerationCommand: vi.fn(() => Promise.resolve(null)),
      getTailoredApplicationPreview: vi.fn(() => Promise.resolve(null)),
      getWorkspaceSelection: vi.fn(() => Promise.resolve(null)),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeApplicationId: null,
        applications: [],
      }),
      recoverInterruptedGeneration: vi.fn(() => Promise.resolve()),
      resumePendingGeneration: vi.fn().mockResolvedValue({
        generationRunId: 'run-123',
        tailoredApplicationId: 'tailored-application-123',
      }),
      setWorkspaceSelection: vi.fn(() => Promise.resolve()),
      startPendingGeneration: vi.fn(),
    },
    vacancy: {
      getWorkspaceState: vi.fn().mockResolvedValue({
        draft: {
          text: '',
          url: '',
        },
        vacancy: null,
      }),
      ingestPastedVacancy: vi.fn(),
      ingestVacancyUrl: vi.fn(),
      openBrowserSession: vi.fn(),
      resetWorkspaceState: vi.fn(() => Promise.resolve()),
    },
  });

  await bootstrap.start();

  expect(handle).toHaveBeenCalledWith(SETTINGS_IPC_CHANNELS.getSnapshot, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(
    SETTINGS_IPC_CHANNELS.clearJobSiteBrowserData,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    SETTINGS_IPC_CHANNELS.resetLocalAppData,
    expect.any(Function),
  );
  await expect(registeredHandlers.get(SETTINGS_IPC_CHANNELS.getSnapshot)?.()).resolves.toEqual({
    appVersion: '1.0.0',
    workerCommand: 'codex',
    workerProvider: 'codex',
  });
  await expect(
    registeredHandlers.get(SETTINGS_IPC_CHANNELS.clearJobSiteBrowserData)?.(),
  ).resolves.toBeUndefined();
  await expect(
    registeredHandlers.get(SETTINGS_IPC_CHANNELS.resetLocalAppData)?.(undefined, {
      confirmationPhrase: SETTINGS_RESET_CONFIRMATION_PHRASE,
    }),
  ).resolves.toBeUndefined();

  expect(settings.clearJobSiteBrowserData).toHaveBeenCalledTimes(1);
  expect(settings.resetLocalAppData).toHaveBeenCalledWith({
    confirmationPhrase: SETTINGS_RESET_CONFIRMATION_PHRASE,
  });
});
