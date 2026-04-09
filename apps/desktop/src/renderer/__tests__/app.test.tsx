// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import type { OriginalCvImportInput, OriginalCvImportResult } from '../../shared/original-cv.js'
import { App } from '../app.js'

afterEach(() => {
  cleanup()
})

function createAiWorkerApi(overrides?: Partial<(typeof globalThis.window.cvMaxxing)['aiWorker']>) {
  return {
    getAiWorkerPreflight: vi.fn().mockResolvedValue({
      canResumeGeneration: false,
      message: 'Checking the local AI worker before opening your workspace.',
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
    completePendingGeneration: vi.fn().mockImplementation(() => Promise.resolve()),
    getPendingGenerationCommand: vi.fn().mockResolvedValue(null),
    getTailoredApplicationPreview: vi.fn().mockResolvedValue(null),
    getWorkspaceState: vi.fn().mockResolvedValue({
      activeApplicationId: null,
      applications: [],
    }),
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
    startPendingGeneration: vi.fn().mockResolvedValue({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    }),
    ...overrides,
  }
}

function renderApp({
  aiWorker = createAiWorkerApi(),
  originalCv = createOriginalCvApi(),
  tailoredApplication = createTailoredApplicationApi(),
  vacancy = createVacancyApi(),
}: Partial<typeof globalThis.window.cvMaxxing> = {}) {
  globalThis.window.cvMaxxing = {
    aiWorker,
    originalCv,
    tailoredApplication,
    vacancy,
  }

  render(<App />)
}

test('renders the dedicated checking setup screen before workspace entry', async () => {
  renderApp()

  expect(screen.getByRole('heading', { name: 'Checking the local AI worker' })).toBeDefined()
  expect(screen.getByText('AI worker readiness')).toBeDefined()
  expect(screen.getByText('Checking')).toBeDefined()
  expect(screen.queryByText('AI worker readiness gate')).toBeNull()

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
        message: 'The local AI worker needs a valid sign-in before the workspace can open.',
        provider: 'codex',
        status: 'sign_in_required',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Connect the local AI worker' })).toBeDefined()
  })

  expect(screen.getByText('Sign in required')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Continue sign-in' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open setup guide' })).toBeDefined()
})

test('opens the setup guide from the repair flow', async () => {
  const openAiWorkerSetupGuide = vi.fn().mockImplementation(() => Promise.resolve())

  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: false,
        failureCode: 'runtime_missing',
        message: 'The local AI worker is unavailable. Check setup, then retry.',
        provider: 'codex',
        status: 'unavailable',
      }),
      openAiWorkerSetupGuide,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Repair the local AI worker' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open setup guide' }))

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
        message: 'The local AI worker is unavailable. Check setup, then retry.',
        provider: 'codex',
        status: 'unavailable',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Repair the local AI worker' })).toBeDefined()
  })

  expect(screen.getByText('Unavailable')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Retry check' })).toBeDefined()
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
    expect(screen.getByRole('heading', { name: 'Import your original CV' })).toBeDefined()
  })

  expect(screen.getByText('Add your original CV')).toBeDefined()
  expect(screen.getByText('Drop a PDF or DOCX here or browse')).toBeDefined()
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
    expect(screen.getByRole('heading', { name: 'Import your original CV' })).toBeDefined()
  })

  fireEvent.drop(screen.getByText('Drop a PDF or DOCX here or browse'), {
    dataTransfer: {
      files: [new File(['resume'], 'ada-lovelace.docx')],
    },
  })

  expect(screen.getByText('Selected: ada-lovelace.docx')).toBeDefined()
})

