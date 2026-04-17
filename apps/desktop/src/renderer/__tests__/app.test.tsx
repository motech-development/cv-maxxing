// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import type { OriginalCvImportInput, OriginalCvImportResult } from '../../shared/original-cv.js'
import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../../shared/settings.js'
import type {
  TailoredApplicationPreview,
  TailoredApplicationWorkspaceState,
} from '../../shared/tailored-application.js'
import type { VacancyIngestResult } from '../../shared/vacancy.js'
import { App } from '../app.js'

afterEach(() => {
  cleanup()
})

function createAiWorkerApi(overrides?: Partial<(typeof globalThis.window.cvMaxxing)['aiWorker']>) {
  return {
    getAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: false,
      message: 'Checking AI before opening the app.',
      provider: 'codex',
      status: 'checking',
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
    ...overrides,
  }
}

function createOriginalCvApi(
  overrides?: Partial<(typeof globalThis.window.cvMaxxing)['originalCv']>,
) {
  return {
    getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
      activeOriginalCv: null,
      snapshotCount: 0,
    }),
    importOriginalCv: vi.fn().mockResolvedValue({
      kind: 'imported',
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
    }),
    ...overrides,
  }
}

function createVacancyApi(overrides?: Partial<(typeof globalThis.window.cvMaxxing)['vacancy']>) {
  return {
    clearVacancyWorkspaceState: vi.fn().mockImplementation(() => Promise.resolve()),
    getVacancyWorkspaceState: vi.fn().mockResolvedValue({
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
        source: 'generic',
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
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead product design for AI-assisted desktop workflows.',
          title: 'Senior Product Designer',
        },
      },
    }),
    ingestVacancyUrl: vi.fn().mockResolvedValue({
      kind: 'ingested',
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-08T21:10:00.000Z',
        id: 'vacancy-002',
        inputType: 'url',
        location: 'London, United Kingdom',
        originalUrl: 'https://boards.greenhouse.io/example/jobs/123',
        requirements: ['Experience shipping workflow software.'],
        resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123',
        responsibilities: ['Lead product design for desktop workflows.'],
        source: 'greenhouse',
        status: 'ready',
        textPreview: 'Lead product design for desktop workflows.',
        title: 'Senior Product Designer',
      },
      workspaceState: {
        draft: {
          text: '',
          url: 'https://boards.greenhouse.io/example/jobs/123',
        },
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-08T21:10:00.000Z',
          id: 'vacancy-002',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://boards.greenhouse.io/example/jobs/123',
          requirements: ['Experience shipping workflow software.'],
          resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123',
          responsibilities: ['Lead product design for desktop workflows.'],
          source: 'greenhouse',
          status: 'ready',
          textPreview: 'Lead product design for desktop workflows.',
          title: 'Senior Product Designer',
        },
      },
    }),
    openVacancyBrowserSession: vi.fn().mockImplementation(() => Promise.resolve()),
    ...overrides,
  }
}

function createTailoredApplicationApi(
  overrides?: Partial<(typeof globalThis.window.cvMaxxing)['tailoredApplication']>,
) {
  return {
    abandonPendingGeneration: vi.fn().mockImplementation(() => Promise.resolve()),
    completePendingGeneration: vi.fn().mockResolvedValue({
      workspaceState: createTailoredApplicationWorkspaceStateFixture(),
    }),
    deleteTailoredApplication: vi.fn().mockImplementation(() => Promise.resolve()),
    getPendingGenerationCommand: vi.fn().mockResolvedValue(null),
    getTailoredApplicationPreview: vi.fn().mockResolvedValue(null),
    getWorkspaceState: vi.fn().mockResolvedValue(createTailoredApplicationWorkspaceStateFixture()),
    exportAdaptedCvPdf: vi.fn().mockResolvedValue({
      filePath: '/exports/Ada Lovelace - Senior platform engineer - adapted-cv (2).pdf',
      overwriteAvoided: true,
      pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
    }),
    exportCoverLetterPdf: vi.fn().mockResolvedValue({
      filePath: '/exports/Ada Lovelace - Senior platform engineer - cover-letter (2).pdf',
      overwriteAvoided: true,
      pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
    }),
    resumePendingGeneration: vi.fn().mockResolvedValue({
      generationRunId: 'run-123',
      tailoredApplicationId: 'tailored-application-123',
    }),
    setWorkspaceSelection: vi.fn().mockImplementation(() => Promise.resolve()),
    startPendingGeneration: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    }),
    ...overrides,
  }
}

function createSettingsApi(overrides?: Partial<(typeof globalThis.window.cvMaxxing)['settings']>) {
  return {
    clearJobSiteBrowserData: vi.fn().mockImplementation(() => Promise.resolve()),
    getSettingsSnapshot: vi.fn().mockResolvedValue({
      appVersion: '1.0.0',
      privacy: {
        analytics: false,
        automaticUpdateChecks: false,
        crashReporting: false,
        remoteConfig: false,
        runtimeFontCdnCalls: false,
        telemetry: false,
      },
      workerCommand: 'codex',
    }),
    resetLocalAppData: vi.fn().mockImplementation(() => Promise.resolve()),
    ...overrides,
  }
}

function renderApp({
  aiWorker = createAiWorkerApi(),
  originalCv = createOriginalCvApi(),
  settings = createSettingsApi(),
  tailoredApplication = createTailoredApplicationApi(),
  vacancy = createVacancyApi(),
}: Partial<typeof globalThis.window.cvMaxxing> = {}) {
  globalThis.window.cvMaxxing = {
    aiWorker,
    originalCv,
    settings,
    tailoredApplication,
    vacancy,
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

async function waitForVacancyDraftValues({
  text,
  url,
}: {
  text: string
  url: string
}): Promise<void> {
  await waitFor(() => {
    expect(screen.getByLabelText('Job link')).toHaveProperty('value', url)
    expect(screen.getByLabelText('Job description')).toHaveProperty('value', text)
  })
}

function getReviewButtons() {
  const [reviewUrlButton, reviewTextButton] = screen.getAllByRole('button', {
    name: 'Check job details',
  })

  if (reviewUrlButton === undefined || reviewTextButton === undefined) {
    throw new Error('Expected job-link and pasted-description review buttons.')
  }

  return {
    reviewTextButton,
    reviewUrlButton,
  }
}

function createDeferredPromise<T>() {
  let resolvePromise!: (value: T) => void

  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: resolvePromise,
  }
}

function createTailoredApplicationPreviewFixture(
  overrides: Partial<TailoredApplicationPreview> = {},
): TailoredApplicationPreview {
  return {
    adaptedCv: {
      pageCount: 4,
      pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    adaptationSummary: {
      emphasized: [
        {
          text: 'Emphasises desktop workflow leadership for the job vacancy.',
        },
      ],
      gaps: ['Add stronger quantified delivery evidence from the original CV snapshot.'],
      omitted: [
        {
          text: 'Compresses broader communication language so the adapted CV stays vacancy-specific.',
        },
      ],
      validationHints: ['Validate performance claims against the original CV snapshot.'],
    },
    coverLetter: {
      pageCount: 2,
      pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
      pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      plainText: 'Dear Hiring Manager,\n\nAda Lovelace',
    },
    createdAt: '2026-04-09T09:30:00.000Z',
    employer: 'Example Labs',
    id: 'tailored-application-123',
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
    title: 'Senior platform engineer',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-09T08:30:00.000Z',
      id: 'vacancy-123',
      inputType: 'url',
      location: 'London, United Kingdom',
      originalUrl: 'https://jobs.example.com/roles/123',
      requirements: ['Experience shipping workflow software.'],
      resolvedUrl: 'https://jobs.example.com/roles/123',
      responsibilities: ['Lead desktop workflow delivery across product and engineering.'],
      source: 'generic',
      status: 'ready',
      textPreview: 'Lead desktop workflow delivery across product and engineering.',
      title: 'Senior platform engineer',
    },
    vacancyTitle: 'Senior platform engineer',
    ...overrides,
  }
}

function createTailoredApplicationWorkspaceStateFixture(
  overrides: Partial<TailoredApplicationWorkspaceState> = {},
): TailoredApplicationWorkspaceState {
  return {
    activeApplicationId: null,
    applications: [],
    ...overrides,
  }
}

test('renders the dedicated checking setup screen before workspace entry', async () => {
  renderApp()

  expect(screen.getByRole('heading', { name: 'Getting AI ready' })).toBeDefined()
  expect(screen.getAllByText('Connect AI')).toHaveLength(2)
  expect(screen.getByText('Checking')).toBeDefined()
  expect(screen.queryByText(/worker/i)).toBeNull()

  await waitFor(() => {
    expect(globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight).toHaveBeenCalledTimes(1)
  })
})

test('renders the dedicated sign-in-required setup screen', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: false,
        failureCode: 'auth_missing',
        message: 'AI needs you to sign in before CV Maxxing can continue.',
        provider: 'codex',
        status: 'sign_in_required',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined()
  })

  expect(screen.getByText('Sign in needed')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Get help' })).toBeDefined()
})

test('opens the setup guide from the repair flow', async () => {
  const openAiWorkerSetupGuide = vi.fn().mockImplementation(() => Promise.resolve())

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: false,
        failureCode: 'runtime_missing',
        message: "AI isn't available on this Mac yet. Check the setup, then try again.",
        provider: 'codex',
        status: 'unavailable',
      }),
      openAiWorkerSetupGuide,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Get help' }))

  await waitFor(() => {
    expect(openAiWorkerSetupGuide).toHaveBeenCalledTimes(1)
  })
})

test('renders the dedicated unavailable setup screen', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: false,
        failureCode: 'runtime_missing',
        message: "AI isn't available on this Mac yet. Check the setup, then try again.",
        provider: 'codex',
        status: 'unavailable',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })

  expect(screen.getByText('Needs attention')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
})

test('renders the first-launch screen after readiness succeeds with no original CV', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()
  })

  expect(screen.getByRole('button', { name: 'Add your CV' })).toBeDefined()
  expect(screen.getByText('Drop a PDF or DOCX here or choose a file')).toBeDefined()
})

test('accepts an original CV dropped onto the first-launch import surface', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()
  })

  fireEvent.drop(screen.getByText('Drop a PDF or DOCX here or choose a file'), {
    dataTransfer: {
      files: [new File(['resume'], 'ada-lovelace.docx')],
    },
  })

  expect(screen.getByText('Selected: ada-lovelace.docx')).toBeDefined()
})

