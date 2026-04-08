// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

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

function renderApp({
  aiWorker = createAiWorkerApi(),
  originalCv = createOriginalCvApi(),
  vacancy = createVacancyApi(),
}: Partial<typeof globalThis.window.cvMaxxing> = {}) {
  globalThis.window.cvMaxxing = {
    aiWorker,
    originalCv,
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
  expect(screen.queryByText('Replace original CV')).toBeNull()
  expect(screen.queryByText('Vacancy preview')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Adapt CV' })).toBeNull()
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
  expect(screen.queryByText('Original CV active')).toBeNull()
  expect(screen.queryByText('Vacancy preview')).toBeNull()
  expect(screen.queryByText('Replace original CV')).toBeNull()
})
