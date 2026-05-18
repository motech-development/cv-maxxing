import { fileURLToPath } from 'node:url';

import { beforeEach, expect, test, vi } from 'vitest';

import {
  AI_WORKER_IPC_CHANNELS,
  ORIGINAL_CV_IPC_CHANNELS,
  SETTINGS_IPC_CHANNELS,
  TAILORED_APPLICATION_IPC_CHANNELS,
  VACANCY_IPC_CHANNELS,
} from '../../shared/ipc.js';
import {
  assertPackagedRuntimeHasNoFixtureOverrides,
  createDesktopAppBootstrap,
  createElectronRuntimeDependencies,
  handleOriginalCvImported,
} from '../main.js';

type AppEvent = 'activate' | 'window-all-closed';

const appIconPath = fileURLToPath(new URL('../../../assets/app-icon.png', import.meta.url));

function createAppDouble() {
  const eventHandlers = new Map<AppEvent, () => void>();

  return {
    app: {
      on: vi.fn((event: AppEvent, handler: () => void) => {
        eventHandlers.set(event, handler);
      }),
      quit: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
    },
    eventHandlers,
  };
}

function createBrowserWindowDouble() {
  const loadFile = vi.fn(() => Promise.resolve());
  const loadURL = vi.fn(() => Promise.resolve());
  const getAllWindows = vi.fn().mockReturnValue([]);
  const constructor = vi.fn().mockImplementation(() => {
    return {
      loadFile,
      loadURL,
    };
  });

  return {
    browserWindow: {
      create: constructor,
      getAllWindows,
    },
    constructor,
    getAllWindows,
    loadFile,
    loadURL,
  };
}

function createVacancyDouble() {
  return {
    getWorkspaceState: vi.fn().mockResolvedValue({
      draft: {
        text: '',
        url: '',
      },
      vacancy: null,
    }),
    ingestPastedVacancy: vi.fn(),
    ingestVacancyUrl: vi.fn(),
    openBrowserSession: vi.fn().mockResolvedValue({
      kind: 'incomplete',
      vacancy: {
        blockingReason:
          'Open the job page and close it after the full details load, or paste the job description instead.',
        canGenerate: false,
        employer: null,
        fetchedAt: '2026-04-08T21:15:00.000Z',
        id: 'vacancy-pending-browser',
        inputType: 'url',
        location: null,
        originalUrl: 'https://jobs.example.com/private/123',
        requirements: [],
        resolvedUrl: null,
        responsibilities: [],
        source: 'jobs.example.com',
        status: 'incomplete',
        textPreview: '',
        title: null,
      },
      workspaceState: {
        draft: {
          text: '',
          url: 'https://jobs.example.com/private/123',
        },
        vacancy: null,
      },
    }),
    resetWorkspaceState: vi.fn().mockImplementation(() => Promise.resolve()),
  };
}

function createTailoredApplicationDouble() {
  return {
    abandonPendingGeneration: vi.fn().mockImplementation(() => Promise.resolve()),
    completePendingGeneration: vi.fn().mockResolvedValue({
      workspaceState: {
        activeApplicationId: null,
        applications: [],
      },
    }),
    deleteTailoredApplication: vi.fn().mockImplementation(() => Promise.resolve()),
    exportAdaptedCvPdf: vi.fn().mockResolvedValue({
      filePath: '/exports/Ada Lovelace - Senior platform engineer - adapted-cv.pdf',
      overwriteAvoided: false,
      pageWarning: null,
    }),
    exportCoverLetterPdf: vi.fn().mockResolvedValue({
      filePath: '/exports/Ada Lovelace - Senior platform engineer - cover-letter.pdf',
      overwriteAvoided: false,
      pageWarning: null,
    }),
    getPendingGenerationCommand: vi.fn().mockResolvedValue({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
    getTailoredApplicationPreview: vi.fn().mockResolvedValue(null),
    getWorkspaceSelection: vi.fn().mockResolvedValue({
      jobs: {
        kind: 'none',
      },
      originalCv: {
        kind: 'none',
      },
      topLevelSection: 'job_vacancies',
    }),
    getWorkspaceState: vi.fn().mockResolvedValue({
      activeApplicationId: null,
      applications: [],
    }),
    resumePendingGeneration: vi.fn().mockResolvedValue({
      generationRunId: 'run-123',
      tailoredApplicationId: 'tailored-application-123',
    }),
    recoverInterruptedGeneration: vi.fn().mockImplementation(() => Promise.resolve()),
    setWorkspaceSelection: vi.fn().mockImplementation(() => Promise.resolve()),
    startPendingGeneration: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      failureCode: 'auth_missing',
      message: 'AI needs you to sign in before CV Maxxing can finish your CV and cover letter.',
      provider: 'codex',
      status: 'sign_in_required',
    }),
  };
}