test('imports the first original CV and transitions into the design-aligned workspace-empty screen', async () => {
  const retryAiWorkerPreflight = vi.fn()
  const importedOriginalCv = {
    fileType: 'pdf' as const,
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
      firstPersonUsage: 'absent' as const,
      formality: 'direct' as const,
    },
  }
  const importOriginalCv = vi.fn().mockResolvedValue({
    kind: 'imported',
    originalCv: importedOriginalCv,
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      retryAiWorkerPreflight,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
          activeOriginalCv: null,
          snapshotCount: 0,
        })
        .mockResolvedValueOnce({
          activeOriginalCv: importedOriginalCv,
          snapshotCount: 1,
        }),
      importOriginalCv,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Your CV file'), {
    target: {
      files: [new File(['%PDF-1.7'], 'ada-lovelace.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add your CV' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(retryAiWorkerPreflight).not.toHaveBeenCalled()
  expect(importOriginalCv).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Jobs')).toBeDefined()
  const emptyVacancyHeading = screen.getByRole('heading', { name: 'No jobs yet' })
  const newVacancyButton = screen.getByRole('button', { name: 'Add a job' })

  expect(emptyVacancyHeading).toBeDefined()
  expect(newVacancyButton).toBeDefined()
  expect(newVacancyButton.compareDocumentPosition(emptyVacancyHeading)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(screen.getByLabelText('Job link')).toBeDefined()
  expect(screen.getByLabelText('Job description')).toBeDefined()
  expect(screen.getAllByRole('button', { name: 'Check job details' })).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Update your CV' })).toBeDefined()
  expect(screen.getByText('Check this job before tailoring your CV')).toBeDefined()
})

test('shows the workspace overlay while importing the first original CV from first launch', async () => {
  const importOriginalCvDeferredPromise = createDeferredPromise<OriginalCvImportResult>()

  const importOriginalCv = vi.fn(
    (input: OriginalCvImportInput): Promise<OriginalCvImportResult> => {
      void input

      return importOriginalCvDeferredPromise.promise
    },
  )

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    }),
    originalCv: createOriginalCvApi({
      importOriginalCv,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Your CV file'), {
    target: {
      files: [new File(['%PDF-1.7'], 'ada-lovelace.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add your CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
  })

  expect(screen.getByRole('status', { name: 'Adding your CV...' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()

  importOriginalCvDeferredPromise.resolve({
    kind: 'imported',
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
  })

  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Adding your CV...' })).toBeNull()
  })
})

test('imports the first original CV from the mutation payload while the workspace refetch is still pending', async () => {
  const importedOriginalCv = {
    fileType: 'pdf' as const,
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
      firstPersonUsage: 'absent' as const,
      formality: 'direct' as const,
    },
  }
  const getOriginalCvWorkspaceState = vi
    .fn()
    .mockResolvedValueOnce({
      activeOriginalCv: null,
      snapshotCount: 0,
    })
    .mockImplementationOnce(() => {
      return new Promise(() => {
        return
      })
    })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState,
      importOriginalCv: vi.fn().mockResolvedValue({
        kind: 'imported',
        originalCv: importedOriginalCv,
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Your CV file'), {
    target: {
      files: [new File(['%PDF-1.7'], 'ada-lovelace.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add your CV' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByText('ada-lovelace.pdf')).toBeDefined()
  expect(screen.queryByRole('heading', { name: 'Add your CV' })).toBeNull()
})

test('routes first-launch import into the AI worker sign-in flow when the import boundary reports sign-in required', async () => {
  const retryAiWorkerPreflight = vi.fn()
  const importOriginalCv = vi.fn().mockResolvedValue({
    kind: 'ai_worker_not_ready',
    preflight: {
      canResumeGeneration: false,
      failureCode: 'auth_missing',
      message: 'The local AI worker needs a valid sign-in before the workspace can open.',
      provider: 'codex',
      status: 'sign_in_required',
    },
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      retryAiWorkerPreflight,
    }),
    originalCv: createOriginalCvApi({
      importOriginalCv,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Your CV file'), {
    target: {
      files: [new File(['%PDF-1.7'], 'ada-lovelace.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add your CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
  })

  expect(retryAiWorkerPreflight).not.toHaveBeenCalled()

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined()
  })
})

test('renders the design-aligned workspace-empty screen when an original CV already exists', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByText('Your CV')).toBeDefined()
  expect(screen.getByText('ada-lovelace.pdf')).toBeDefined()
  expect(screen.getByLabelText('Job link')).toBeDefined()
  expect(screen.getByLabelText('Job description')).toBeDefined()
  expect(screen.queryByText('Original CV active')).toBeNull()
  expect(screen.getByText('Check this job before tailoring your CV')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Update your CV' })).toBeDefined()
})

test('loads a persisted vacancy preview and keeps Tailor your CV enabled for a reviewable draft', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi.fn().mockResolvedValue({
        draft: {
          text: 'Senior Product Designer\nExample Labs\nLondon, United Kingdom',
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
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead product design for AI-assisted desktop workflows.',
          title: 'Senior Product Designer',
        },
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  await waitFor(() => {
    expect(screen.getByText(/Job (details|preview)/)).toBeDefined()
    expect(screen.getByText('Senior Product Designer')).toBeDefined()
    expect(screen.getByText('Example Labs · London, United Kingdom')).toBeDefined()
    expect(screen.getByText('About the job')).toBeDefined()
    expect(screen.getByText("What you'll be doing")).toBeDefined()
    expect(screen.getByText("What they're looking for")).toBeDefined()
    expect(screen.getByRole('button', { name: 'Tailor your CV' })).toHaveProperty('disabled', false)
  })
})

test('shows generic open-job-page fallback guidance for reviewed links that need more access', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi.fn().mockResolvedValue({
        draft: {
          text: '',
          url: 'https://www.linkedin.com/jobs/view/123456',
        },
        vacancy: {
          blockingReason:
            'This job page may need more access. Open the job page or paste the job description instead.',
          canGenerate: false,
          employer: null,
          fetchedAt: '2026-04-08T21:15:00.000Z',
          id: 'vacancy-pending-browser',
          inputType: 'url',
          location: null,
          originalUrl: 'https://www.linkedin.com/jobs/view/123456',
          requirements: [],
          resolvedUrl: null,
          responsibilities: [],
          source: 'linkedin',
          status: 'incomplete',
          textPreview: '',
          title: null,
        },
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(
    screen.getByText(
      'This job page may need more access. Open the job page or paste the job description instead.',
    ),
  ).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open the job page' })).toBeDefined()
  expect(screen.queryByText(/internal browser session/i)).toBeNull()
})

test('shows shell-level ambient activity while a tailored-application preview refreshes in the background', async () => {
  const deferredPreview = createDeferredPromise<TailoredApplicationPreview | null>()
  const firstPreview = createTailoredApplicationPreviewFixture()
  const secondPreview = createTailoredApplicationPreviewFixture({
    employer: 'Nebula Labs',
    id: 'tailored-application-456',
    title: 'Platform Product Manager',
    vacancy: {
      ...firstPreview.vacancy,
      employer: 'Nebula Labs',
      id: 'vacancy-456',
      title: 'Platform Product Manager',
    },
    vacancyTitle: 'Platform Product Manager',
  })
  const getTailoredApplicationPreview = vi
    .fn()
    .mockResolvedValueOnce(firstPreview)
    .mockImplementationOnce(() => deferredPreview.promise)

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
        activeOriginalCv: firstPreview.originalCv,
        snapshotCount: 1,
      }),
    }),
    tailoredApplication: createTailoredApplicationApi({
      getTailoredApplicationPreview,
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeApplicationId: 'tailored-application-123',
        applications: [
          {
            createdAt: '2026-04-09T09:30:00.000Z',
            employer: 'Example Labs',
            id: 'tailored-application-123',
            pageCount: 4,
            pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
            title: 'Senior platform engineer',
            vacancyTitle: 'Senior platform engineer',
          },
          {
            createdAt: '2026-04-10T09:30:00.000Z',
            employer: 'Nebula Labs',
            id: 'tailored-application-456',
            pageCount: 3,
            pageWarning: null,
            title: 'Platform Product Manager',
            vacancyTitle: 'Platform Product Manager',
          },
        ],
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open platform product manager' }))

  await waitFor(() => {
    expect(getTailoredApplicationPreview).toHaveBeenLastCalledWith('tailored-application-456')
  })

  expect(screen.getByRole('status', { name: 'Background activity' })).toBeDefined()
  expect(screen.queryByText('Ready')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'AI' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Background activity' })).toBeDefined()
  expect(within(screen.getByRole('banner')).queryByText('Local')).toBeNull()

  deferredPreview.resolve(secondPreview)

  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Background activity' })).toBeNull()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Jobs' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Platform Product Manager' })).toBeDefined()
  })
})

test('replaces the active original CV from the workspace-empty screen and keeps the workspace open', async () => {
  const revisedOriginalCv = {
    fileType: 'docx' as const,
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
      firstPersonUsage: 'absent' as const,
      formality: 'direct' as const,
    },
  }
  const importOriginalCv = vi.fn(
    (input: OriginalCvImportInput): Promise<OriginalCvImportResult> => {
      void input

      return Promise.resolve({
        kind: 'imported',
        originalCv: revisedOriginalCv,
      })
    },
  )

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
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
        })
        .mockResolvedValueOnce({
          activeOriginalCv: revisedOriginalCv,
          snapshotCount: 2,
        }),
      importOriginalCv,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement CV file'), {
    target: {
      files: [
        new File(['DOCX'], 'ada-lovelace-revised.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Update your CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
  })

  expect(importOriginalCv.mock.calls[0]?.[0].filename).toBe('ada-lovelace-revised.docx')
  expect(importOriginalCv.mock.calls[0]?.[0].content).toBeInstanceOf(Uint8Array)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByText('ada-lovelace-revised.docx')).toBeDefined()
  expect(screen.queryByRole('heading', { name: 'Add your CV' })).toBeNull()
})

test('shows the replacement snapshot count from the mutation payload while the workspace refetch is pending', async () => {
  const revisedOriginalCv = {
    fileType: 'docx' as const,
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
      firstPersonUsage: 'absent' as const,
      formality: 'direct' as const,
    },
  }

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
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
        })
        .mockImplementationOnce(() => {
          return new Promise(() => {
            return
          })
        }),
      importOriginalCv: vi.fn().mockResolvedValue({
        kind: 'imported',
        originalCv: revisedOriginalCv,
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement CV file'), {
    target: {
      files: [
        new File(['DOCX'], 'ada-lovelace-revised.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Update your CV' }))

  await waitFor(() => {
    expect(screen.getByText('ada-lovelace-revised.docx')).toBeDefined()
  })

  expect(screen.getByText('2 versions')).toBeDefined()
})

test('refreshes the original CV workspace query after replacement instead of trusting the mutation payload', async () => {
  const getOriginalCvWorkspaceState = vi
    .fn()
    .mockResolvedValueOnce({
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
    })
    .mockResolvedValueOnce({
      activeOriginalCv: {
        fileType: 'docx',
        headline: 'Query-backed Staff Product Designer',
        id: 'original-cv-query',
        importedAt: '2026-04-08T15:10:00.000Z',
        originalFilename: 'ada-lovelace-query.docx',
        pageCount: 1,
        snapshotCount: 2,
        summary: 'Loaded from the refetched original CV workspace query.',
        writingStyle: {
          averageSentenceLength: 8,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'direct',
        },
      },
      snapshotCount: 2,
    })
  const importOriginalCv = vi.fn(
    (input: OriginalCvImportInput): Promise<OriginalCvImportResult> => {
      void input

      return Promise.resolve({
        kind: 'imported',
        originalCv: {
          fileType: 'docx',
          headline: 'Mutation payload Staff Product Designer',
          id: 'original-cv-mutation',
          importedAt: '2026-04-08T15:10:00.000Z',
          originalFilename: 'ada-lovelace-mutation.docx',
          pageCount: 1,
          snapshotCount: 2,
          summary: 'This value should be replaced by the refetched workspace query.',
          writingStyle: {
            averageSentenceLength: 8,
            clicheDetections: [],
            firstPersonUsage: 'absent',
            formality: 'direct',
          },
        },
      })
    },
  )

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState,
      importOriginalCv,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement CV file'), {
    target: {
      files: [
        new File(['DOCX'], 'ada-lovelace-revised.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Update your CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
    expect(getOriginalCvWorkspaceState).toHaveBeenCalledTimes(2)
  })

  await waitFor(() => {
    expect(screen.getByText('ada-lovelace-query.docx')).toBeDefined()
  })

  expect(screen.queryByText('ada-lovelace-mutation.docx')).toBeNull()
})

test('replaces the active original CV from the workspace-active screen and keeps the tailored application open', async () => {
  const revisedOriginalCv = {
    fileType: 'docx' as const,
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
      firstPersonUsage: 'absent' as const,
      formality: 'direct' as const,
    },
  }
  const importOriginalCv = vi.fn(
    (input: OriginalCvImportInput): Promise<OriginalCvImportResult> => {
      void input

      return Promise.resolve({
        kind: 'imported',
        originalCv: revisedOriginalCv,
      })
    },
  )

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
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
        })
        .mockResolvedValueOnce({
          activeOriginalCv: revisedOriginalCv,
          snapshotCount: 2,
        }),
      importOriginalCv,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement CV file'), {
    target: {
      files: [
        new File(['DOCX'], 'ada-lovelace-revised.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Update your CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
  })

  expect(importOriginalCv.mock.calls[0]?.[0].filename).toBe('ada-lovelace-revised.docx')
  expect(importOriginalCv.mock.calls[0]?.[0].content).toBeInstanceOf(Uint8Array)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByText('ada-lovelace-revised.docx')).toBeDefined()
})

test('shows the workspace overlay while replacing the active original CV from the workspace-active screen', async () => {
  const importOriginalCvDeferredPromise = createDeferredPromise<OriginalCvImportResult>()

  const importOriginalCv = vi.fn(
    (input: OriginalCvImportInput): Promise<OriginalCvImportResult> => {
      void input

      return importOriginalCvDeferredPromise.promise
    },
  )

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
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
        })
        .mockResolvedValueOnce({
          activeOriginalCv: {
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
          snapshotCount: 2,
        }),
      importOriginalCv,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement CV file'), {
    target: {
      files: [
        new File(['DOCX'], 'ada-lovelace-revised.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Update your CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
  })

  expect(screen.getByRole('status', { name: 'Updating your CV...' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()

  importOriginalCvDeferredPromise.resolve({
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
  })

  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Updating your CV...' })).toBeNull()
  })
})

test('keeps the existing active original CV visible when a workspace replacement is rejected', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
        error: {
          code: 'unreadable_extraction',
          message: "We couldn't read enough from this CV. Use a text-based PDF or DOCX.",
        },
        kind: 'rejected',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement CV file'), {
    target: {
      files: [new File(['broken'], 'broken.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Update your CV' }))

  await waitFor(() => {
    expect(
      screen.getByText("We couldn't read enough from this CV. Use a text-based PDF or DOCX."),
    ).toBeDefined()
  })

  expect(screen.getByText('ada-lovelace.pdf')).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
})

test('routes original CV replacement into the AI worker repair flow when the import boundary reports the worker unavailable', async () => {
  const retryAiWorkerPreflight = vi.fn()
  const importOriginalCv = vi.fn().mockResolvedValue({
    kind: 'ai_worker_not_ready',
    preflight: {
      canResumeGeneration: false,
      failureCode: 'runtime_missing',
      message: "AI isn't available on this Mac yet. Check the setup, then try again.",
      provider: 'codex',
      status: 'unavailable',
    },
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
      retryAiWorkerPreflight,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
      importOriginalCv,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement CV file'), {
    target: {
      files: [new File(['broken'], 'broken.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Update your CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
  })

  expect(retryAiWorkerPreflight).not.toHaveBeenCalled()

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })
})

test('shows the normalization failure message while keeping the existing active original CV visible', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
        error: {
          code: 'weak_normalization',
          message: "We couldn't make sense of this CV. Try a clearer PDF or DOCX.",
        },
        kind: 'rejected',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement CV file'), {
    target: {
      files: [new File(['weak'], 'weak.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Update your CV' }))

  await waitFor(() => {
    expect(
      screen.getByText("We couldn't make sense of this CV. Try a clearer PDF or DOCX."),
    ).toBeDefined()
  })

  expect(screen.getByText('ada-lovelace.pdf')).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
})

test('reviews a ready vacancy URL and only starts tailoring after Tailor your CV is clicked', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace')
    .mockResolvedValueOnce('workspace')
  const getPendingGenerationCommand = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValue({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: '',
        url: 'https://boards.greenhouse.io/example/jobs/123',
      },
    })
  const resumePendingGeneration = vi.fn().mockImplementation(() => {
    return new Promise<never>((resolve) => {
      void resolve
    })
  })
  const startPendingGeneration = vi.fn().mockResolvedValue({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
          draft: {
            text: '',
            url: '',
          },
          vacancy: null,
        })
        .mockResolvedValueOnce({
          draft: {
            text: '',
            url: 'https://boards.greenhouse.io/example/jobs/123',
          },
          vacancy: {
            blockingReason: null,
            canGenerate: true,
            employer: 'Example Labs',
            fetchedAt: '2026-04-08T21:10:00.000Z',
            id: 'vacancy-002',
            inputType: 'url',
            location: 'London, United Kingdom',
            originalUrl: 'https://boards.greenhouse.io/example/jobs/123',
            requirements: ['Experience shipping workflow software.'],
            resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123',
            responsibilities: ['Lead product design for desktop workflows.'],
            source: 'greenhouse',
            status: 'ready',
            textPreview: 'Lead product design for desktop workflows.',
            title: 'Senior Product Designer',
          },
        }),
    }),
    tailoredApplication: createTailoredApplicationApi({
      getPendingGenerationCommand,
      resumePendingGeneration,
      startPendingGeneration,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitForVacancyDraftValues({
    text: '',
    url: '',
  })

  fireEvent.change(screen.getByLabelText('Job link'), {
    target: {
      value: 'https://jobs.example.com/roles/123',
    },
  })
  const { reviewUrlButton } = getReviewButtons()

  fireEvent.click(reviewUrlButton)

  await waitFor(() => {
    expect(globalThis.window.cvMaxxing.vacancy.ingestVacancyUrl).toHaveBeenCalledWith({
      url: 'https://jobs.example.com/roles/123',
    })
  })

  await waitFor(() => {
    expect(screen.getByText(/Job (details|preview)/)).toBeDefined()
  })

  expect(screen.getByRole('button', { name: 'Tailor your CV' })).toHaveProperty('disabled', false)

  fireEvent.click(screen.getByRole('button', { name: 'Tailor your CV' }))

  await waitFor(() => {
    expect(startPendingGeneration).toHaveBeenCalledWith({
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyDraft: {
        text: '',
        url: 'https://boards.greenhouse.io/example/jobs/123',
      },
    })
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Open tailored application' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()

  await waitFor(() => {
    expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
  })
})

test('shows the workspace overlay while reviewing a vacancy URL without surfacing generation-only actions', async () => {
  const ingestVacancyUrlDeferredPromise = createDeferredPromise<VacancyIngestResult>()
  const ingestVacancyUrl = vi.fn(() => {
    return ingestVacancyUrlDeferredPromise.promise
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      ingestVacancyUrl,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitForVacancyDraftValues({
    text: '',
    url: '',
  })

  fireEvent.change(screen.getByLabelText('Job link'), {
    target: {
      value: 'https://boards.greenhouse.io/example/jobs/123',
    },
  })
  const { reviewUrlButton } = getReviewButtons()

  fireEvent.click(reviewUrlButton)

  await waitFor(() => {
    expect(ingestVacancyUrl).toHaveBeenCalledWith({
      url: 'https://boards.greenhouse.io/example/jobs/123',
    })
  })

  expect(screen.getByRole('status', { name: 'Checking job details...' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()

  ingestVacancyUrlDeferredPromise.resolve({
    kind: 'ingested',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-08T21:10:00.000Z',
      id: 'vacancy-002',
      inputType: 'url',
      location: 'London, United Kingdom',
      originalUrl: 'https://boards.greenhouse.io/example/jobs/123',
      requirements: ['Experience shipping workflow software.'],
      resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123',
      responsibilities: ['Lead product design for desktop workflows.'],
      source: 'greenhouse',
      status: 'ready',
      textPreview: 'Lead product design for desktop workflows.',
      title: 'Senior Product Designer',
    },
    workspaceState: {
      draft: {
        text: '',
        url: 'https://boards.greenhouse.io/example/jobs/123',
      },
      reviewState: 'reviewed',
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-08T21:10:00.000Z',
        id: 'vacancy-002',
        inputType: 'url',
        location: 'London, United Kingdom',
        originalUrl: 'https://boards.greenhouse.io/example/jobs/123',
        requirements: ['Experience shipping workflow software.'],
        resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123',
        responsibilities: ['Lead product design for desktop workflows.'],
        source: 'greenhouse',
        status: 'ready',
        textPreview: 'Lead product design for desktop workflows.',
        title: 'Senior Product Designer',
      },
    },
  })

  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Checking job details...' })).toBeNull()
  })
})

test('routes to AI worker repair when starting adaptation returns a sign-in requirement', async () => {
  const startPendingGeneration = vi.fn().mockResolvedValue({
    canResumeGeneration: true,
    failureCode: 'auth_missing',
    message:
      'The local AI worker needs a valid sign-in before CV Maxxing can resume your tailored application.',
    provider: 'codex',
    status: 'sign_in_required',
  })
  const resumePendingGeneration = vi.fn().mockResolvedValue({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })
  const getPendingGenerationCommand = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValue({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-002',
      vacancyDraft: {
        text: '',
        url: 'https://boards.greenhouse.io/example/jobs/123',
      },
    })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      getPendingGenerationCommand,
      resumePendingGeneration,
      startPendingGeneration,
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi.fn().mockResolvedValue({
        draft: {
          text: '',
          url: 'https://boards.greenhouse.io/example/jobs/123',
        },
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-08T21:10:00.000Z',
          id: 'vacancy-002',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://boards.greenhouse.io/example/jobs/123',
          requirements: ['Experience shipping workflow software.'],
          resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123',
          responsibilities: ['Lead product design for desktop workflows.'],
          source: 'greenhouse',
          status: 'ready',
          textPreview: 'Lead product design for desktop workflows.',
          title: 'Senior Product Designer',
        },
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Tailor your CV' })).toHaveProperty('disabled', false)
  })

  fireEvent.click(screen.getByRole('button', { name: 'Tailor your CV' }))

  await waitFor(() => {
    expect(startPendingGeneration).toHaveBeenCalledTimes(1)
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined()
  })

  expect(resumePendingGeneration).not.toHaveBeenCalled()
})

test('preserves pasted vacancy context in a blocking preview and keeps Tailor your CV disabled', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
          draft: {
            text: '',
            url: '',
          },
          vacancy: null,
        })
        .mockResolvedValueOnce({
          draft: {
            text: 'Short pasted vacancy draft.',
            url: 'https://jobs.example.com/senior-product-designer',
          },
          vacancy: {
            blockingReason:
              'Add the full job responsibilities or requirements before tailoring your CV.',
            canGenerate: false,
            employer: 'Example Labs',
            fetchedAt: '2026-04-08T21:00:00.000Z',
            id: 'vacancy-001',
            inputType: 'pasted_text',
            location: 'London, United Kingdom',
            originalUrl: 'https://jobs.example.com/senior-product-designer',
            requirements: [],
            resolvedUrl: 'https://jobs.example.com/senior-product-designer',
            responsibilities: [],
            source: 'generic',
            status: 'incomplete',
            textPreview: 'Short pasted vacancy draft.',
            title: 'Senior Product Designer',
          },
        }),
      ingestPastedVacancy: vi.fn().mockResolvedValue({
        kind: 'incomplete',
        vacancy: {
          blockingReason:
            'Add the full job responsibilities or requirements before tailoring your CV.',
          canGenerate: false,
          employer: 'Example Labs',
          fetchedAt: '2026-04-08T21:00:00.000Z',
          id: 'vacancy-001',
          inputType: 'pasted_text',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/senior-product-designer',
          requirements: [],
          resolvedUrl: 'https://jobs.example.com/senior-product-designer',
          responsibilities: [],
          source: 'generic',
          status: 'incomplete',
          textPreview: 'Short pasted vacancy draft.',
          title: 'Senior Product Designer',
        },
        workspaceState: {
          draft: {
            text: 'Short pasted vacancy draft.',
            url: 'https://jobs.example.com/senior-product-designer',
          },
          vacancy: {
            blockingReason:
              'Add the full job responsibilities or requirements before tailoring your CV.',
            canGenerate: false,
            employer: 'Example Labs',
            fetchedAt: '2026-04-08T21:00:00.000Z',
            id: 'vacancy-001',
            inputType: 'pasted_text',
            location: 'London, United Kingdom',
            originalUrl: 'https://jobs.example.com/senior-product-designer',
            requirements: [],
            resolvedUrl: 'https://jobs.example.com/senior-product-designer',
            responsibilities: [],
            source: 'generic',
            status: 'incomplete',
            textPreview: 'Short pasted vacancy draft.',
            title: 'Senior Product Designer',
          },
        },
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitForVacancyDraftValues({
    text: '',
    url: '',
  })

  fireEvent.change(screen.getByLabelText('Job link'), {
    target: {
      value: 'https://jobs.example.com/senior-product-designer',
    },
  })
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: {
      value: 'Short pasted vacancy draft.',
    },
  })
  const { reviewTextButton: initialReviewTextButton } = getReviewButtons()

  fireEvent.click(initialReviewTextButton)

  await waitFor(() => {
    expect(globalThis.window.cvMaxxing.vacancy.ingestPastedVacancy).toHaveBeenCalledWith({
      text: 'Short pasted vacancy draft.',
      url: 'https://jobs.example.com/senior-product-designer',
    })
  })

  expect(screen.getByText(/Job (details|preview)/)).toBeDefined()
  expect(
    screen.getByText('Add the full job responsibilities or requirements before tailoring your CV.'),
  ).toBeDefined()
  expect(screen.getByLabelText('Job link')).toHaveProperty(
    'value',
    'https://jobs.example.com/senior-product-designer',
  )
  expect(screen.getByLabelText('Job description')).toHaveProperty(
    'value',
    'Short pasted vacancy draft.',
  )
  expect(screen.getByRole('button', { name: 'Tailor your CV' })).toHaveProperty('disabled', true)
})

