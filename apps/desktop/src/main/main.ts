import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PendingGenerationCommand } from '../shared/pending-generation.js';
import type { StartupDestination } from '../shared/startup-destination.js';
import {
  type AiWorkerPreflightService,
  createAiWorkerPreflightService,
} from './ai-worker-preflight-service.js';
import { createAiWorkerReadinessStore } from './ai-worker-readiness-store.js';
import { type IpcMainLike, registerDesktopIpcHandlers } from './desktop-ipc-handlers.js';
import { createLocalAppDataPaths, openLocalAppData } from './local-app-data-service.js';
import { extractTextFromDocx, extractTextFromPdf } from './original-cv-document-extractor.js';
import { createOriginalCvNormalizationService } from './original-cv-normalization-service.js';
import { createOriginalCvNormalizationWorker } from './original-cv-normalization-worker.js';
import { createOriginalCvService, type OriginalCvService } from './original-cv-service.js';
import { createSafeStorageKeychain } from './safe-storage-keychain.js';
import { createSettingsService, type SettingsService } from './settings-service.js';
import { createTailoredApplicationGenerationWorker } from './tailored-application-generation-worker.js';
import {
  createTailoredApplicationSessionService,
  type TailoredApplicationSessionService,
} from './tailored-application-session-service.js';
import { createVacancyBrowserSessionService } from './vacancy-browser-session-service.js';
import { createVacancyNormalizationService } from './vacancy-normalization-service.js';
import { createVacancyNormalizationWorker } from './vacancy-normalization-worker.js';
import { createVacancyService, type VacancyService } from './vacancy-service.js';
import { createWorkspaceSelectionStore } from './workspace-selection-store.js';

const CODEX_SETUP_GUIDE_URL = 'https://developers.openai.com/codex/app/';
const DESKTOP_APP_NAME = 'CV Maxxing';
const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
const desktopAppIconPath = path.resolve(currentDirectory, '../../assets/app-icon.png');
const preloadPath = path.join(currentDirectory, '../preload/preload.js');
const rendererIndexPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const rendererDevelopmentUrl = process.env.CV_MAXXING_RENDERER_URL;
const require = createRequire(import.meta.url);

interface AppLike {
  configureAboutPanelMetadata?: () => void;
  on: (event: 'activate' | 'window-all-closed', handler: () => void) => unknown;
  quit: () => void;
  setDockIcon?: () => void;
  whenReady: () => Promise<void>;
}

interface BrowserWindowLike {
  loadFile: (path: string) => Promise<void>;
  loadURL: (url: string) => Promise<void>;
}

interface DesktopBrowserWindowOptions {
  backgroundColor: string;
  frame?: boolean;
  height: number;
  show: boolean;
  title: string;
  trafficLightPosition?: {
    x: number;
    y: number;
  };
  titleBarStyle?: 'customButtonsOnHover' | 'default' | 'hidden' | 'hiddenInset';
  useContentSize?: boolean;
  webPreferences: {
    contextIsolation: boolean;
    nodeIntegration: boolean;
    preload: string;
    sandbox: boolean;
  };
  width: number;
}

interface BrowserWindowModule {
  create: (options: DesktopBrowserWindowOptions) => BrowserWindowLike;
  getAllWindows: () => BrowserWindowLike[];
}

interface DesktopAppBootstrapDependencies {
  aiWorker: AiWorkerPreflightService;
  app: AppLike;
  browserWindow: BrowserWindowModule;
  ipcMain: IpcMainLike;
  mainWindowShow?: boolean;
  onOriginalCvImported: () => Promise<void>;
  originalCv: OriginalCvService;
  platform: NodeJS.Platform;
  preloadPath: string;
  rendererDevelopmentUrl?: string;
  rendererIndexPath: string;
  settings: SettingsService;
  tailoredApplicationPreviewDelayMs?: number;
  tailoredApplication: TailoredApplicationSessionService;
  vacancy: VacancyService;
}