test('imports the first original CV and transitions into the design-aligned workspace-empty screen', async () => {
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
    expect(screen.getByRole('heading', { name: 'Import your original CV' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Original CV file'), {
    target: {
      files: [new File(['%PDF-1.7'], 'ada-lovelace.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Import original CV' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  expect(screen.getByText('Job vacancies')).toBeDefined()
  expect(screen.getByText('No tailored applications yet')).toBeDefined()
  expect(screen.getByRole('button', { name: 'New vacancy' })).toBeDefined()
  expect(screen.getByLabelText('Vacancy URL')).toBeDefined()
  expect(screen.getByLabelText('Job vacancy text')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Review vacancy from URL' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Review pasted vacancy' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Replace original CV' })).toBeDefined()
  expect(screen.getByText('Review a vacancy before adapting')).toBeDefined()
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
      getStartupDestination: vi.fn().mockResolvedValue('workspace_empty'),
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
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  expect(screen.getByText('Active original CV')).toBeDefined()
  expect(screen.getByText('ada-lovelace.pdf')).toBeDefined()
  expect(screen.getByLabelText('Vacancy URL')).toBeDefined()
  expect(screen.getByLabelText('Job vacancy text')).toBeDefined()
  expect(screen.queryByText('Original CV active')).toBeNull()
  expect(screen.getByText('Review a vacancy before adapting')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Replace original CV' })).toBeDefined()
})

test('loads a persisted vacancy preview and keeps Adapt CV enabled for a reviewable draft', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace_empty'),
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
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  expect(screen.getByText('Vacancy preview')).toBeDefined()
  expect(screen.getByText('Senior Product Designer')).toBeDefined()
  expect(screen.getByText('Example Labs · London, United Kingdom')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Adapt CV' })).toHaveProperty('disabled', false)
})

test('replaces the active original CV from the workspace-empty screen and keeps the workspace open', async () => {
  const importOriginalCv = vi.fn(
    (input: OriginalCvImportInput): Promise<OriginalCvImportResult> => {
      void input

      return Promise.resolve({
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
      getStartupDestination: vi.fn().mockResolvedValue('workspace_empty'),
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
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement original CV file'), {
    target: {
      files: [
        new File(['DOCX'], 'ada-lovelace-revised.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Replace original CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
  })

  expect(importOriginalCv.mock.calls[0]?.[0].filename).toBe('ada-lovelace-revised.docx')
  expect(importOriginalCv.mock.calls[0]?.[0].content).toBeInstanceOf(Uint8Array)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  expect(screen.getByText('ada-lovelace-revised.docx')).toBeDefined()
  expect(screen.queryByRole('heading', { name: 'Import your original CV' })).toBeNull()
})

test('replaces the active original CV from the workspace-active screen and keeps the tailored application open', async () => {
  const importOriginalCv = vi.fn(
    (input: OriginalCvImportInput): Promise<OriginalCvImportResult> => {
      void input

      return Promise.resolve({
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
      getStartupDestination: vi.fn().mockResolvedValue('workspace_active'),
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
    expect(screen.getByRole('heading', { name: 'Tailored application' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement original CV file'), {
    target: {
      files: [
        new File(['DOCX'], 'ada-lovelace-revised.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Replace original CV' }))

  await waitFor(() => {
    expect(importOriginalCv).toHaveBeenCalledTimes(1)
  })

  expect(importOriginalCv.mock.calls[0]?.[0].filename).toBe('ada-lovelace-revised.docx')
  expect(importOriginalCv.mock.calls[0]?.[0].content).toBeInstanceOf(Uint8Array)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Tailored application' })).toBeDefined()
  })

  expect(screen.getByText('ada-lovelace-revised.docx')).toBeDefined()
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
      getStartupDestination: vi.fn().mockResolvedValue('workspace_empty'),
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
          code: 'weak_extraction',
          message: 'This original CV could not be read reliably. Use a text-based PDF or DOCX.',
        },
        kind: 'rejected',
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Replacement original CV file'), {
    target: {
      files: [new File(['broken'], 'broken.pdf', { type: 'application/pdf' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Replace original CV' }))

  await waitFor(() => {
    expect(
      screen.getByText(
        'This original CV could not be read reliably. Use a text-based PDF or DOCX.',
      ),
    ).toBeDefined()
  })

  expect(screen.getByText('ada-lovelace.pdf')).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
})

test('reviews a ready vacancy URL and only starts tailoring after Adapt CV is clicked', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace_empty')
    .mockResolvedValueOnce('workspace_loading')
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
    tailoredApplication: createTailoredApplicationApi({
      getPendingGenerationCommand: vi.fn().mockResolvedValue({
        commandId: 'command-123',
        originalCvId: 'original-cv-123',
        originalCvLabel: 'ada-lovelace.pdf',
        vacancyId: 'vacancy-123',
        vacancyDraft: {
          text: '',
          url: 'https://jobs.example.com/roles/123',
        },
      }),
      resumePendingGeneration,
      startPendingGeneration,
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Vacancy URL'), {
    target: {
      value: 'https://jobs.example.com/roles/123',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Review vacancy from URL' }))

  await waitFor(() => {
    expect(globalThis.window.cvMaxxing.vacancy.ingestVacancyUrl).toHaveBeenCalledWith({
      url: 'https://jobs.example.com/roles/123',
    })
  })

  await waitFor(() => {
    expect(screen.getByText('Vacancy preview')).toBeDefined()
  })

  expect(screen.getByRole('button', { name: 'Adapt CV' })).toHaveProperty('disabled', false)

  fireEvent.click(screen.getByRole('button', { name: 'Adapt CV' }))

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
    expect(screen.getByRole('heading', { name: 'Generating tailored application' })).toBeDefined()
  })

  expect(screen.getByRole('button', { name: 'Open tailored application' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Abandon draft' })).toBeDefined()
  expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
})

test('preserves pasted vacancy context in a blocking preview and keeps Adapt CV disabled', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace_empty'),
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
      ingestPastedVacancy: vi.fn().mockResolvedValue({
        kind: 'incomplete',
        vacancy: {
          blockingReason:
            'Add the full job responsibilities or requirements before adapting this CV.',
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
              'Add the full job responsibilities or requirements before adapting this CV.',
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
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Vacancy URL'), {
    target: {
      value: 'https://jobs.example.com/senior-product-designer',
    },
  })
  fireEvent.change(screen.getByLabelText('Job vacancy text'), {
    target: {
      value: 'Short pasted vacancy draft.',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Review pasted vacancy' }))

  await waitFor(() => {
    expect(globalThis.window.cvMaxxing.vacancy.ingestPastedVacancy).toHaveBeenCalledWith({
      text: 'Short pasted vacancy draft.',
      url: 'https://jobs.example.com/senior-product-designer',
    })
  })

  expect(screen.getByText('Vacancy preview')).toBeDefined()
  expect(
    screen.getByText('Add the full job responsibilities or requirements before adapting this CV.'),
  ).toBeDefined()
  expect(screen.getByLabelText('Vacancy URL')).toHaveProperty(
    'value',
    'https://jobs.example.com/senior-product-designer',
  )
  expect(screen.getByLabelText('Job vacancy text')).toHaveProperty(
    'value',
    'Short pasted vacancy draft.',
  )
  expect(screen.getByRole('button', { name: 'Adapt CV' })).toHaveProperty('disabled', true)
})

test('restores the vacancy preview from the internal browser session and re-enables adaptation when browser-assisted extraction succeeds', async () => {
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
      getStartupDestination: vi.fn().mockResolvedValue('workspace_empty'),
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
      ingestVacancyUrl: vi.fn().mockResolvedValue({
        kind: 'incomplete',
        vacancy: {
          blockingReason:
            'Open the internal browser session for authenticated pages, or paste the full job text instead.',
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
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Vacancy URL'), {
    target: {
      value: 'https://www.linkedin.com/jobs/view/123456',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Review vacancy from URL' }))

  await waitFor(() => {
    expect(screen.getByText('Vacancy preview')).toBeDefined()
  })

  expect(
    screen.getByText(
      'Open the internal browser session for authenticated pages, or paste the full job text instead.',
    ),
  ).toBeDefined()
  expect(screen.getByLabelText('Vacancy URL')).toHaveProperty(
    'value',
    'https://www.linkedin.com/jobs/view/123456',
  )
  expect(screen.getByRole('button', { name: 'Adapt CV' })).toHaveProperty('disabled', true)

  fireEvent.click(screen.getByRole('button', { name: 'Open internal browser session' }))

  await waitFor(() => {
    expect(openVacancyBrowserSession).toHaveBeenCalledWith({
      url: 'https://www.linkedin.com/jobs/view/123456',
    })
  })

  await waitFor(() => {
    expect(screen.getByText('Senior Product Designer')).toBeDefined()
  })

  expect(screen.getByRole('button', { name: 'Adapt CV' })).toHaveProperty('disabled', false)
})

test('resumes the pending flow into the design-aligned loading screen after sign-in repair', async () => {
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
      getStartupDestination: vi.fn().mockResolvedValue('workspace_loading'),
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
    expect(screen.getByRole('heading', { name: 'Connect the local AI worker' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Continue sign-in' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Generating tailored application' })).toBeDefined()
  })

  expect(screen.getByText('Tailoring in progress')).toBeDefined()
  expect(screen.getByText('Local AI worker is adapting the CV')).toBeDefined()
  expect(screen.getByText('Senior platform engineer')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open tailored application' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Abandon draft' })).toBeDefined()
  expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
})

test('renders the design-aligned loading screen when startup restores workspace loading', async () => {
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
      getStartupDestination: vi.fn().mockResolvedValue('workspace_loading'),
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
    expect(screen.getByRole('heading', { name: 'Generating tailored application' })).toBeDefined()
  })

  expect(
    screen.getByText(
      'Your vacancy draft stays available here until the tailored application is completed or abandoned.',
    ),
  ).toBeDefined()
  expect(screen.getByText('Local AI worker is adapting the CV')).toBeDefined()
  expect(
    screen.getByText(
      'Truthfulness checks, British English, and style preservation are applied before the PDF previews are created. If setup repair interrupts the run, this screen restores the saved vacancy draft.',
    ),
  ).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open tailored application' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Abandon draft' })).toBeDefined()
})

test('automatically opens the tailored application after generation completes from the loading screen', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace_loading')
    .mockResolvedValueOnce('workspace_active')
  const completePendingGeneration = vi.fn().mockImplementation(() => Promise.resolve())
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
    coverLetter: {
      pageCount: 2,
      pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
      pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      plainText: 'Dear Hiring Manager,\n\nAda Lovelace',
    },
    createdAt: '2026-04-09T09:30:00.000Z',
    employer: 'Example Labs',
    id: 'tailored-application-123',
    title: 'Senior platform engineer · Example Labs',
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
        title: 'Senior platform engineer · Example Labs',
        vacancyTitle: 'Senior platform engineer',
      },
    ],
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
    tailoredApplication: createTailoredApplicationApi({
      completePendingGeneration,
      exportAdaptedCvPdf,
      exportCoverLetterPdf,
      getTailoredApplicationPreview,
      getWorkspaceState,
      resumePendingGeneration,
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
    }),
  })

  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: clipboardWriteText,
    },
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Generating tailored application' })).toBeDefined()
  })

  await waitFor(() => {
    expect(resumePendingGeneration).toHaveBeenCalledTimes(1)
    expect(completePendingGeneration).toHaveBeenCalledWith('command-123')
  })

  await waitFor(() => {
    expect(
      screen.getByRole('heading', { name: 'Senior platform engineer · Example Labs' }),
    ).toBeDefined()
  })

  expect(screen.getByText('Page 1 of 4')).toBeDefined()
  expect(
    screen.getByText('This adapted CV runs to 4 pages. Export is still available.'),
  ).toBeDefined()
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Export PDFs' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Export PDFs' }))

  await waitFor(() => {
    expect(exportAdaptedCvPdf).toHaveBeenCalledWith('tailored-application-123')
  })

  fireEvent.click(screen.getByRole('button', { name: 'Cover letter' }))

  await waitFor(() => {
    expect(
      screen.getByText('This cover letter runs to 2 pages. Export and copy remain available.'),
    ).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Export PDFs' }))
  fireEvent.click(screen.getByRole('button', { name: 'Copy cover letter text' }))

  await waitFor(() => {
    expect(exportCoverLetterPdf).toHaveBeenCalledWith('tailored-application-123')
    expect(clipboardWriteText).toHaveBeenCalledWith('Dear Hiring Manager,\n\nAda Lovelace')
  })
})

test('abandons the pending draft from the loading screen and returns to workspace empty', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace_loading')
    .mockResolvedValueOnce('workspace_empty')
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
    expect(screen.getByRole('heading', { name: 'Generating tailored application' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Abandon draft' }))

  await waitFor(() => {
    expect(abandonPendingGeneration).toHaveBeenCalledTimes(1)
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Create a tailored application' })).toBeDefined()
  })
})