test('refreshes the vacancy workspace query after review instead of rendering the mutation payload', async () => {
  const getVacancyWorkspaceState = vi
    .fn()
    .mockResolvedValueOnce({
      draft: {
        text: '',
        url: '',
      },
      vacancy: null,
    })
    .mockResolvedValueOnce({
      draft: {
        text: 'Query-backed reviewed vacancy draft.',
        url: 'https://jobs.example.com/query-reviewed-role',
      },
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Query Labs',
        fetchedAt: '2026-04-08T21:00:00.000Z',
        id: 'vacancy-query',
        inputType: 'pasted_text',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/query-reviewed-role',
        requirements: ['Experience shipping workflow software.'],
        resolvedUrl: 'https://jobs.example.com/query-reviewed-role',
        responsibilities: ['Lead product design for query-driven renderer state.'],
        source: 'generic',
        status: 'ready',
        textPreview: 'Lead product design for query-driven renderer state.',
        title: 'Query-backed Senior Product Designer',
      },
    })
  const ingestPastedVacancy = vi.fn().mockResolvedValue({
    kind: 'ingested',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Mutation Labs',
      fetchedAt: '2026-04-08T21:00:00.000Z',
      id: 'vacancy-mutation',
      inputType: 'pasted_text',
      location: 'London, United Kingdom',
      originalUrl: 'https://jobs.example.com/mutation-reviewed-role',
      requirements: ['Strong written communication.'],
      resolvedUrl: 'https://jobs.example.com/mutation-reviewed-role',
      responsibilities: ['Lead product design for mutation payload renderer state.'],
      source: 'generic',
      status: 'ready',
      textPreview: 'Lead product design for mutation payload renderer state.',
      title: 'Mutation payload Senior Product Designer',
    },
    workspaceState: {
      draft: {
        text: 'Mutation payload reviewed vacancy draft.',
        url: 'https://jobs.example.com/mutation-reviewed-role',
      },
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Mutation Labs',
        fetchedAt: '2026-04-08T21:00:00.000Z',
        id: 'vacancy-mutation',
        inputType: 'pasted_text',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/mutation-reviewed-role',
        requirements: ['Strong written communication.'],
        resolvedUrl: 'https://jobs.example.com/mutation-reviewed-role',
        responsibilities: ['Lead product design for mutation payload renderer state.'],
        source: 'generic',
        status: 'ready',
        textPreview: 'Lead product design for mutation payload renderer state.',
        title: 'Mutation payload Senior Product Designer',
      },
    },
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState,
      ingestPastedVacancy,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitForVacancyDraftValues({
    text: '',
    url: '',
  })

  fireEvent.change(screen.getByLabelText('Job link'), {
    target: {
      value: 'https://jobs.example.com/mutation-reviewed-role',
    },
  })
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: {
      value: 'Mutation payload reviewed vacancy draft.',
    },
  })
  const { reviewTextButton: initialReviewTextButton } = getReviewButtons()

  fireEvent.click(initialReviewTextButton)

  await waitFor(() => {
    expect(ingestPastedVacancy).toHaveBeenCalledTimes(1)
    expect(getVacancyWorkspaceState).toHaveBeenCalledTimes(2)
  })

  await waitFor(() => {
    expect(screen.getByText('Query-backed Senior Product Designer')).toBeDefined()
  })

  expect(screen.getByLabelText('Job link')).toHaveProperty(
    'value',
    'https://jobs.example.com/query-reviewed-role',
  )
  expect(screen.getByLabelText('Job description')).toHaveProperty(
    'value',
    'Query-backed reviewed vacancy draft.',
  )
  expect(screen.queryByText('Mutation payload Senior Product Designer')).toBeNull()
})