type ElectronAppOn = ((event: 'activate', listener: (...args: unknown[]) => void) => unknown) &
  ((event: 'window-all-closed', listener: (...args: unknown[]) => void) => unknown);

interface ElectronAppLike {
  on: ElectronAppOn;
  quit: () => void;
  whenReady: () => Promise<void>;
}

interface ElectronDockLike {
  setIcon: (iconPath: string) => void;
}

interface ElectronAboutPanelOptions {
  applicationName: string;
  applicationVersion: string;
}

type ElectronDesktopApp = ElectronAppLike & {
  dock?: ElectronDockLike;
  getPath: (name: 'userData') => string;
  isPackaged: boolean;
  getVersion: () => string;
  relaunch: () => void;
  setAboutPanelOptions: (options: ElectronAboutPanelOptions) => void;
};

interface ElectronBrowserWindowConstructor {
  new (options: DesktopBrowserWindowOptions): BrowserWindowLike;
  getAllWindows: () => BrowserWindowLike[];
}

interface RuntimeDependencyOptions {
  aiWorker: AiWorkerPreflightService;
  app: ElectronAppLike & {
    dock?: ElectronDockLike;
    getVersion: () => string;
    setAboutPanelOptions: (options: ElectronAboutPanelOptions) => void;
  };
  browserWindowConstructor: ElectronBrowserWindowConstructor;
  ipcMain: IpcMainLike;
  mainWindowShow?: boolean;
  onOriginalCvImported: () => Promise<void>;
  originalCv: OriginalCvService;
  platform: NodeJS.Platform;
  preloadPath: string;
  rendererDevelopmentUrl?: string;
  rendererIndexPath: string;
  settings: SettingsService;
  tailoredApplicationPreviewDelayMs?: number;
  tailoredApplication: TailoredApplicationSessionService;
  vacancy: VacancyService;
}

interface HandleOriginalCvImportedInput {
  tailoredApplication: Pick<TailoredApplicationSessionService, 'abandonPendingGeneration'>;
}

export async function handleOriginalCvImported({
  tailoredApplication,
}: HandleOriginalCvImportedInput): Promise<void> {
  await tailoredApplication.abandonPendingGeneration();
}

export interface RuntimeEnvironment {
  CHECKING_TIMEOUT_MS?: string;
  CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS?: string;
  CV_MAXXING_AI_WORKER_CODEX_COMMAND?: string;
  CV_MAXXING_AI_WORKER_GENERATION_DELAY_MS?: string;
  CV_MAXXING_AI_WORKER_GENERATION_FAILURE?: string;
  CV_MAXXING_AI_WORKER_GENERATION_OUTPUT?: string;
  CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_DELAY_MS?: string;
  CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_FAILURE?: string;
  CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT?: string;
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_DELAY_MS?: string;
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_FAILURE?: string;
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT?: string;
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_TIMEOUT_MS?: string;
  CV_MAXXING_LOCAL_APP_DATA_ROOT?: string;
  CV_MAXXING_MAIN_WINDOW_SHOW?: string;
  CV_MAXXING_AI_WORKER_RETRY_STATUS?: string;
  CV_MAXXING_AI_WORKER_SIGN_IN_STATUS?: string;
  CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET?: string;
  CV_MAXXING_PENDING_GENERATION_COMMAND?: string;
  CV_MAXXING_STARTUP_DESTINATION?: string;
  CV_MAXXING_TAILORED_APPLICATION_PREVIEW_DELAY_MS?: string;
  CV_MAXXING_TEST_OPEN_AI_SETUP_GUIDE_ERROR?: string;
  CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH?: string;
  CV_MAXXING_TEST_RESET_LOCAL_APP_DATA_ERROR?: string;
  CV_MAXXING_VACANCY_BROWSER_SESSION_CLOSE_AFTER_LOAD?: string;
  CV_MAXXING_VACANCY_BROWSER_SESSION_HTML?: string;
  CV_MAXXING_VACANCY_BROWSER_SESSION_RESOLVED_URL?: string;
}

interface PackagedRuntimeFixtureGuardInput {
  environment: RuntimeEnvironment;
  isPackaged: boolean;
}

