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
  expect(screen.getByRole('button', { name: 'Start tailoring from URL' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Start tailoring from text' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Replace original CV' })).toBeDefined()
  expect(screen.queryByText('Vacancy preview')).toBeNull()
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
  expect(screen.queryByText('Vacancy preview')).toBeNull()
  expect(screen.getByRole('button', { name: 'Replace original CV' })).toBeDefined()
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

test('starts tailoring from a vacancy URL and transitions into the design-aligned loading screen', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace_empty')
    .mockResolvedValueOnce('workspace_loading')
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
        vacancyDraft: {
          text: '',
          url: 'https://jobs.example.com/roles/123',
        },
      }),
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
  fireEvent.click(screen.getByRole('button', { name: 'Start tailoring from URL' }))

  await waitFor(() => {
    expect(startPendingGeneration).toHaveBeenCalledWith({
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyDraft: {
        text: '',
        url: 'https://jobs.example.com/roles/123',
      },
    })
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Generating tailored application' })).toBeDefined()
  })

  expect(screen.getByRole('button', { name: 'Open tailored application' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Abandon draft' })).toBeDefined()
})

test('resumes the pending flow into the design-aligned loading screen after sign-in repair', async () => {
  renderApp({
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
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
        vacancyDraft: {
          text: 'Senior platform engineer',
          url: 'https://jobs.example.com/roles/123',
        },
      }),
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
})

test('renders the design-aligned loading screen when startup restores workspace loading', async () => {
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
        vacancyDraft: {
          text: 'Senior platform engineer',
          url: 'https://jobs.example.com/roles/123',
        },
      }),
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

test('opens the tailored application from the loading screen and restores workspace active', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace_loading')
    .mockResolvedValueOnce('workspace_active')
  const completePendingGeneration = vi.fn().mockImplementation(() => Promise.resolve())

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
      getPendingGenerationCommand: vi.fn().mockResolvedValue({
        commandId: 'command-123',
        originalCvId: 'original-cv-123',
        originalCvLabel: 'ada-lovelace.pdf',
        vacancyDraft: {
          text: 'Senior platform engineer',
          url: 'https://jobs.example.com/roles/123',
        },
      }),
    }),
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Generating tailored application' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open tailored application' }))

  await waitFor(() => {
    expect(completePendingGeneration).toHaveBeenCalledWith('command-123')
  })

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Senior platform engineer' })).toBeDefined()
  })

  expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDefined()
})

test('abandons the pending draft from the loading screen and returns to workspace empty', async () => {
  const getStartupDestination = vi
    .fn()
    .mockResolvedValueOnce('workspace_loading')
    .mockResolvedValueOnce('workspace_empty')
  const abandonPendingGeneration = vi.fn().mockImplementation(() => Promise.resolve())

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
        vacancyDraft: {
          text: 'Senior platform engineer',
          url: 'https://jobs.example.com/roles/123',
        },
      }),
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