test('locks the current vacancy draft after a successful review and keeps review actions visible but disabled', async () => {
  const getVacancyWorkspaceState = vi
    .fn()
    .mockResolvedValueOnce({
      draft: {
        text: '',
        url: '',
      },
      vacancy: null,
    })
    .mockResolvedValueOnce({
      draft: {
        text: 'Reviewed vacancy draft.',
        url: 'https://jobs.example.com/reviewed-role',
      },
      reviewState: 'reviewed',
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-08T21:00:00.000Z',
        id: 'vacancy-reviewed',
        inputType: 'pasted_text',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/reviewed-role',
        requirements: ['Experience shipping workflow software.'],
        resolvedUrl: 'https://jobs.example.com/reviewed-role',
        responsibilities: ['Lead product design for reviewed draft state.'],
        source: 'generic',
        status: 'ready',
        textPreview: 'Lead product design for reviewed draft state.',
        title: 'Reviewed Senior Product Designer',
      },
    })
  const ingestPastedVacancy = vi.fn().mockResolvedValue({
    kind: 'ingested',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Mutation Labs',
      fetchedAt: '2026-04-08T21:00:00.000Z',
      id: 'vacancy-mutation-reviewed',
      inputType: 'pasted_text',
      location: 'London, United Kingdom',
      originalUrl: 'https://jobs.example.com/mutation-reviewed-role',
      requirements: ['Strong written communication.'],
      resolvedUrl: 'https://jobs.example.com/mutation-reviewed-role',
      responsibilities: ['Lead product design for mutation payload renderer state.'],
      source: 'generic',
      status: 'ready',
      textPreview: 'Lead product design for mutation payload renderer state.',
      title: 'Mutation payload Senior Product Designer',
    },
    workspaceState: {
      draft: {
        text: 'Mutation payload reviewed vacancy draft.',
        url: 'https://jobs.example.com/mutation-reviewed-role',
      },
      reviewState: 'reviewed',
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Mutation Labs',
        fetchedAt: '2026-04-08T21:00:00.000Z',
        id: 'vacancy-mutation-reviewed',
        inputType: 'pasted_text',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/mutation-reviewed-role',
        requirements: ['Strong written communication.'],
        resolvedUrl: 'https://jobs.example.com/mutation-reviewed-role',
        responsibilities: ['Lead product design for mutation payload renderer state.'],
        source: 'generic',
        status: 'ready',
        textPreview: 'Lead product design for mutation payload renderer state.',
        title: 'Mutation payload Senior Product Designer',
      },
    },
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState,
      ingestPastedVacancy,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Job link'), {
    target: {
      value: 'https://jobs.example.com/mutation-reviewed-role',
    },
  })
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: {
      value: 'Mutation payload reviewed vacancy draft.',
    },
  })
  const { reviewTextButton: initialReviewTextButton } = getReviewButtons()

  fireEvent.click(initialReviewTextButton)

  await waitFor(() => {
    expect(ingestPastedVacancy).toHaveBeenCalledTimes(1)
    expect(getVacancyWorkspaceState).toHaveBeenCalledTimes(2)
  })

  await waitFor(() => {
    expect(screen.getByText('Reviewed Senior Product Designer')).toBeDefined()
  })

  const vacancyUrlInput = screen.getByLabelText('Job link')
  const vacancyTextInput = screen.getByLabelText('Job description')
  const { reviewTextButton, reviewUrlButton } = getReviewButtons()

  expect(vacancyUrlInput).toHaveProperty('value', 'https://jobs.example.com/reviewed-role')
  expect(vacancyUrlInput).toHaveProperty('readOnly', true)
  expect(vacancyTextInput).toHaveProperty('value', 'Reviewed vacancy draft.')
  expect(vacancyTextInput).toHaveProperty('readOnly', true)
  expect(reviewUrlButton).toHaveProperty('disabled', true)
  expect(reviewTextButton).toHaveProperty('disabled', true)

  fireEvent.click(reviewUrlButton)
  fireEvent.click(reviewTextButton)

  expect(ingestPastedVacancy).toHaveBeenCalledTimes(1)
})