const PACKAGED_RUNTIME_FIXTURE_OVERRIDE_KEYS = [
  'CV_MAXXING_AI_WORKER_GENERATION_DELAY_MS',
  'CV_MAXXING_AI_WORKER_GENERATION_FAILURE',
  'CV_MAXXING_AI_WORKER_GENERATION_OUTPUT',
  'CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_DELAY_MS',
  'CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_FAILURE',
  'CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT',
  'CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS',
  'CV_MAXXING_AI_WORKER_RETRY_STATUS',
  'CV_MAXXING_AI_WORKER_SIGN_IN_STATUS',
  'CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_DELAY_MS',
  'CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_FAILURE',
  'CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT',
  'CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET',
  'CV_MAXXING_PENDING_GENERATION_COMMAND',
  'CV_MAXXING_STARTUP_DESTINATION',
  'CV_MAXXING_TAILORED_APPLICATION_PREVIEW_DELAY_MS',
  'CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH',
  'CV_MAXXING_TEST_OPEN_AI_SETUP_GUIDE_ERROR',
  'CV_MAXXING_TEST_RESET_LOCAL_APP_DATA_ERROR',
  'CV_MAXXING_VACANCY_BROWSER_SESSION_CLOSE_AFTER_LOAD',
  'CV_MAXXING_VACANCY_BROWSER_SESSION_HTML',
  'CV_MAXXING_VACANCY_BROWSER_SESSION_RESOLVED_URL',
] as const satisfies readonly (keyof RuntimeEnvironment)[];

interface ElectronRuntimeModule {
  BrowserWindow: ElectronBrowserWindowConstructor;
  app: ElectronDesktopApp;
  dialog: {
    showSaveDialog: (options: unknown) => Promise<{
      canceled: boolean;
      filePath?: string;
    }>;
  };
  ipcMain: IpcMainLike;
  safeStorage: {
    decryptString: (encryptedValue: Buffer) => string;
    encryptString: (value: string) => Buffer;
    isEncryptionAvailable: () => boolean;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
}

export function createDesktopAppBootstrap({
  aiWorker,
  app,
  browserWindow,
  ipcMain,
  mainWindowShow = true,
  onOriginalCvImported,
  originalCv,
  platform,
  preloadPath,
  rendererDevelopmentUrl,
  rendererIndexPath,
  settings,
  tailoredApplicationPreviewDelayMs = 0,
  tailoredApplication,
  vacancy,
}: DesktopAppBootstrapDependencies) {
  function registerIpcHandlers() {
    registerDesktopIpcHandlers({
      aiWorker,
      ipcMain,
      onOriginalCvImported,
      originalCv,
      settings,
      tailoredApplicationPreviewDelayMs,
      tailoredApplication,
      vacancy,
    });
  }

  async function createMainWindow(): Promise<void> {
    const mainWindow = browserWindow.create({
      backgroundColor: '#08141f',
      ...(platform === 'darwin'
        ? {
            trafficLightPosition: {
              x: 12,
              y: 20,
            },
            titleBarStyle: 'hiddenInset' as const,
          }
        : {}),
      height: 900,
      show: mainWindowShow,
      title: DESKTOP_APP_NAME,
      useContentSize: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
        sandbox: false,
      },
      width: 1440,
    });

    if (rendererDevelopmentUrl) {
      await mainWindow.loadURL(rendererDevelopmentUrl);

      return;
    }

    await mainWindow.loadFile(rendererIndexPath);
  }

  async function start(): Promise<void> {
    await app.whenReady();

    app.configureAboutPanelMetadata?.();

    if (platform === 'darwin') {
      app.setDockIcon?.();
    }

    registerIpcHandlers();
    await createMainWindow();

    app.on('activate', () => {
      if (browserWindow.getAllWindows().length === 0) {
        createMainWindow().catch((error: unknown) => {
          console.error('Failed to recreate the main window on activate.', error);
        });
      }
    });

    app.on('window-all-closed', () => {
      if (platform !== 'darwin') {
        app.quit();
      }
    });
  }