function createSettingsDouble() {
  return {
    clearJobSiteBrowserData: vi.fn().mockImplementation(() => Promise.resolve()),
    getSettingsSnapshot: vi.fn().mockResolvedValue({
      appVersion: '1.0.0',
      workerCommand: 'codex',
      workerProvider: 'codex',
    }),
    resetLocalAppData: vi.fn().mockImplementation(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test('abandon pending tailored-application state after an original CV import succeeds', async () => {
  const tailoredApplication = {
    abandonPendingGeneration: vi.fn().mockImplementation(() => Promise.resolve()),
  };

  await expect(
    handleOriginalCvImported({
      tailoredApplication,
    }),
  ).resolves.toBeUndefined();

  expect(tailoredApplication.abandonPendingGeneration).toHaveBeenCalledTimes(1);
});

test('rejects fixture-backed runtime overrides for packaged app launches', () => {
  expect(() => {
    assertPackagedRuntimeHasNoFixtureOverrides({
      environment: {
        CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: '{"fixture":true}',
        CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET: 'true',
        CV_MAXXING_PENDING_GENERATION_COMMAND: '{"commandId":"command-123"}',
        CV_MAXXING_STARTUP_DESTINATION: 'workspace',
        CV_MAXXING_TAILORED_APPLICATION_PREVIEW_DELAY_MS: '250',
      },
      isPackaged: true,
    });
  }).toThrow(
    /CV_MAXXING_AI_WORKER_GENERATION_OUTPUT.*CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET.*CV_MAXXING_PENDING_GENERATION_COMMAND.*CV_MAXXING_STARTUP_DESTINATION.*CV_MAXXING_TAILORED_APPLICATION_PREVIEW_DELAY_MS/u,
  );
});

test('allows fixture-backed runtime overrides outside packaged app launches', () => {
  expect(() => {
    assertPackagedRuntimeHasNoFixtureOverrides({
      environment: {
        CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: '{"fixture":true}',
        CV_MAXXING_VACANCY_BROWSER_SESSION_HTML: '<main>Fixture</main>',
      },
      isPackaged: false,
    });
  }).not.toThrow();
});

test('bootstrap registers the full AI worker onboarding IPC surface and opens the packaged shell on startup', async () => {
  vi.useFakeTimers();

  const { app, eventHandlers } = createAppDouble();
  const { browserWindow, constructor, loadFile, loadURL } = createBrowserWindowDouble();
  const registeredHandlers = new Map<
    string,
    (_event?: unknown, payload?: unknown) => Promise<unknown>
  >();
  const handle = vi.fn(
    (channel: string, handler: (_event: unknown, payload?: unknown) => Promise<unknown>) => {
      registeredHandlers.set(channel, handler);
    },
  );
  const aiWorker = {
    getAiWorkerPreflight: vi
      .fn()
      .mockResolvedValueOnce({
        canResumeGeneration: false,
        message: 'Checking the local AI worker before opening your workspace.',
        provider: 'codex',
        status: 'checking',
      })
      .mockResolvedValueOnce({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
    retryAiWorkerPreflight: vi
      .fn()
      .mockResolvedValueOnce({
        canResumeGeneration: false,
        failureCode: 'runtime_missing',
        message: 'The local AI worker is unavailable. Check setup, then retry.',
        provider: 'codex',
        status: 'unavailable',
      })
      .mockResolvedValueOnce({
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
  };
  const originalCv = {
    getActiveOriginalCvDetail: vi.fn().mockResolvedValue({
      originalCv: {
        fileType: 'pdf',
        headline: 'Principal Product Designer',
        id: 'original-cv-123',
        importedAt: '2026-04-08T14:30:00.000Z',
        originalFilename: 'ada-lovelace.pdf',
        pageCount: 1,
        snapshotCount: 1,
        summary: 'Design leader focused on complex workflow products.',
        writingStyle: {
          averageSentenceLength: 7,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'direct',
        },
      },
      preview: {
        kind: 'pdf',
        pageCount: 1,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      },
      profile: {
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: 'ada-lovelace.dev',
        },
        experience: [
          {
            dateRange: '2022 - Present',
            employer: 'Analytical Engines Ltd',
            roleTitle: 'Principal Product Designer',
            summary: 'Led product design for AI-assisted desktop tooling.',
          },
        ],
        fullName: 'Ada Lovelace',
        headline: 'Principal Product Designer',
        skills: ['Workflow design', 'UX research', 'Product strategy'],
        summary: 'Design leader focused on complex workflow products.',
      },
    }),
    getWorkspaceState: vi.fn().mockResolvedValue({
      activeOriginalCv: {
        fileType: 'pdf',
        headline: 'Principal Product Designer',
        id: 'original-cv-123',
        importedAt: '2026-04-08T14:30:00.000Z',
        originalFilename: 'ada-lovelace.pdf',
        pageCount: 1,
        snapshotCount: 1,
        summary: 'Design leader focused on complex workflow products.',
        writingStyle: {
          averageSentenceLength: 7,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'direct',
        },
      },
      snapshotCount: 1,
    }),
    importOriginalCv: vi.fn().mockResolvedValue({
      fileType: 'docx',
      headline: 'Staff Product Designer',
      id: 'original-cv-456',
      importedAt: '2026-04-08T15:10:00.000Z',
      originalFilename: 'ada-lovelace-revised.docx',
      pageCount: 1,
      snapshotCount: 2,
      summary: 'Product designer adapting CVs for desktop AI tooling.',
      writingStyle: {
        averageSentenceLength: 8,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    }),
  };
  const vacancy = {
    getWorkspaceState: vi.fn().mockResolvedValue({
      draft: {
        text: '',
        url: '',
      },
      vacancy: null,
    }),
    ingestPastedVacancy: vi.fn().mockResolvedValue({
      kind: 'ingested',
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-08T21:00:00.000Z',
        id: 'vacancy-001',
        inputType: 'pasted_text',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/senior-product-designer',
        requirements: ['Strong written communication.'],
        resolvedUrl: 'https://jobs.example.com/senior-product-designer',
        responsibilities: ['Lead product design for AI-assisted desktop workflows.'],
        source: 'jobs.example.com',
        status: 'ready',
        textPreview: 'Lead product design for AI-assisted desktop workflows.',
        title: 'Senior Product Designer',
      },
      workspaceState: {
        draft: {
          text: 'Senior Product Designer',
          url: 'https://jobs.example.com/senior-product-designer',
        },
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-08T21:00:00.000Z',
          id: 'vacancy-001',
          inputType: 'pasted_text',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/senior-product-designer',
          requirements: ['Strong written communication.'],
          resolvedUrl: 'https://jobs.example.com/senior-product-designer',
          responsibilities: ['Lead product design for AI-assisted desktop workflows.'],
          source: 'jobs.example.com',
          status: 'ready',
          textPreview: 'Lead product design for AI-assisted desktop workflows.',
          title: 'Senior Product Designer',
        },
      },
    }),
    ingestVacancyUrl: vi.fn().mockResolvedValue({
      kind: 'incomplete',
      vacancy: {
        blockingReason:
          'This job page may need more access. Open the job page or paste the job description instead.',
        canGenerate: false,
        employer: null,
        fetchedAt: '2026-04-08T21:15:00.000Z',
        id: 'vacancy-pending-browser',
        inputType: 'url',
        location: null,
        originalUrl: 'https://jobs.example.com/private/123',
        requirements: [],
        resolvedUrl: null,
        responsibilities: [],
        source: 'jobs.example.com',
        status: 'incomplete',
        textPreview: '',
        title: null,
      },
      workspaceState: {
        draft: {
          text: '',
          url: 'https://jobs.example.com/private/123',
        },
        vacancy: null,
      },
    }),
    openBrowserSession: vi.fn().mockResolvedValue({
      kind: 'incomplete',
      vacancy: {
        blockingReason:
          'Open the job page and close it after the full details load, or paste the job description instead.',
        canGenerate: false,
        employer: null,
        fetchedAt: '2026-04-08T21:15:00.000Z',
        id: 'vacancy-pending-browser',
        inputType: 'url',
        location: null,
        originalUrl: 'https://jobs.example.com/private/123',
        requirements: [],
        resolvedUrl: null,
        responsibilities: [],
        source: 'jobs.example.com',
        status: 'incomplete',
        textPreview: '',
        title: null,
      },
      workspaceState: {
        draft: {
          text: '',
          url: 'https://jobs.example.com/private/123',
        },
        vacancy: null,
      },
    }),
    resetWorkspaceState: vi.fn().mockImplementation(() => Promise.resolve()),
  };
  const tailoredApplication = createTailoredApplicationDouble();
  const settings = createSettingsDouble();
  const onOriginalCvImported = vi.fn().mockImplementation(() => Promise.resolve());

  const bootstrap = createDesktopAppBootstrap({
    aiWorker,
    app,
    browserWindow,
    ipcMain: {
      handle,
    },
    onOriginalCvImported,
    originalCv,
    settings,
    tailoredApplicationPreviewDelayMs: 25,
    tailoredApplication,
    vacancy,
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  });

  await bootstrap.start();

  expect(app.whenReady).toHaveBeenCalledTimes(1);
  expect(handle).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.getPreflight, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(
    AI_WORKER_IPC_CHANNELS.getStartupDestination,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.retryPreflight, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.startSignIn, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.openSetupGuide, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(
    ORIGINAL_CV_IPC_CHANNELS.getWorkspaceState,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    ORIGINAL_CV_IPC_CHANNELS.importOriginalCv,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(SETTINGS_IPC_CHANNELS.getSnapshot, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(
    SETTINGS_IPC_CHANNELS.clearJobSiteBrowserData,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    SETTINGS_IPC_CHANNELS.resetLocalAppData,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    VACANCY_IPC_CHANNELS.clearWorkspaceState,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(VACANCY_IPC_CHANNELS.getWorkspaceState, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(VACANCY_IPC_CHANNELS.ingestUrl, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(VACANCY_IPC_CHANNELS.ingestPasted, expect.any(Function));
  expect(handle).toHaveBeenCalledWith(
    VACANCY_IPC_CHANNELS.openBrowserSession,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    TAILORED_APPLICATION_IPC_CHANNELS.getPendingGeneration,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    TAILORED_APPLICATION_IPC_CHANNELS.resumePendingGeneration,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    TAILORED_APPLICATION_IPC_CHANNELS.getWorkspaceSelection,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    TAILORED_APPLICATION_IPC_CHANNELS.startPendingGeneration,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    TAILORED_APPLICATION_IPC_CHANNELS.completePendingGeneration,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    TAILORED_APPLICATION_IPC_CHANNELS.abandonPendingGeneration,
    expect.any(Function),
  );
  expect(handle).toHaveBeenCalledWith(
    TAILORED_APPLICATION_IPC_CHANNELS.exportCoverLetterPdf,
    expect.any(Function),
  );

  await expect(registeredHandlers.get(AI_WORKER_IPC_CHANNELS.getPreflight)?.()).resolves.toEqual({
    canResumeGeneration: false,
    message: 'Checking the local AI worker before opening your workspace.',
    provider: 'codex',
    status: 'checking',
  });
  await expect(
    registeredHandlers.get(AI_WORKER_IPC_CHANNELS.getStartupDestination)?.(),
  ).resolves.toBe('workspace');
  await expect(registeredHandlers.get(AI_WORKER_IPC_CHANNELS.retryPreflight)?.()).resolves.toEqual({
    canResumeGeneration: false,
    failureCode: 'runtime_missing',
    message: 'The local AI worker is unavailable. Check setup, then retry.',
    provider: 'codex',
    status: 'unavailable',
  });
  await expect(registeredHandlers.get(AI_WORKER_IPC_CHANNELS.startSignIn)?.()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  });
  await expect(registeredHandlers.get(AI_WORKER_IPC_CHANNELS.openSetupGuide)?.()).resolves.toBe(
    undefined,
  );
  await expect(
    registeredHandlers.get(ORIGINAL_CV_IPC_CHANNELS.getWorkspaceState)?.(),
  ).resolves.toEqual({
    activeOriginalCv: {
      fileType: 'pdf',
      headline: 'Principal Product Designer',
      id: 'original-cv-123',
      importedAt: '2026-04-08T14:30:00.000Z',
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 1,
      snapshotCount: 1,
      summary: 'Design leader focused on complex workflow products.',
      writingStyle: {
        averageSentenceLength: 7,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
    snapshotCount: 1,
  });
  await expect(
    registeredHandlers.get(ORIGINAL_CV_IPC_CHANNELS.getActiveDetail)?.(),
  ).resolves.toEqual({
    originalCv: {
      fileType: 'pdf',
      headline: 'Principal Product Designer',
      id: 'original-cv-123',
      importedAt: '2026-04-08T14:30:00.000Z',
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 1,
      snapshotCount: 1,
      summary: 'Design leader focused on complex workflow products.',
      writingStyle: {
        averageSentenceLength: 7,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
    preview: {
      kind: 'pdf',
      pageCount: 1,
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    profile: {
      contact: {
        email: 'ada@lovelace.dev',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'ada-lovelace.dev',
      },
      experience: [
        {
          dateRange: '2022 - Present',
          employer: 'Analytical Engines Ltd',
          roleTitle: 'Principal Product Designer',
          summary: 'Led product design for AI-assisted desktop tooling.',
        },
      ],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Workflow design', 'UX research', 'Product strategy'],
      summary: 'Design leader focused on complex workflow products.',
    },
  });
  await expect(
    registeredHandlers.get(ORIGINAL_CV_IPC_CHANNELS.importOriginalCv)?.(undefined, {
      content: new Uint8Array([68, 79, 67, 88]),
      filename: 'ada-lovelace-revised.docx',
    }),
  ).resolves.toEqual({
    kind: 'imported',
    originalCv: {
      fileType: 'docx',
      headline: 'Staff Product Designer',
      id: 'original-cv-456',
      importedAt: '2026-04-08T15:10:00.000Z',
      originalFilename: 'ada-lovelace-revised.docx',
      pageCount: 1,
      snapshotCount: 2,
      summary: 'Product designer adapting CVs for desktop AI tooling.',
      writingStyle: {
        averageSentenceLength: 8,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
  });
  expect(originalCv.importOriginalCv).toHaveBeenCalledWith({
    content: Buffer.from([68, 79, 67, 88]),
    filename: 'ada-lovelace-revised.docx',
  });
  expect(onOriginalCvImported).toHaveBeenCalledTimes(1);
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
      confirmationPhrase: 'RESET',
    }),
  ).resolves.toBeUndefined();
  expect(settings.clearJobSiteBrowserData).toHaveBeenCalledTimes(1);
  expect(settings.resetLocalAppData).toHaveBeenCalledWith({
    confirmationPhrase: 'RESET',
  });
  await expect(registeredHandlers.get(VACANCY_IPC_CHANNELS.getWorkspaceState)?.()).resolves.toEqual(
    {
      draft: {
        text: '',
        url: '',
      },
      vacancy: null,
    },
  );
  await expect(
    registeredHandlers.get(VACANCY_IPC_CHANNELS.clearWorkspaceState)?.(),
  ).resolves.toBeUndefined();
  await expect(
    registeredHandlers.get(VACANCY_IPC_CHANNELS.ingestUrl)?.(undefined, {
      url: 'https://jobs.example.com/private/123',
    }),
  ).resolves.toEqual({
    kind: 'incomplete',
    vacancy: {
      blockingReason:
        'This job page may need more access. Open the job page or paste the job description instead.',
      canGenerate: false,
      employer: null,
      fetchedAt: '2026-04-08T21:15:00.000Z',
      id: 'vacancy-pending-browser',
      inputType: 'url',
      location: null,
      originalUrl: 'https://jobs.example.com/private/123',
      requirements: [],
      resolvedUrl: null,
      responsibilities: [],
      source: 'jobs.example.com',
      status: 'incomplete',
      textPreview: '',
      title: null,
    },
    workspaceState: {
      draft: {
        text: '',
        url: 'https://jobs.example.com/private/123',
      },
      vacancy: null,
    },
  });
  await expect(
    registeredHandlers.get(VACANCY_IPC_CHANNELS.ingestPasted)?.(undefined, {
      text: 'Senior Product Designer',
      url: 'https://jobs.example.com/senior-product-designer',
    }),
  ).resolves.toEqual({
    kind: 'ingested',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-08T21:00:00.000Z',
      id: 'vacancy-001',
      inputType: 'pasted_text',
      location: 'London, United Kingdom',
      originalUrl: 'https://jobs.example.com/senior-product-designer',
      requirements: ['Strong written communication.'],
      resolvedUrl: 'https://jobs.example.com/senior-product-designer',
      responsibilities: ['Lead product design for AI-assisted desktop workflows.'],
      source: 'jobs.example.com',
      status: 'ready',
      textPreview: 'Lead product design for AI-assisted desktop workflows.',
      title: 'Senior Product Designer',
    },
    workspaceState: {
      draft: {
        text: 'Senior Product Designer',
        url: 'https://jobs.example.com/senior-product-designer',
      },
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-08T21:00:00.000Z',
        id: 'vacancy-001',
        inputType: 'pasted_text',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/senior-product-designer',
        requirements: ['Strong written communication.'],
        resolvedUrl: 'https://jobs.example.com/senior-product-designer',
        responsibilities: ['Lead product design for AI-assisted desktop workflows.'],
        source: 'jobs.example.com',
        status: 'ready',
        textPreview: 'Lead product design for AI-assisted desktop workflows.',
        title: 'Senior Product Designer',
      },
    },
  });
  await expect(
    registeredHandlers.get(VACANCY_IPC_CHANNELS.openBrowserSession)?.(undefined, {
      url: 'https://jobs.example.com/private/123',
    }),
  ).resolves.toEqual({
    kind: 'incomplete',
    vacancy: {
      blockingReason:
        'Open the job page and close it after the full details load, or paste the job description instead.',
      canGenerate: false,
      employer: null,
      fetchedAt: '2026-04-08T21:15:00.000Z',
      id: 'vacancy-pending-browser',
      inputType: 'url',
      location: null,
      originalUrl: 'https://jobs.example.com/private/123',
      requirements: [],
      resolvedUrl: null,
      responsibilities: [],
      source: 'jobs.example.com',
      status: 'incomplete',
      textPreview: '',
      title: null,
    },
    workspaceState: {
      draft: {
        text: '',
        url: 'https://jobs.example.com/private/123',
      },
      vacancy: null,
    },
  });
  expect(vacancy.ingestVacancyUrl).toHaveBeenCalledWith({
    url: 'https://jobs.example.com/private/123',
  });
  expect(vacancy.ingestPastedVacancy).toHaveBeenCalledWith({
    text: 'Senior Product Designer',
    url: 'https://jobs.example.com/senior-product-designer',
  });
  expect(vacancy.openBrowserSession).toHaveBeenCalledWith({
    url: 'https://jobs.example.com/private/123',
  });
  expect(vacancy.resetWorkspaceState).toHaveBeenCalledTimes(1);
  await expect(
    registeredHandlers.get(TAILORED_APPLICATION_IPC_CHANNELS.getPendingGeneration)?.(),
  ).resolves.toEqual({
    commandId: 'command-123',
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyId: 'vacancy-123',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  });
  const previewRequestPromise = registeredHandlers.get(
    TAILORED_APPLICATION_IPC_CHANNELS.getPreview,
  )?.(undefined, {
    tailoredApplicationId: 'tailored-application-123',
  });

  await vi.advanceTimersByTimeAsync(24);

  expect(tailoredApplication.getTailoredApplicationPreview).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);

  await expect(previewRequestPromise).resolves.toBeNull();
  await expect(
    registeredHandlers.get(TAILORED_APPLICATION_IPC_CHANNELS.resumePendingGeneration)?.(),
  ).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  });
  await expect(
    registeredHandlers.get(TAILORED_APPLICATION_IPC_CHANNELS.startPendingGeneration)?.(undefined, {
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
  ).resolves.toEqual({
    canResumeGeneration: true,
    failureCode: 'auth_missing',
    message: 'AI needs you to sign in before CV Maxxing can finish your CV and cover letter.',
    provider: 'codex',
    status: 'sign_in_required',
  });
  await expect(
    registeredHandlers.get(TAILORED_APPLICATION_IPC_CHANNELS.completePendingGeneration)?.(
      undefined,
      {
        commandId: 'command-123',
      },
    ),
  ).resolves.toEqual({
    workspaceState: {
      activeApplicationId: null,
      applications: [],
    },
  });
  await expect(
    registeredHandlers.get(TAILORED_APPLICATION_IPC_CHANNELS.abandonPendingGeneration)?.(),
  ).resolves.toBeUndefined();
  await expect(
    registeredHandlers.get(TAILORED_APPLICATION_IPC_CHANNELS.delete)?.(undefined, {
      tailoredApplicationId: 'tailored-application-123',
    }),
  ).resolves.toBeUndefined();
  await expect(
    registeredHandlers.get(TAILORED_APPLICATION_IPC_CHANNELS.exportCoverLetterPdf)?.(undefined, {
      tailoredApplicationId: 'tailored-application-123',
    }),
  ).resolves.toEqual({
    filePath: '/exports/Ada Lovelace - Senior platform engineer - cover-letter.pdf',
    overwriteAvoided: false,
    pageWarning: null,
  });
  expect(tailoredApplication.startPendingGeneration).toHaveBeenCalledWith({
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  });
  expect(tailoredApplication.resumePendingGeneration).toHaveBeenCalledTimes(1);
  expect(tailoredApplication.completePendingGeneration).toHaveBeenCalledWith('command-123');
  expect(tailoredApplication.abandonPendingGeneration).toHaveBeenCalledTimes(1);
  expect(tailoredApplication.deleteTailoredApplication).toHaveBeenCalledWith(
    'tailored-application-123',
  );
  expect(tailoredApplication.exportCoverLetterPdf).toHaveBeenCalledWith('tailored-application-123');
  expect(constructor).toHaveBeenCalledWith({
    backgroundColor: '#08141f',
    height: 900,
    show: true,
    title: 'CV Maxxing',
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/tmp/preload.js',
      sandbox: false,
    },
    width: 1440,
  });
  expect(loadFile).toHaveBeenCalledWith('/tmp/index.html');
  expect(loadURL).not.toHaveBeenCalled();
  expect(eventHandlers.has('activate')).toBe(true);
  expect(eventHandlers.has('window-all-closed')).toBe(true);

  vi.useRealTimers();
});

test('original CV import IPC returns the shared readiness model when the AI worker sign-in has expired', async () => {
  const { app } = createAppDouble();
  const { browserWindow } = createBrowserWindowDouble();
  const registeredHandlers = new Map<
    string,
    (_event?: unknown, payload?: unknown) => Promise<unknown>
  >();
  const handle = vi.fn(
    (channel: string, handler: (_event: unknown, payload?: unknown) => Promise<unknown>) => {
      registeredHandlers.set(channel, handler);
    },
  );
  const aiWorker = {
    getAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      failureCode: 'auth_expired',
      message:
        'The local AI worker sign-in has expired. Sign in again before the workspace can open.',
      provider: 'codex',
      status: 'sign_in_required',
    }),
    getStartupDestination: vi.fn(),
    openAiWorkerSetupGuide: vi.fn(),
    retryAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      failureCode: 'auth_expired',
      message:
        'The local AI worker sign-in has expired. Sign in again before the workspace can open.',
      provider: 'codex',
      status: 'sign_in_required',
    }),
    startAiWorkerSignIn: vi.fn(),
  };
  const onOriginalCvImported = vi.fn();
  const originalCv = {
    getActiveOriginalCvDetail: vi.fn(),
    getWorkspaceState: vi.fn(),
    importOriginalCv: vi.fn(),
  };

  const bootstrap = createDesktopAppBootstrap({
    aiWorker,
    app,
    browserWindow,
    ipcMain: {
      handle,
    },
    onOriginalCvImported,
    originalCv,
    platform: 'darwin',
    preloadPath: '/preload.js',
    rendererIndexPath: '/renderer/index.html',
    settings: createSettingsDouble(),
    tailoredApplication: createTailoredApplicationDouble(),
    vacancy: createVacancyDouble(),
  });

  await bootstrap.start();

  await expect(
    registeredHandlers.get(ORIGINAL_CV_IPC_CHANNELS.importOriginalCv)?.(undefined, {
      content: new Uint8Array([68, 79, 67, 88]),
      filename: 'ada-lovelace-revised.docx',
    }),
  ).resolves.toEqual({
    kind: 'ai_worker_not_ready',
    preflight: {
      canResumeGeneration: true,
      failureCode: 'auth_expired',
      message:
        'The local AI worker sign-in has expired. Sign in again before the workspace can open.',
      provider: 'codex',
      status: 'sign_in_required',
    },
  });

  expect(aiWorker.getAiWorkerPreflight).toHaveBeenCalledTimes(1);
  expect(aiWorker.retryAiWorkerPreflight).not.toHaveBeenCalled();
  expect(originalCv.importOriginalCv).not.toHaveBeenCalled();
  expect(onOriginalCvImported).not.toHaveBeenCalled();
});

test('bootstrap imports the original CV using the startup preflight instead of the retry probe', async () => {
  const handle = vi.fn();
  const registeredHandlers = new Map<string, (...arguments_: unknown[]) => unknown>();

  handle.mockImplementation((channel: string, callback: (...arguments_: unknown[]) => unknown) => {
    registeredHandlers.set(channel, callback);
  });

  const aiWorker = {
    getAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    }),
    getStartupDestination: vi.fn().mockResolvedValue('first_launch'),
    openAiWorkerSetupGuide: vi.fn(),
    retryAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: false,
      failureCode: 'auth_missing',
      message: 'The local AI worker needs a valid sign-in before the workspace can open.',
      provider: 'codex',
      status: 'sign_in_required',
    }),
    startAiWorkerSignIn: vi.fn(),
  };
  const onOriginalCvImported = vi.fn();
  const originalCv = {
    getActiveOriginalCvDetail: vi.fn(),
    getWorkspaceState: vi.fn(),
    importOriginalCv: vi.fn().mockResolvedValue({
      fileType: 'docx',
      headline: 'Staff Product Designer',
      id: 'original-cv-456',
      importedAt: '2026-04-08T15:10:00.000Z',
      originalFilename: 'ada-lovelace-revised.docx',
      pageCount: 1,
      snapshotCount: 2,
      summary: 'Product designer adapting CVs for desktop AI tooling.',
      writingStyle: {
        averageSentenceLength: 8,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    }),
  };

  const bootstrap = createDesktopAppBootstrap({
    aiWorker,
    app: createAppDouble().app,
    browserWindow: createBrowserWindowDouble().browserWindow,
    ipcMain: {
      handle,
    },
    onOriginalCvImported,
    originalCv,
    platform: 'darwin',
    preloadPath: '/preload.js',
    rendererIndexPath: '/renderer/index.html',
    settings: createSettingsDouble(),
    tailoredApplication: createTailoredApplicationDouble(),
    vacancy: createVacancyDouble(),
  });

  await bootstrap.start();

  await expect(
    registeredHandlers.get(ORIGINAL_CV_IPC_CHANNELS.importOriginalCv)?.(undefined, {
      content: new Uint8Array([68, 79, 67, 88]),
      filename: 'ada-lovelace-revised.docx',
    }),
  ).resolves.toEqual({
    kind: 'imported',
    originalCv: {
      fileType: 'docx',
      headline: 'Staff Product Designer',
      id: 'original-cv-456',
      importedAt: '2026-04-08T15:10:00.000Z',
      originalFilename: 'ada-lovelace-revised.docx',
      pageCount: 1,
      snapshotCount: 2,
      summary: 'Product designer adapting CVs for desktop AI tooling.',
      writingStyle: {
        averageSentenceLength: 8,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
  });

  expect(aiWorker.getAiWorkerPreflight).toHaveBeenCalledTimes(1);
  expect(aiWorker.retryAiWorkerPreflight).not.toHaveBeenCalled();
  expect(originalCv.importOriginalCv).toHaveBeenCalledWith({
    content: Buffer.from([68, 79, 67, 88]),
    filename: 'ada-lovelace-revised.docx',
  });
  expect(onOriginalCvImported).toHaveBeenCalledTimes(1);
});

test('bootstrap recreates the window on activate and quits on window-all-closed outside macOS', async () => {
  const { app, eventHandlers } = createAppDouble();
  const browserWindow = createBrowserWindowDouble();
  const tailoredApplication = createTailoredApplicationDouble();
  const vacancy = createVacancyDouble();

  const bootstrap = createDesktopAppBootstrap({
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
      openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
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
    browserWindow: browserWindow.browserWindow,
    ipcMain: {
      handle: vi.fn(),
    },
    onOriginalCvImported: vi.fn().mockImplementation(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    settings: createSettingsDouble(),
    tailoredApplication,
    vacancy,
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: 'http://127.0.0.1:5173',
    rendererIndexPath: '/tmp/index.html',
  });

  await bootstrap.start();

  browserWindow.getAllWindows.mockReturnValueOnce([]);
  eventHandlers.get('activate')?.();

  await Promise.resolve();

  expect(browserWindow.constructor).toHaveBeenCalledTimes(2);
  expect(browserWindow.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173');

  eventHandlers.get('window-all-closed')?.();

  expect(app.quit).toHaveBeenCalledTimes(1);
});

test('bootstrap logs and swallows activate window recreation failures', async () => {
  const { app, eventHandlers } = createAppDouble();
  const browserWindow = createBrowserWindowDouble();
  const tailoredApplication = createTailoredApplicationDouble();
  const vacancy = createVacancyDouble();
  const error = new Error('failed to open window');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => null);

  browserWindow.browserWindow.create = vi
    .fn()
    .mockImplementationOnce(() => {
      return {
        loadFile: vi.fn(() => Promise.resolve()),
        loadURL: vi.fn(() => Promise.resolve()),
      };
    })
    .mockImplementationOnce(() => {
      return {
        loadFile: vi.fn(() => Promise.reject(error)),
        loadURL: vi.fn(() => Promise.resolve()),
      };
    });

  const bootstrap = createDesktopAppBootstrap({
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
      openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
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
    browserWindow: browserWindow.browserWindow,
    ipcMain: {
      handle: vi.fn(),
    },
    onOriginalCvImported: vi.fn().mockImplementation(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    settings: createSettingsDouble(),
    tailoredApplication,
    vacancy,
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  });

  await bootstrap.start();

  browserWindow.getAllWindows.mockReturnValueOnce([]);
  eventHandlers.get('activate')?.();

  await vi.waitFor(() => {
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to recreate the main window on activate.',
      error,
    );
  });
});

test('bootstrap keeps the app open when every window closes on macOS', async () => {
  const { app, eventHandlers } = createAppDouble();
  const browserWindow = createBrowserWindowDouble();
  const tailoredApplication = createTailoredApplicationDouble();
  const vacancy = createVacancyDouble();

  const bootstrap = createDesktopAppBootstrap({
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
      openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
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
    browserWindow: browserWindow.browserWindow,
    ipcMain: {
      handle: vi.fn(),
    },
    onOriginalCvImported: vi.fn().mockImplementation(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    settings: createSettingsDouble(),
    tailoredApplication,
    vacancy,
    platform: 'darwin',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  });

  await bootstrap.start();
  eventHandlers.get('window-all-closed')?.();

  expect(app.quit).not.toHaveBeenCalled();
});

test('bootstrap hides the native macOS title bar chrome when opening the main window', async () => {
  const { app } = createAppDouble();
  const { browserWindow, constructor } = createBrowserWindowDouble();
  const tailoredApplication = createTailoredApplicationDouble();
  const vacancy = createVacancyDouble();

  const bootstrap = createDesktopAppBootstrap({
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('first_launch'),
      openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
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
      handle: vi.fn(),
    },
    onOriginalCvImported: vi.fn().mockImplementation(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    settings: createSettingsDouble(),
    tailoredApplication,
    vacancy,
    platform: 'darwin',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  });

  await bootstrap.start();

  expect(constructor).toHaveBeenCalledWith(
    expect.objectContaining({
      trafficLightPosition: {
        x: 12,
        y: 20,
      },
      titleBarStyle: 'hiddenInset',
      useContentSize: true,
    }),
  );
});

test('bootstrap can keep the desktop window hidden for deterministic visual captures', async () => {
  const { app } = createAppDouble();
  const { browserWindow, constructor } = createBrowserWindowDouble();

  const bootstrap = createDesktopAppBootstrap({
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('first_launch'),
      openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
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
      handle: vi.fn(),
    },
    mainWindowShow: false,
    onOriginalCvImported: vi.fn().mockImplementation(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    settings: createSettingsDouble(),
    tailoredApplication: createTailoredApplicationDouble(),
    vacancy: createVacancyDouble(),
    platform: 'darwin',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  });

  await bootstrap.start();

  expect(constructor).toHaveBeenCalledWith(
    expect.objectContaining({
      show: false,
      useContentSize: true,
    }),
  );
});

test('runtime dependencies adapt Electron primitives for the bootstrap contract', async () => {
  const eventHandlers = new Map<AppEvent, (...args: unknown[]) => void>();
  const quit = vi.fn();
  const whenReady = vi.fn(() => Promise.resolve());
  const on = vi.fn((event: AppEvent, handler: (...args: unknown[]) => void) => {
    eventHandlers.set(event, handler);
  });
  const loadFile = vi.fn(() => Promise.resolve());
  const loadURL = vi.fn(() => Promise.resolve());
  const getAllWindows = vi.fn().mockReturnValue([{ loadFile, loadURL }]);
  const constructor = vi.fn();
  const BrowserWindowDouble = Object.assign(
    function BrowserWindowDouble(options: unknown) {
      constructor(options);

      return {
        loadFile,
        loadURL,
      };
    } as unknown as new (options: unknown) => {
      loadFile: typeof loadFile;
      loadURL: typeof loadURL;
    },
    {
      getAllWindows,
    },
  );
  const aiWorker = {
    getAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    }),
    getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
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
  };
  const tailoredApplication = createTailoredApplicationDouble();
  const vacancy = createVacancyDouble();

  const runtimeDependencies = createElectronRuntimeDependencies({
    aiWorker,
    app: {
      getVersion: vi.fn(() => '1.0.0'),
      on,
      quit,
      setAboutPanelOptions: vi.fn(),
      whenReady,
    },
    browserWindowConstructor: BrowserWindowDouble,
    ipcMain: {
      handle: vi.fn(),
    },
    onOriginalCvImported: vi.fn().mockImplementation(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    settings: createSettingsDouble(),
    tailoredApplication,
    vacancy,
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: 'http://127.0.0.1:5173',
    rendererIndexPath: '/tmp/index.html',
  });

  await runtimeDependencies.app.whenReady();
  runtimeDependencies.app.quit();

  const activateHandler = vi.fn();
  const closeHandler = vi.fn();

  runtimeDependencies.app.on('activate', activateHandler);
  runtimeDependencies.app.on('window-all-closed', closeHandler);

  eventHandlers.get('activate')?.('ignored');
  eventHandlers.get('window-all-closed')?.('ignored');

  runtimeDependencies.browserWindow.create({
    backgroundColor: '#08141f',
    height: 900,
    show: true,
    title: 'CV Maxxing',
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/tmp/preload.js',
      sandbox: false,
    },
    width: 1440,
  });

  expect(whenReady).toHaveBeenCalledTimes(1);
  expect(quit).toHaveBeenCalledTimes(1);
  expect(on).toHaveBeenCalledWith('activate', expect.any(Function));
  expect(on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
  expect(activateHandler).toHaveBeenCalledTimes(1);
  expect(closeHandler).toHaveBeenCalledTimes(1);
  expect(constructor).toHaveBeenCalledTimes(1);
  expect(getAllWindows).not.toHaveBeenCalled();
  expect(runtimeDependencies.browserWindow.getAllWindows()).toEqual([{ loadFile, loadURL }]);
  await expect(runtimeDependencies.aiWorker.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  });
  await expect(runtimeDependencies.aiWorker.getStartupDestination()).resolves.toBe('workspace');
});

test('createElectronRuntimeDependencies exposes a Darwin dock icon setter backed by the app asset', () => {
  const setIcon = vi.fn();
  const loadFile = vi.fn(() => Promise.resolve());
  const loadURL = vi.fn(() => Promise.resolve());
  const getAllWindows = vi.fn().mockReturnValue([{ loadFile, loadURL }]);
  const constructor = vi.fn(() => {
    return {
      loadFile,
      loadURL,
    };
  });

  const runtimeDependencies = createElectronRuntimeDependencies({
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
      openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
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
    app: {
      dock: {
        setIcon,
      },
      getVersion: vi.fn(() => '1.0.0'),
      on: vi.fn(),
      quit: vi.fn(),
      setAboutPanelOptions: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
    },
    browserWindowConstructor: Object.assign(constructor, {
      getAllWindows,
    }),
    ipcMain: {
      handle: vi.fn(),
    },
    onOriginalCvImported: vi.fn().mockImplementation(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    settings: createSettingsDouble(),
    tailoredApplication: createTailoredApplicationDouble(),
    vacancy: createVacancyDouble(),
    platform: 'darwin',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  });

  runtimeDependencies.app.setDockIcon?.();

  expect(setIcon).toHaveBeenCalledWith(appIconPath);
});

test('runtime-backed bootstrap configures native About metadata from the Electron app version', async () => {
  const eventHandlers = new Map<AppEvent, (...args: unknown[]) => void>();
  const getVersion = vi.fn(() => '2.3.4');
  const setAboutPanelOptions = vi.fn();
  const loadFile = vi.fn(() => Promise.resolve());
  const loadURL = vi.fn(() => Promise.resolve());
  const getAllWindows = vi.fn().mockReturnValue([{ loadFile, loadURL }]);
  const constructor = vi.fn();
  const BrowserWindowDouble = Object.assign(
    function BrowserWindowDouble(options: unknown) {
      constructor(options);

      return {
        loadFile,
        loadURL,
      };
    } as unknown as new (options: unknown) => {
      loadFile: typeof loadFile;
      loadURL: typeof loadURL;
    },
    {
      getAllWindows,
    },
  );
  const app = {
    getVersion,
    on: vi.fn((event: AppEvent, handler: (...args: unknown[]) => void) => {
      eventHandlers.set(event, handler);
    }),
    quit: vi.fn(),
    setAboutPanelOptions,
    whenReady: vi.fn(() => Promise.resolve()),
  };
  const runtimeDependencies = createElectronRuntimeDependencies({
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
      openAiWorkerSetupGuide: vi.fn().mockImplementation(() => Promise.resolve()),
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
    browserWindowConstructor: BrowserWindowDouble,
    ipcMain: {
      handle: vi.fn(),
    },
    onOriginalCvImported: vi.fn().mockImplementation(() => Promise.resolve()),
    originalCv: {
      getActiveOriginalCvDetail: vi.fn(),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: null,
        snapshotCount: 0,
      }),
      importOriginalCv: vi.fn(),
    },
    settings: createSettingsDouble(),
    tailoredApplication: createTailoredApplicationDouble(),
    vacancy: createVacancyDouble(),
    platform: 'linux',
    preloadPath: '/tmp/preload.js',
    rendererDevelopmentUrl: undefined,
    rendererIndexPath: '/tmp/index.html',
  });

  const bootstrap = createDesktopAppBootstrap(runtimeDependencies);

  await bootstrap.start();

  expect(getVersion).toHaveBeenCalledTimes(1);
  expect(setAboutPanelOptions).toHaveBeenCalledWith({
    applicationName: 'CV Maxxing',
    applicationVersion: '2.3.4',
  });
});