test('restores a reviewed vacancy draft as locked source inputs on startup', async () => {
  const ingestPastedVacancy = vi.fn().mockResolvedValue({
    kind: 'ingested',
    vacancy: null,
    workspaceState: {
      draft: {
        text: '',
        url: '',
      },
      reviewState: 'editable',
      vacancy: null,
    },
  })
  const ingestVacancyUrl = vi.fn().mockResolvedValue({
    kind: 'ingested',
    vacancy: null,
    workspaceState: {
      draft: {
        text: '',
        url: '',
      },
      reviewState: 'editable',
      vacancy: null,
    },
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi.fn().mockResolvedValue({
        draft: {
          text: '',
          url: 'https://jobs.example.com/restored-reviewed-role',
        },
        reviewState: 'reviewed',
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-08T21:00:00.000Z',
          id: 'vacancy-restored-reviewed',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/restored-reviewed-role',
          requirements: ['Experience shipping workflow software.'],
          resolvedUrl: 'https://jobs.example.com/restored-reviewed-role',
          responsibilities: ['Lead product design for restored reviewed draft state.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead product design for restored reviewed draft state.',
          title: 'Restored Senior Product Designer',
        },
      }),
      ingestPastedVacancy,
      ingestVacancyUrl,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  const vacancyUrlInput = screen.getByLabelText('Job link')
  const vacancyTextInput = screen.getByLabelText('Job description')

  expect(vacancyUrlInput).toHaveProperty('value', 'https://jobs.example.com/restored-reviewed-role')
  expect(vacancyUrlInput).toHaveProperty('readOnly', true)
  expect(vacancyTextInput).toHaveProperty('value', '')
  expect(vacancyTextInput).toHaveProperty('readOnly', true)
  const { reviewTextButton, reviewUrlButton } = getReviewButtons()

  expect(reviewUrlButton).toHaveProperty('disabled', true)
  expect(reviewTextButton).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Tailor your CV' })).toHaveProperty('disabled', false)

  fireEvent.click(reviewUrlButton)
  fireEvent.click(reviewTextButton)

  expect(ingestVacancyUrl).not.toHaveBeenCalled()
  expect(ingestPastedVacancy).not.toHaveBeenCalled()
})

test('submitting a LinkedIn vacancy URL automatically continues into the internal browser session and restores adaptation when extraction succeeds', async () => {
  const openVacancyBrowserSession = vi.fn().mockResolvedValue({
    kind: 'ingested',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-08T21:18:00.000Z',
      id: 'vacancy-006',
      inputType: 'url',
      location: 'London, United Kingdom',
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      requirements: ['Experience shipping workflow software.'],
      resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
      responsibilities: ['Lead product design for authenticated desktop workflows.'],
      source: 'linkedin',
      status: 'ready',
      textPreview: 'Lead product design for authenticated desktop workflows.',
      title: 'Senior Product Designer',
    },
    workspaceState: {
      draft: {
        text: '',
        url: 'https://www.linkedin.com/jobs/view/123456',
      },
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-08T21:18:00.000Z',
        id: 'vacancy-006',
        inputType: 'url',
        location: 'London, United Kingdom',
        originalUrl: 'https://www.linkedin.com/jobs/view/123456',
        requirements: ['Experience shipping workflow software.'],
        resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
        responsibilities: ['Lead product design for authenticated desktop workflows.'],
        source: 'linkedin',
        status: 'ready',
        textPreview: 'Lead product design for authenticated desktop workflows.',
        title: 'Senior Product Designer',
      },
    },
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
          draft: {
            text: '',
            url: '',
          },
          vacancy: null,
        })
        .mockResolvedValueOnce({
          draft: {
            text: '',
            url: 'https://www.linkedin.com/jobs/view/123456',
          },
          vacancy: {
            blockingReason: null,
            canGenerate: true,
            employer: 'Example Labs',
            fetchedAt: '2026-04-08T21:18:00.000Z',
            id: 'vacancy-006',
            inputType: 'url',
            location: 'London, United Kingdom',
            originalUrl: 'https://www.linkedin.com/jobs/view/123456',
            requirements: ['Experience shipping workflow software.'],
            resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
            responsibilities: ['Lead product design for authenticated desktop workflows.'],
            source: 'linkedin',
            status: 'ready',
            textPreview: 'Lead product design for authenticated desktop workflows.',
            title: 'Senior Product Designer',
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
          originalUrl: 'https://www.linkedin.com/jobs/view/123456',
          requirements: [],
          resolvedUrl: null,
          responsibilities: [],
          source: 'linkedin',
          status: 'incomplete',
          textPreview: '',
          title: null,
        },
        workspaceState: {
          draft: {
            text: '',
            url: 'https://www.linkedin.com/jobs/view/123456',
          },
          vacancy: null,
        },
      }),
      openVacancyBrowserSession,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitForVacancyDraftValues({
    text: '',
    url: '',
  })

  fireEvent.change(screen.getByLabelText('Job link'), {
    target: {
      value: 'https://www.linkedin.com/jobs/view/123456',
    },
  })
  const { reviewUrlButton } = getReviewButtons()

  fireEvent.click(reviewUrlButton)

  await waitFor(() => {
    expect(openVacancyBrowserSession).toHaveBeenCalledWith({
      url: 'https://www.linkedin.com/jobs/view/123456',
    })
  })

  await waitFor(() => {
    expect(screen.getByText('Senior Product Designer')).toBeDefined()
  })

  expect(screen.getByLabelText('Job link')).toHaveProperty(
    'value',
    'https://www.linkedin.com/jobs/view/123456',
  )
  expect(screen.getByRole('button', { name: 'Tailor your CV' })).toHaveProperty('disabled', false)
})