  return {
    start,
  };
}

export function createElectronRuntimeDependencies({
  aiWorker,
  app,
  browserWindowConstructor,
  ipcMain,
  mainWindowShow,
  onOriginalCvImported,
  originalCv,
  platform,
  preloadPath,
  rendererDevelopmentUrl,
  rendererIndexPath,
  settings,
  tailoredApplicationPreviewDelayMs,
  tailoredApplication,
  vacancy,
}: RuntimeDependencyOptions): DesktopAppBootstrapDependencies {
  return {
    aiWorker,
    app: {
      configureAboutPanelMetadata: () => {
        app.setAboutPanelOptions({
          applicationName: DESKTOP_APP_NAME,
          applicationVersion: app.getVersion(),
        });
      },
      on: (event, handler) => {
        if (event === 'activate') {
          return app.on('activate', () => {
            handler();
          });
        }

        return app.on('window-all-closed', () => {
          handler();
        });
      },
      quit: () => {
        app.quit();
      },
      setDockIcon: () => {
        app.dock?.setIcon(desktopAppIconPath);
      },
      whenReady: () => {
        return app.whenReady();
      },
    },
    browserWindow: {
      create: (options) => {
        return new browserWindowConstructor(options);
      },
      getAllWindows: () => {
        return browserWindowConstructor.getAllWindows();
      },
    },
    ipcMain,
    mainWindowShow,
    onOriginalCvImported,
    originalCv,
    platform,
    preloadPath,
    rendererDevelopmentUrl,
    rendererIndexPath,
    settings,
    tailoredApplicationPreviewDelayMs,
    tailoredApplication,
    vacancy,
  };
}

export function assertPackagedRuntimeHasNoFixtureOverrides({
  environment,
  isPackaged,
}: PackagedRuntimeFixtureGuardInput) {
  if (!isPackaged) {
    return;
  }

  const configuredFixtureOverrideKeys = PACKAGED_RUNTIME_FIXTURE_OVERRIDE_KEYS.filter((key) => {
    const value = environment[key];

    return value !== undefined && value.trim() !== '';
  });

  if (configuredFixtureOverrideKeys.length === 0) {
    return;
  }

  throw new Error(
    `Packaged app launch cannot use fixture-backed runtime overrides: ${configuredFixtureOverrideKeys.join(', ')}.`,
  );
}