test('resumes the pending flow into the workspace overlay after sign-in repair', async () => {
  const resumePendingGeneration = vi.fn().mockImplementation(() => {
    return new Promise<never>((resolve) => {
      void resolve
    })
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: false,
        failureCode: 'auth_missing',
        message:
          'The local AI worker needs a valid sign-in before CV Maxxing can resume your tailored application.',
        provider: 'codex',
        status: 'sign_in_required',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
      startAiWorkerSignIn: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
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
      resumePendingGeneration,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Open tailored application' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()

  await waitFor(() => {
    expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
  })
})

test('renders the workspace overlay when startup restores pending generation', async () => {
  const resumePendingGeneration = vi.fn().mockImplementation(() => {
    return new Promise<never>((resolve) => {
      void resolve
    })
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    tailoredApplication: createTailoredApplicationApi({
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
      resumePendingGeneration,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Open tailored application' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()
})

test('restores the workspace overlay after returning from settings during pending generation', async () => {
  const resumePendingGeneration = vi.fn().mockImplementation(() => {
    return new Promise<never>((resolve) => {
      void resolve
    })
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    tailoredApplication: createTailoredApplicationApi({
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
      resumePendingGeneration,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'AI' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Jobs' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()

  await waitFor(() => {
    expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
  })
})

test('keeps settings open when restored generation completes in the background', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace')
    .mockResolvedValueOnce('workspace')
  const getPendingGenerationCommand = vi
    .fn()
    .mockResolvedValueOnce({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    })
    .mockResolvedValue(null)
  const completePendingGeneration = vi.fn().mockResolvedValue({
    workspaceState: createTailoredApplicationWorkspaceStateFixture({
      activeApplicationId: 'tailored-application-123',
      applications: [
        {
          createdAt: '2026-04-09T09:30:00.000Z',
          employer: 'Example Labs',
          id: 'tailored-application-123',
          pageCount: 4,
          pageWarning: null,
          title: 'Senior platform engineer',
          vacancyTitle: 'Senior platform engineer',
        },
      ],
    }),
  })
  let resolveResumePendingGeneration:
    | ((value: { generationRunId: string; tailoredApplicationId: string }) => void)
    | undefined

  const resumePendingGeneration = vi.fn().mockImplementation(() => {
    return new Promise<{ generationRunId: string; tailoredApplicationId: string }>((resolve) => {
      resolveResumePendingGeneration = resolve
    })
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      completePendingGeneration,
      getPendingGenerationCommand,
      getTailoredApplicationPreview: vi.fn().mockResolvedValue({
        adaptedCv: {
          pageCount: 4,
          pageWarning: null,
          pdfBytes: new Uint8Array([37, 80, 68, 70]),
        },
        adaptationSummary: {
          emphasized: [],
          gaps: [],
          omitted: [],
          validationHints: [],
        },
        coverLetter: {
          pageCount: 1,
          pageWarning: null,
          pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
          plainText: 'Dear Hiring Manager',
        },
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
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
        title: 'Senior platform engineer',
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-09T08:30:00.000Z',
          id: 'vacancy-123',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/roles/123',
          requirements: ['Experience shipping workflow software.'],
          resolvedUrl: 'https://jobs.example.com/roles/123',
          responsibilities: ['Lead product design for authenticated desktop workflows.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead product design for authenticated desktop workflows.',
          title: 'Senior platform engineer',
        },
        vacancyTitle: 'Senior platform engineer',
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeApplicationId: 'tailored-application-123',
        applications: [
          {
            createdAt: '2026-04-09T09:30:00.000Z',
            employer: 'Example Labs',
            id: 'tailored-application-123',
            pageCount: 4,
            pageWarning: null,
            title: 'Senior platform engineer',
            vacancyTitle: 'Senior platform engineer',
          },
        ],
      }),
      resumePendingGeneration,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'AI' })).toBeDefined()
  })

  await waitFor(() => {
    expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
  })

  const resolvePendingGeneration = resolveResumePendingGeneration

  if (resolvePendingGeneration === undefined) {
    throw new Error('Expected resumePendingGeneration to capture a resolver.')
  }

  resolvePendingGeneration({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  await waitFor(() => {
    expect(completePendingGeneration).toHaveBeenCalledWith('command-123')
  })

  expect(screen.getByRole('heading', { name: 'AI' })).toBeDefined()
  expect(screen.queryByRole('heading', { name: 'Senior platform engineer' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Jobs' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })
})

test('returns to the workspace with a visible error when generation fails contract validation from the overlay flow', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace')
    .mockResolvedValueOnce('workspace')

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
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
      resumePendingGeneration: vi.fn().mockRejectedValue({
        message: "We couldn't finish your CV and cover letter. Try tailoring this job again.",
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  await waitFor(() => {
    expect(
      screen.getByText(
        "We couldn't finish your CV and cover letter. Try tailoring this job again.",
      ),
    ).toBeDefined()
  })

  expect(screen.getAllByRole('button', { name: 'Check job details' })).toHaveLength(2)
})

test('returns to the workspace immediately when overlay recovery stalls after generation failure', async () => {
  const getStartupDestination = vi.fn().mockResolvedValueOnce('workspace')
  const getAiWorkerPreflight = vi
    .fn()
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
    .mockImplementation(() => {
      return new Promise((resolve) => {
        void resolve
      })
    })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight,
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
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
      resumePendingGeneration: vi.fn().mockRejectedValue({
        message: "We couldn't finish your CV and cover letter. Try tailoring this job again.",
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  await waitFor(() => {
    expect(
      screen.getByText(
        "We couldn't finish your CV and cover letter. Try tailoring this job again.",
      ),
    ).toBeDefined()
  })

  expect(screen.queryByRole('heading', { name: 'Generating tailored application' })).toBeNull()
})

test('opens the tailored application when generation completes from the workspace overlay', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace')
    .mockResolvedValueOnce('workspace')
  const getPendingGenerationCommand = vi
    .fn()
    .mockResolvedValueOnce({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    })
    .mockResolvedValue(null)
  const completedWorkspaceState = createTailoredApplicationWorkspaceStateFixture({
    activeApplicationId: 'tailored-application-123',
    applications: [
      {
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
        pageCount: 4,
        pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
        title: 'Senior platform engineer',
        vacancyTitle: 'Senior platform engineer',
      },
    ],
  })
  const completePendingGeneration = vi.fn().mockResolvedValue({
    workspaceState: completedWorkspaceState,
  })
  const clipboardWriteText = vi.fn().mockImplementation(() => Promise.resolve())
  const exportAdaptedCvPdf = vi.fn().mockResolvedValue({
    filePath: '/exports/Ada Lovelace - Senior platform engineer - adapted-cv (2).pdf',
    overwriteAvoided: true,
    pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
  })
  const exportCoverLetterPdf = vi.fn().mockResolvedValue({
    filePath: '/exports/Ada Lovelace - Senior platform engineer - cover-letter (2).pdf',
    overwriteAvoided: true,
    pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
  })
  const getTailoredApplicationPreview = vi.fn().mockResolvedValue({
    adaptedCv: {
      pageCount: 4,
      pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    adaptationSummary: {
      emphasized: [
        {
          text: 'Emphasises desktop workflow leadership for the job vacancy.',
        },
      ],
      gaps: ['Add stronger quantified delivery evidence from the original CV.'],
      omitted: [
        {
          text: 'Compresses broader communication language so the adapted CV stays vacancy-specific.',
        },
      ],
      validationHints: ['Validate performance claims against the original CV snapshot.'],
    },
    coverLetter: {
      pageCount: 2,
      pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
      pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      plainText: 'Dear Hiring Manager,\n\nAda Lovelace',
    },
    createdAt: '2026-04-09T09:30:00.000Z',
    employer: 'Example Labs',
    id: 'tailored-application-123',
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
    title: 'Senior platform engineer',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-09T08:30:00.000Z',
      id: 'vacancy-123',
      inputType: 'url',
      location: 'London, United Kingdom',
      originalUrl: 'https://jobs.example.com/roles/123',
      requirements: ['Experience shipping workflow software.'],
      resolvedUrl: 'https://jobs.example.com/roles/123',
      responsibilities: ['Lead product design for authenticated desktop workflows.'],
      source: 'generic',
      status: 'ready',
      textPreview: 'Lead product design for authenticated desktop workflows.',
      title: 'Senior platform engineer',
    },
    vacancyTitle: 'Senior platform engineer',
  })
  const getWorkspaceState = vi.fn().mockResolvedValue(completedWorkspaceState)
  const resumePendingGeneration = vi.fn().mockResolvedValue({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      completePendingGeneration,
      exportAdaptedCvPdf,
      exportCoverLetterPdf,
      getPendingGenerationCommand,
      getTailoredApplicationPreview,
      getWorkspaceState,
      resumePendingGeneration,
    }),
  })

  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: clipboardWriteText,
    },
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()

  await waitFor(() => {
    expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
    expect(completePendingGeneration).toHaveBeenCalledWith('command-123')
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  expect(screen.getByText('About this job')).toBeDefined()
  expect(screen.getByRole('heading', { level: 3, name: 'Your CV' })).toBeDefined()
  expect(screen.getByRole('heading', { level: 3, name: 'Highlighted in your CV' })).toBeDefined()
  expect(screen.getByRole('heading', { level: 3, name: 'Worth checking' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Delete this job' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Regenerate tailored application' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Edit adapted CV' })).toBeNull()

  expect(screen.getByText('Page 1 of 4')).toBeDefined()
  expect(
    screen.queryByText('This adapted CV runs to 4 pages. Export is still available.'),
  ).toBeNull()
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Save CV and cover letter' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Save CV and cover letter' }))

  await waitFor(() => {
    expect(exportAdaptedCvPdf).toHaveBeenCalledWith('tailored-application-123')
  })

  fireEvent.click(screen.getByRole('button', { name: 'Cover letter' }))

  await waitFor(() => {
    expect(screen.getByText('Page 1 of 2')).toBeDefined()
  })

  expect(
    screen.queryByText('This cover letter runs to 2 pages. Export and copy remain available.'),
  ).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Save CV and cover letter' }))
  fireEvent.click(screen.getByRole('button', { name: 'Copy cover letter text' }))

  await waitFor(() => {
    expect(exportCoverLetterPdf).toHaveBeenCalledWith('tailored-application-123')
    expect(clipboardWriteText).toHaveBeenCalledWith('Dear Hiring Manager,\n\nAda Lovelace')
  })
})

test('replaces the current draft row with the new saved tailored application row without sidebar churn', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace')
    .mockResolvedValueOnce('workspace')
  const getPendingGenerationCommand = vi
    .fn()
    .mockResolvedValueOnce({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    })
    .mockResolvedValue(null)
  const completedWorkspaceState = createTailoredApplicationWorkspaceStateFixture({
    activeApplicationId: 'tailored-application-123',
    applications: [
      {
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
        pageCount: 4,
        pageWarning: null,
        title: 'Senior platform engineer',
        vacancyTitle: 'Senior platform engineer',
      },
      {
        createdAt: '2026-04-08T09:30:00.000Z',
        employer: 'Nebula Labs',
        id: 'tailored-application-456',
        pageCount: 2,
        pageWarning: null,
        title: 'Platform Product Manager',
        vacancyTitle: 'Platform Product Manager',
      },
    ],
  })
  const completePendingGeneration = vi.fn().mockResolvedValue({
    workspaceState: completedWorkspaceState,
  })
  const getWorkspaceStateRefetch = createDeferredPromise<TailoredApplicationWorkspaceState>()
  const previousTailoredApplication = completedWorkspaceState.applications[1]

  if (previousTailoredApplication === undefined) {
    throw new Error('Expected the seeded workspace state to include an older tailored application.')
  }

  const getWorkspaceState = vi
    .fn()
    .mockResolvedValueOnce(
      createTailoredApplicationWorkspaceStateFixture({
        activeApplicationId: 'tailored-application-456',
        applications: [previousTailoredApplication],
      }),
    )
    .mockImplementationOnce(() => {
      return getWorkspaceStateRefetch.promise
    })
  const getTailoredApplicationPreview = vi.fn().mockImplementation(() => {
    return new Promise<TailoredApplicationPreview | null>(() => null)
  })
  const resumePendingGeneration = vi.fn().mockResolvedValue({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      completePendingGeneration,
      getPendingGenerationCommand,
      getTailoredApplicationPreview,
      getWorkspaceState,
      resumePendingGeneration,
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi.fn().mockResolvedValue({
        draft: {
          text: 'Senior platform engineer',
          url: 'https://jobs.example.com/roles/123',
        },
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-09T08:30:00.000Z',
          id: 'vacancy-123',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/roles/123',
          requirements: ['Experience shipping workflow software.'],
          resolvedUrl: 'https://jobs.example.com/roles/123',
          responsibilities: ['Lead product design for authenticated desktop workflows.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead product design for authenticated desktop workflows.',
          title: 'Senior platform engineer',
        },
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Open add a job' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Open platform product manager' })).toBeDefined()
  })

  expect(screen.queryByText('No jobs yet')).toBeNull()

  await waitFor(() => {
    expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
    expect(completePendingGeneration).toHaveBeenCalledWith('command-123')
  })

  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Open add a job' })).toBeNull()
  })

  expect(screen.queryByText('No jobs yet')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  expect(
    screen
      .getByRole('button', { name: 'Open senior platform engineer' })
      .getAttribute('aria-current'),
  ).toBe('page')
  expect(screen.getByRole('button', { name: 'Open platform product manager' })).toBeDefined()
  expect(getTailoredApplicationPreview).toHaveBeenCalledWith('tailored-application-123')
})

test('transitions to the tailored application even when vacancy cleanup is still pending', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace')
    .mockResolvedValueOnce('workspace')
  const getPendingGenerationCommand = vi
    .fn()
    .mockResolvedValueOnce({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    })
    .mockResolvedValue(null)
  const completePendingGeneration = vi.fn().mockResolvedValue({
    workspaceState: createTailoredApplicationWorkspaceStateFixture({
      activeApplicationId: 'tailored-application-123',
      applications: [
        {
          createdAt: '2026-04-09T09:30:00.000Z',
          employer: 'Example Labs',
          id: 'tailored-application-123',
          pageCount: 4,
          pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
          title: 'Senior platform engineer',
          vacancyTitle: 'Senior platform engineer',
        },
      ],
    }),
  })
  const getTailoredApplicationPreview = vi.fn().mockResolvedValue({
    adaptedCv: {
      pageCount: 4,
      pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    adaptationSummary: {
      emphasized: [
        {
          text: 'Emphasises desktop workflow leadership for the job vacancy.',
        },
      ],
      gaps: ['Add stronger quantified delivery evidence from the original CV.'],
      omitted: [],
      validationHints: ['Validate performance claims against the original CV snapshot.'],
    },
    coverLetter: {
      pageCount: 2,
      pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
      pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      plainText: 'Dear Hiring Manager,\n\nAda Lovelace',
    },
    createdAt: '2026-04-09T09:30:00.000Z',
    employer: 'Example Labs',
    id: 'tailored-application-123',
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
    title: 'Senior platform engineer',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-09T08:30:00.000Z',
      id: 'vacancy-123',
      inputType: 'url',
      location: 'London, United Kingdom',
      originalUrl: 'https://jobs.example.com/roles/123',
      requirements: ['Experience shipping workflow software.'],
      resolvedUrl: 'https://jobs.example.com/roles/123',
      responsibilities: ['Lead product design for authenticated desktop workflows.'],
      source: 'generic',
      status: 'ready',
      textPreview: 'Lead product design for authenticated desktop workflows.',
      title: 'Senior platform engineer',
    },
    vacancyTitle: 'Senior platform engineer',
  })
  const getWorkspaceState = vi.fn().mockResolvedValue({
    activeApplicationId: 'tailored-application-123',
    applications: [
      {
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
        pageCount: 4,
        pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
        title: 'Senior platform engineer',
        vacancyTitle: 'Senior platform engineer',
      },
    ],
  })
  const resumePendingGeneration = vi.fn().mockResolvedValue({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  const clearVacancyWorkspaceState = vi.fn().mockImplementation(() => {
    return new Promise<void>(() => null)
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      completePendingGeneration,
      getPendingGenerationCommand,
      getTailoredApplicationPreview,
      getWorkspaceState,
      resumePendingGeneration,
    }),
    vacancy: createVacancyApi({
      clearVacancyWorkspaceState,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()

  await waitFor(() => {
    expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
    expect(completePendingGeneration).toHaveBeenCalledWith('command-123')
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  expect(clearVacancyWorkspaceState).not.toHaveBeenCalled()
})

test('browses saved tailored applications, reopens an older detail view, and deletes it', async () => {
  const getTailoredApplicationPreview = vi.fn<
    (tailoredApplicationId: string) => Promise<TailoredApplicationPreview | null>
  >((tailoredApplicationId: string) => {
    if (tailoredApplicationId === 'tailored-application-456') {
      return Promise.resolve({
        adaptedCv: {
          pageCount: 2,
          pageWarning: null,
          pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 50]),
        },
        adaptationSummary: {
          emphasized: [
            {
              text: 'Emphasises platform product leadership for this tailored application.',
            },
          ],
          gaps: ['Add clearer desktop-delivery metrics from the original CV snapshot.'],
          omitted: [],
          validationHints: ['Validate platform scale claims against the original CV.'],
        },
        coverLetter: {
          pageCount: 1,
          pageWarning: null,
          pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76, 50]),
          plainText: 'Dear Hiring Manager,\n\nNebula Labs',
        },
        createdAt: '2026-04-08T09:30:00.000Z',
        employer: 'Nebula Labs',
        id: 'tailored-application-456',
        originalCv: {
          fileType: 'pdf',
          headline: 'Platform Product Manager',
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
        title: 'Platform Product Manager',
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Nebula Labs',
          fetchedAt: '2026-04-08T08:30:00.000Z',
          id: 'vacancy-456',
          inputType: 'url',
          location: 'Remote',
          originalUrl: 'https://jobs.example.com/platform-product-manager',
          requirements: ['Experience with platform roadmaps.'],
          resolvedUrl: 'https://jobs.example.com/platform-product-manager',
          responsibilities: ['Lead platform product direction.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead platform product direction.',
          title: 'Platform Product Manager',
        },
        vacancyTitle: 'Platform Product Manager',
      } satisfies TailoredApplicationPreview)
    }

    return Promise.resolve({
      adaptedCv: {
        pageCount: 4,
        pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      },
      adaptationSummary: {
        emphasized: [
          {
            text: 'Emphasises desktop workflow leadership for the job vacancy.',
          },
        ],
        gaps: ['Add stronger quantified delivery evidence from the original CV.'],
        omitted: [],
        validationHints: ['Validate performance claims against the original CV snapshot.'],
      },
      coverLetter: {
        pageCount: 2,
        pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
        plainText: 'Dear Hiring Manager,\n\nAda Lovelace',
      },
      createdAt: '2026-04-09T09:30:00.000Z',
      employer: 'Example Labs',
      id: 'tailored-application-123',
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
      title: 'Senior platform engineer',
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-09T08:30:00.000Z',
        id: 'vacancy-123',
        inputType: 'url',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/roles/123',
        requirements: ['Experience shipping workflow software.'],
        resolvedUrl: 'https://jobs.example.com/roles/123',
        responsibilities: ['Lead product design for authenticated desktop workflows.'],
        source: 'generic',
        status: 'ready',
        textPreview: 'Lead product design for authenticated desktop workflows.',
        title: 'Senior platform engineer',
      },
      vacancyTitle: 'Senior platform engineer',
    } satisfies TailoredApplicationPreview)
  })
  const getWorkspaceState = vi
    .fn()
    .mockResolvedValueOnce({
      activeApplicationId: 'tailored-application-123',
      applications: [
        {
          createdAt: '2026-04-09T09:30:00.000Z',
          employer: 'Example Labs',
          id: 'tailored-application-123',
          pageCount: 4,
          pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
          title: 'Senior platform engineer',
          vacancyTitle: 'Senior platform engineer',
        },
        {
          createdAt: '2026-04-08T09:30:00.000Z',
          employer: 'Nebula Labs',
          id: 'tailored-application-456',
          pageCount: 2,
          pageWarning: null,
          title: 'Platform Product Manager',
          vacancyTitle: 'Platform Product Manager',
        },
      ],
    })
    .mockResolvedValueOnce({
      activeApplicationId: 'tailored-application-123',
      applications: [
        {
          createdAt: '2026-04-09T09:30:00.000Z',
          employer: 'Example Labs',
          id: 'tailored-application-123',
          pageCount: 4,
          pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
          title: 'Senior platform engineer',
          vacancyTitle: 'Senior platform engineer',
        },
      ],
    })
  const deleteTailoredApplication = vi.fn().mockImplementation(() => Promise.resolve())

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      deleteTailoredApplication,
      getTailoredApplicationPreview,
      getWorkspaceState,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open platform product manager' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Platform Product Manager' })).toBeDefined()
  })

  expect(screen.getByText('Lead platform product direction.')).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Delete this job' }))

  const deleteDialog = screen.getByRole('dialog', { name: 'Delete this job?' })

  expect(deleteDialog).toBeDefined()

  fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete this job' }))

  await waitFor(() => {
    expect(deleteTailoredApplication).toHaveBeenCalledWith('tailored-application-456')
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })
})

test('switches between saved tailored applications without discarding the current draft', async () => {
  const draft = {
    text: 'Senior platform engineer',
    url: 'https://jobs.example.com/roles/123',
  }
  const firstPreview = createTailoredApplicationPreviewFixture()
  const secondPreview = createTailoredApplicationPreviewFixture({
    employer: 'Nebula Labs',
    id: 'tailored-application-456',
    title: 'Platform Product Manager',
    vacancy: {
      ...createTailoredApplicationPreviewFixture().vacancy,
      employer: 'Nebula Labs',
      id: 'vacancy-456',
      location: 'Remote',
      originalUrl: 'https://jobs.example.com/platform-product-manager',
      resolvedUrl: 'https://jobs.example.com/platform-product-manager',
      responsibilities: ['Lead platform product direction.'],
      title: 'Platform Product Manager',
    },
    vacancyTitle: 'Platform Product Manager',
  })
  const getTailoredApplicationPreview = vi.fn().mockImplementation((tailoredApplicationId) => {
    return Promise.resolve(
      tailoredApplicationId === 'tailored-application-456' ? secondPreview : firstPreview,
    )
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      getTailoredApplicationPreview,
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeApplicationId: null,
        applications: [
          {
            createdAt: '2026-04-09T09:30:00.000Z',
            employer: 'Example Labs',
            id: 'tailored-application-123',
            pageCount: 4,
            pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
            title: 'Senior platform engineer',
            vacancyTitle: 'Senior platform engineer',
          },
          {
            createdAt: '2026-04-08T09:30:00.000Z',
            employer: 'Nebula Labs',
            id: 'tailored-application-456',
            pageCount: 2,
            pageWarning: null,
            title: 'Platform Product Manager',
            vacancyTitle: 'Platform Product Manager',
          },
        ],
      }),
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi.fn().mockResolvedValue({
        draft,
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-09T08:30:00.000Z',
          id: 'vacancy-123',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/roles/123',
          requirements: ['Experience shipping workflow software.'],
          resolvedUrl: 'https://jobs.example.com/roles/123',
          responsibilities: ['Lead desktop workflow delivery across product and engineering.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead desktop workflow delivery across product and engineering.',
          title: 'Senior platform engineer',
        },
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitForVacancyDraftValues(draft)

  fireEvent.click(screen.getByRole('button', { name: 'Open platform product manager' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Platform Product Manager' })).toBeDefined()
  })

  expect(screen.getByRole('button', { name: 'Open add a job' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Open senior platform engineer' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open add a job' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitForVacancyDraftValues(draft)
})

test('deleting the selected saved tailored application returns to the current draft when it exists', async () => {
  const draft = {
    text: 'Senior platform engineer',
    url: 'https://jobs.example.com/roles/123',
  }
  const deleteTailoredApplication = vi.fn().mockImplementation(() => Promise.resolve())

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      deleteTailoredApplication,
      getTailoredApplicationPreview: vi
        .fn()
        .mockResolvedValue(createTailoredApplicationPreviewFixture()),
      getWorkspaceState: vi
        .fn()
        .mockResolvedValueOnce({
          activeApplicationId: null,
          applications: [
            {
              createdAt: '2026-04-09T09:30:00.000Z',
              employer: 'Example Labs',
              id: 'tailored-application-123',
              pageCount: 4,
              pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
              title: 'Senior platform engineer',
              vacancyTitle: 'Senior platform engineer',
            },
          ],
        })
        .mockResolvedValueOnce({
          activeApplicationId: null,
          applications: [],
        }),
    }),
    vacancy: createVacancyApi({
      getVacancyWorkspaceState: vi.fn().mockResolvedValue({
        draft,
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-09T08:30:00.000Z',
          id: 'vacancy-123',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/roles/123',
          requirements: ['Experience shipping workflow software.'],
          resolvedUrl: 'https://jobs.example.com/roles/123',
          responsibilities: ['Lead desktop workflow delivery across product and engineering.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead desktop workflow delivery across product and engineering.',
          title: 'Senior platform engineer',
        },
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open senior platform engineer' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Delete this job' }))

  const deleteDialog = screen.getByRole('dialog', { name: 'Delete this job?' })

  expect(deleteDialog).toBeDefined()

  fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete this job' }))

  await waitFor(() => {
    expect(deleteTailoredApplication).toHaveBeenCalledWith('tailored-application-123')
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
  await waitForVacancyDraftValues(draft)
})

test('starts a new blank vacancy draft from the active tailored application workspace when no meaningful draft exists', async () => {
  const clearVacancyWorkspaceState = vi.fn().mockImplementation(() => Promise.resolve())

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      getTailoredApplicationPreview: vi.fn().mockResolvedValue({
        adaptedCv: {
          pageCount: 4,
          pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
          pdfBytes: new Uint8Array([37, 80, 68, 70]),
        },
        adaptationSummary: {
          emphasized: [
            {
              text: 'Emphasises desktop workflow leadership for the job vacancy.',
            },
          ],
          gaps: ['Add stronger quantified delivery evidence from the original CV.'],
          omitted: [],
          validationHints: ['Validate performance claims against the original CV snapshot.'],
        },
        coverLetter: {
          pageCount: 2,
          pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
          pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
          plainText: 'Dear Hiring Manager,\n\nAda Lovelace',
        },
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
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
        title: 'Senior platform engineer',
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Example Labs',
          fetchedAt: '2026-04-09T08:30:00.000Z',
          id: 'vacancy-123',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/roles/123',
          requirements: ['Experience shipping workflow software.'],
          resolvedUrl: 'https://jobs.example.com/roles/123',
          responsibilities: ['Lead product design for authenticated desktop workflows.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead product design for authenticated desktop workflows.',
          title: 'Senior platform engineer',
        },
        vacancyTitle: 'Senior platform engineer',
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeApplicationId: 'tailored-application-123',
        applications: [
          {
            createdAt: '2026-04-09T09:30:00.000Z',
            employer: 'Example Labs',
            id: 'tailored-application-123',
            pageCount: 4,
            pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
            title: 'Senior platform engineer',
            vacancyTitle: 'Senior platform engineer',
          },
        ],
      }),
    }),
    vacancy: createVacancyApi({
      clearVacancyWorkspaceState,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Add a job' }))

  await waitFor(() => {
    expect(clearVacancyWorkspaceState).toHaveBeenCalledTimes(1)
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByLabelText('Job link')).toBeDefined()
  expect(screen.getByLabelText('Job description')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open senior platform engineer' })).toBeDefined()
})

test('requires confirmation before discarding a meaningful draft from the active tailored application workspace', async () => {
  const draft = {
    text: 'Senior platform engineer',
    url: 'https://jobs.example.com/roles/123',
  }
  const clearVacancyWorkspaceState = vi.fn().mockImplementation(() => Promise.resolve())
  const getVacancyWorkspaceState = vi
    .fn()
    .mockResolvedValueOnce({
      draft,
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-09T08:30:00.000Z',
        id: 'vacancy-123',
        inputType: 'url',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/roles/123',
        requirements: ['Experience shipping workflow software.'],
        resolvedUrl: 'https://jobs.example.com/roles/123',
        responsibilities: ['Lead desktop workflow delivery across product and engineering.'],
        source: 'generic',
        status: 'ready',
        textPreview: 'Lead desktop workflow delivery across product and engineering.',
        title: 'Senior platform engineer',
      },
    })
    .mockResolvedValue({
      draft: {
        text: '',
        url: '',
      },
      vacancy: null,
    })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      getTailoredApplicationPreview: vi
        .fn()
        .mockResolvedValue(createTailoredApplicationPreviewFixture()),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activeApplicationId: 'tailored-application-123',
        applications: [
          {
            createdAt: '2026-04-09T09:30:00.000Z',
            employer: 'Example Labs',
            id: 'tailored-application-123',
            pageCount: 4,
            pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
            title: 'Senior platform engineer',
            vacancyTitle: 'Senior platform engineer',
          },
        ],
      }),
    }),
    vacancy: createVacancyApi({
      clearVacancyWorkspaceState,
      getVacancyWorkspaceState,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Add a job' }))

  expect(clearVacancyWorkspaceState).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'Discard this job draft?' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Discard this job draft?' })).toBeNull()
  })

  expect(clearVacancyWorkspaceState).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Add a job' }))
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))

  await waitFor(() => {
    expect(clearVacancyWorkspaceState).toHaveBeenCalledTimes(1)
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByLabelText('Job link')).toBeDefined()
  expect(screen.getByLabelText('Job description')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open senior platform engineer' })).toBeDefined()
})

test('abandons the pending draft from the workspace overlay and returns to workspace empty', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace')
    .mockResolvedValueOnce('workspace')
  const abandonPendingGeneration = vi.fn().mockImplementation(() => Promise.resolve())
  const resumePendingGeneration = vi.fn().mockImplementation(() => {
    return new Promise<never>((resolve) => {
      void resolve
    })
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    tailoredApplication: createTailoredApplicationApi({
      abandonPendingGeneration,
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
      resumePendingGeneration,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  await waitFor(() => {
    expect(abandonPendingGeneration).toHaveBeenCalledTimes(1)
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })
})

test('opens settings from the rail, shows version and privacy guardrails, and retries the AI worker from settings', async () => {
  const retryAiWorkerPreflight = vi.fn().mockResolvedValue({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('first_launch'),
      retryAiWorkerPreflight,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'AI' })).toBeDefined()
  })

  expect(screen.getByText('AI connection')).toBeDefined()
  expect(screen.getByText('Using')).toBeDefined()
  expect(screen.getByText('codex')).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Show Local data settings' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Local data' })).toBeDefined()
  })

  expect(screen.getByText('App version')).toBeDefined()
  expect(screen.getByText('1.0.0')).toBeDefined()
  expect(screen.getByText('Telemetry')).toBeDefined()
  expect(screen.getByText('Automatic update checks')).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Show AI settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  await waitFor(() => {
    expect(retryAiWorkerPreflight).toHaveBeenCalledTimes(1)
  })
})

test('leaves settings and returns to the repair screen when the AI worker retry fails', async () => {
  const retryAiWorkerPreflight = vi.fn().mockResolvedValue({
    canResumeGeneration: false,
    failureCode: 'runtime_missing',
    message: 'The local AI worker is unavailable. Check setup, then retry.',
    provider: 'codex',
    status: 'unavailable',
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
      retryAiWorkerPreflight,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'AI' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  await waitFor(() => {
    expect(retryAiWorkerPreflight).toHaveBeenCalledTimes(1)
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })
})

test('requires the destructive confirmation phrase before resetting local app data and returns to first launch after reset', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace')
    .mockResolvedValueOnce('first_launch')
  const getOriginalCvWorkspaceState = vi
    .fn()
    .mockResolvedValueOnce({
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
    })
    .mockResolvedValueOnce({
      activeOriginalCv: null,
      snapshotCount: 0,
    })
  const resetLocalAppData = vi.fn().mockImplementation(() => Promise.resolve())

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination,
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState,
    }),
    settings: createSettingsApi({
      resetLocalAppData,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show Local data settings' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Local data' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Reset local app data' }))

  const resetDialog = screen.getByRole('dialog', { name: 'Reset local app data?' })

  expect(resetDialog).toBeDefined()

  const confirmResetButton = within(resetDialog).getByRole('button', {
    name: 'Reset local app data',
  })

  expect(confirmResetButton).toHaveProperty('disabled', true)

  fireEvent.change(within(resetDialog).getByLabelText('Type RESET to confirm destructive reset'), {
    target: {
      value: SETTINGS_RESET_CONFIRMATION_PHRASE,
    },
  })
  fireEvent.click(confirmResetButton)

  await waitFor(() => {
    expect(resetLocalAppData).toHaveBeenCalledWith({
      confirmationPhrase: SETTINGS_RESET_CONFIRMATION_PHRASE,
    })
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add your CV' })).toBeDefined()
  })
})

test('shows an app-blocking overlay while resetting local app data', async () => {
  const resetLocalAppDataDeferredPromise = createDeferredPromise<null>()

  const resetLocalAppData = vi.fn(() => {
    return resetLocalAppDataDeferredPromise.promise.then((result) => {
      void result
    })
  })

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace'),
    }),
    originalCv: createOriginalCvApi({
      getOriginalCvWorkspaceState: vi.fn().mockResolvedValue({
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
    }),
    settings: createSettingsApi({
      resetLocalAppData,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show Local data settings' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Local data' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Reset local app data' }))

  const resetDialog = screen.getByRole('dialog', { name: 'Reset local app data?' })

  expect(resetDialog).toBeDefined()

  fireEvent.change(within(resetDialog).getByLabelText('Type RESET to confirm destructive reset'), {
    target: {
      value: SETTINGS_RESET_CONFIRMATION_PHRASE,
    },
  })
  fireEvent.click(within(resetDialog).getByRole('button', { name: 'Reset local app data' }))

  await waitFor(() => {
    expect(resetLocalAppData).toHaveBeenCalledWith({
      confirmationPhrase: SETTINGS_RESET_CONFIRMATION_PHRASE,
    })
  })

  expect(screen.getByRole('status', { name: 'Preparing app' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Local data' })).toBeDefined()

  resetLocalAppDataDeferredPromise.resolve(null)

  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Preparing app' })).toBeNull()
  })
})