async function createRuntimeServices(electronRuntime: ElectronRuntimeModule): Promise<{
  aiWorker: AiWorkerPreflightService;
  onOriginalCvImported: () => Promise<void>;
  originalCv: OriginalCvService;
  settings: SettingsService;
  tailoredApplication: TailoredApplicationSessionService;
  vacancy: VacancyService;
}> {
  const environment = process.env as RuntimeEnvironment;

  assertPackagedRuntimeHasNoFixtureOverrides({
    environment,
    isPackaged: electronRuntime.app.isPackaged,
  });

  const [{ createElectronAdaptedCvRenderer }, { createElectronCoverLetterRenderer }] =
    await Promise.all([
      import('./adapted-cv-electron-renderer.js'),
      import('./cover-letter-electron-renderer.js'),
    ]);
  const paths = createLocalAppDataPaths(
    environment.CV_MAXXING_LOCAL_APP_DATA_ROOT ??
      path.join(electronRuntime.app.getPath('userData'), 'local-app-data'),
  );
  const localAppData = await openLocalAppData({
    keychain: createSafeStorageKeychain({
      keychainRecordPath: paths.keychainRecordPath,
      safeStorage: electronRuntime.safeStorage,
    }),
    paths,
  });
  const readinessStore = createAiWorkerReadinessStore({
    localAppData,
  });
  const workspaceSelectionStore = createWorkspaceSelectionStore({
    localAppData,
  });
  const aiWorker = createAiWorkerPreflightService({
    environment,
    getPendingGenerationCommand: async () => {
      const overrideCommand = parsePendingGenerationCommand(
        environment.CV_MAXXING_PENDING_GENERATION_COMMAND,
      );

      if (overrideCommand !== null) {
        return overrideCommand;
      }

      return await readinessStore.getPendingGenerationCommand();
    },
    getPersistedCheckingTimeout: async () => {
      return await readinessStore.getCheckingTimeout();
    },
    getPersistedStartupDestination: async () => {
      const overrideDestination = parseStartupDestination(
        environment.CV_MAXXING_STARTUP_DESTINATION,
      );

      if (overrideDestination !== null) {
        return overrideDestination;
      }

      return await readinessStore.getStartupDestination();
    },
    openAiWorkerSetupGuide: async () => {
      await electronRuntime.shell.openExternal(CODEX_SETUP_GUIDE_URL);
    },
  });
  const vacancyBrowserSession = createVacancyBrowserSessionService({
    autoCloseAfterFirstObservation:
      environment.CV_MAXXING_VACANCY_BROWSER_SESSION_CLOSE_AFTER_LOAD === 'true',
    profileRootPath: path.join(paths.rootDirectoryPath, 'browser-sessions'),
    testResolvedUrl: environment.CV_MAXXING_VACANCY_BROWSER_SESSION_RESOLVED_URL,
    testSnapshotHtml: environment.CV_MAXXING_VACANCY_BROWSER_SESSION_HTML,
  });
  const tailoredApplication = createTailoredApplicationSessionService({
    adaptedCvRenderer: createElectronAdaptedCvRenderer(),
    aiWorker,
    coverLetterRenderer: createElectronCoverLetterRenderer(),
    exportDialog: createAdaptedCvExportDialog({
      dialog: electronRuntime.dialog,
      environment,
    }),
    localAppData,
    readinessStore,
    runWorkspaceRootPath: path.join(paths.rootDirectoryPath, 'runs'),
    worker: createTailoredApplicationGenerationWorker({
      environment,
    }),
    workspaceSelectionStore,
  });
  const originalCvNormalizationService = createOriginalCvNormalizationService({
    runWorkspaceRootPath: path.join(paths.rootDirectoryPath, 'runs', 'original-cv-normalization'),
    worker: createOriginalCvNormalizationWorker({
      environment,
    }),
  });
  const vacancyNormalizationService = createVacancyNormalizationService({
    runWorkspaceRootPath: path.join(paths.rootDirectoryPath, 'runs', 'vacancy-normalization'),
    timeoutMs: parseTimeoutOverride(
      environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_TIMEOUT_MS,
    ),
    worker: createVacancyNormalizationWorker({
      environment,
    }),
  });

  await tailoredApplication.recoverInterruptedGeneration();

  return {
    aiWorker,
    onOriginalCvImported: async () => {
      await handleOriginalCvImported({
        tailoredApplication,
      });
    },
    originalCv: createOriginalCvService({
      extractTextFromDocx,
      extractTextFromPdf,
      localAppData,
      normalizationService: originalCvNormalizationService,
    }),
    settings: createSettingsService({
      allowResetLocalAppDataErrorMessage: !electronRuntime.app.isPackaged,
      browserSessionRootPath: path.join(paths.rootDirectoryPath, 'browser-sessions'),
      closeActiveJobs: async () => {
        await tailoredApplication.abandonPendingGeneration();
      },
      getAppVersion: () => {
        return electronRuntime.app.getVersion();
      },
      localAppData,
      resetLocalAppDataErrorMessage: environment.CV_MAXXING_TEST_RESET_LOCAL_APP_DATA_ERROR,
      restartApp: () => {
        if (environment.CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET === 'true') {
          return Promise.resolve();
        }

        electronRuntime.app.relaunch();
        electronRuntime.app.quit();

        return Promise.resolve();
      },
      workerCommand: environment.CV_MAXXING_AI_WORKER_CODEX_COMMAND ?? 'codex',
    }),
    tailoredApplication,
    vacancy: createVacancyService({
      captureVacancyBrowserSessionPage: async ({ readingActions, shouldCapturePage, url }) => {
        return await vacancyBrowserSession.captureSessionPage({
          readingActions,
          shouldCapturePage,
          url,
        });
      },
      localAppData,
      normalizationService: vacancyNormalizationService,
      openVacancyBrowserSession: async ({ readingActions, shouldCapturePage, url }) => {
        return await vacancyBrowserSession.openSession({
          readingActions,
          shouldCapturePage,
          url,
        });
      },
      workspaceSelectionStore,
    }),
  };
}

function parsePendingGenerationCommand(
  rawCommand: string | undefined,
): PendingGenerationCommand | null {
  if (rawCommand === undefined || rawCommand.trim() === '') {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawCommand) as unknown;

    if (!isPendingGenerationCommand(parsedValue)) {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

function isPendingGenerationCommand(value: unknown): value is PendingGenerationCommand {
  return (
    value !== null &&
    typeof value === 'object' &&
    'commandId' in value &&
    typeof value.commandId === 'string' &&
    'originalCvId' in value &&
    typeof value.originalCvId === 'string' &&
    'originalCvLabel' in value &&
    typeof value.originalCvLabel === 'string' &&
    'vacancyId' in value &&
    typeof value.vacancyId === 'string' &&
    'vacancyDraft' in value &&
    value.vacancyDraft !== null &&
    typeof value.vacancyDraft === 'object' &&
    'text' in value.vacancyDraft &&
    typeof value.vacancyDraft.text === 'string' &&
    'url' in value.vacancyDraft &&
    typeof value.vacancyDraft.url === 'string'
  );
}

function parseStartupDestination(value: string | undefined): StartupDestination | null {
  if (value === 'workspace_loading') {
    return 'workspace';
  }

  if (value === 'first_launch' || value === 'workspace') {
    return value;
  }

  return null;
}

function parseTimeoutOverride(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return undefined;
  }

  return Math.trunc(parsedValue);
}

function parseDelay(value: string | undefined) {
  if (value === undefined || value.trim() === '') {
    return 0;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 0;
  }

  return Math.trunc(parsedValue);
}

function parseMainWindowShow(value: string | undefined) {
  return value !== 'false';
}

async function startDesktopAppRuntime(): Promise<void> {
  const electronRuntime = loadElectronRuntime();
  const environment = process.env as RuntimeEnvironment;
  const runtimeServices = await createRuntimeServices(electronRuntime);

  await createDesktopAppBootstrap(
    createElectronRuntimeDependencies({
      aiWorker: runtimeServices.aiWorker,
      app: electronRuntime.app,
      browserWindowConstructor: electronRuntime.BrowserWindow,
      ipcMain: electronRuntime.ipcMain,
      mainWindowShow: parseMainWindowShow(environment.CV_MAXXING_MAIN_WINDOW_SHOW),
      onOriginalCvImported: runtimeServices.onOriginalCvImported,
      originalCv: runtimeServices.originalCv,
      platform: process.platform,
      preloadPath,
      rendererDevelopmentUrl,
      rendererIndexPath,
      settings: runtimeServices.settings,
      tailoredApplicationPreviewDelayMs: parseDelay(
        environment.CV_MAXXING_TAILORED_APPLICATION_PREVIEW_DELAY_MS,
      ),
      tailoredApplication: runtimeServices.tailoredApplication,
      vacancy: runtimeServices.vacancy,
    }),
  ).start();
}

if (process.env.VITEST !== 'true') {
  void startDesktopAppRuntime().catch((error: unknown) => {
    throw error;
  });
}

function createAdaptedCvExportDialog({
  dialog,
  environment,
}: {
  dialog: ElectronRuntimeModule['dialog'];
  environment: RuntimeEnvironment;
}) {
  if (
    environment.CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH !== undefined &&
    environment.CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH !== ''
  ) {
    return {
      showSaveDialog: () => {
        return Promise.resolve({
          canceled: false,
          filePath: environment.CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH,
        });
      },
    };
  }

  return dialog;
}

function loadElectronRuntime(): ElectronRuntimeModule {
  return require('electron') as ElectronRuntimeModule;
}
