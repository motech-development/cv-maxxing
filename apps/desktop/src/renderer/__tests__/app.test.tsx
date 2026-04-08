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

test('renders the AI worker readiness gate before unlocking the workspace', async () => {
  globalThis.window.cvMaxxing = {
    aiWorker: createAiWorkerApi(),
    originalCv: createOriginalCvApi(),
    vacancy: createVacancyApi(),
  }

  render(<App />)

  expect(screen.getByRole('heading', { name: 'AI worker setup' })).toBeDefined()
  expect(screen.getByText('AI worker readiness gate')).toBeDefined()
  expect(screen.getByText('Blocked')).toBeDefined()

  await waitFor(() => {
    expect(globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight).toHaveBeenCalledTimes(1)
  })
})

test('restores the saved startup destination after readiness succeeds', async () => {
  globalThis.window.cvMaxxing = {
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('workspace_active'),
    }),
    originalCv: createOriginalCvApi(),
    vacancy: createVacancyApi(),
  }

  render(<App />)

  await waitFor(() => {
    expect(screen.getByText('Unlocked')).toBeDefined()
  })

  expect(screen.getByRole('heading', { name: 'Workspace restored' })).toBeDefined()
  expect(
    screen.getByText('The local AI worker is ready. Restoring your last tailored application.'),
  ).toBeDefined()
  expect(globalThis.window.cvMaxxing.aiWorker.getStartupDestination).toHaveBeenCalledTimes(1)
})

test('retries unavailable startup checks and transitions through the restored destination', async () => {
  globalThis.window.cvMaxxing = {
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: false,
        failureCode: 'runtime_missing',
        message: 'The local AI worker is unavailable. Check setup, then retry.',
        provider: 'codex',
        status: 'unavailable',
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
    vacancy: createVacancyApi(),
  }

  render(<App />)

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Retry check' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Retry check' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Original CV active' })).toBeDefined()
  })

  expect(globalThis.window.cvMaxxing.aiWorker.retryAiWorkerPreflight).toHaveBeenCalledTimes(1)
  expect(screen.getByText('ada-lovelace.pdf')).toBeDefined()
  expect(screen.getByText('1 snapshots stored')).toBeDefined()
})

test('starts provider sign-in repair and resumes the pending tailored application route when auth is restored', async () => {
  globalThis.window.cvMaxxing = {
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
    }),
    originalCv: createOriginalCvApi(),
    vacancy: createVacancyApi(),
  }

  render(<App />)

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Continue sign-in' })).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Continue sign-in' }))

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Resuming tailored application' })).toBeDefined()
  })

  expect(globalThis.window.cvMaxxing.aiWorker.startAiWorkerSignIn).toHaveBeenCalledTimes(1)
  expect(
    screen.getByText('The local AI worker is ready. Resuming your pending tailored application.'),
  ).toBeDefined()
})

test('renders a blocked startup error when the readiness query fails', async () => {
  globalThis.window.cvMaxxing = {
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockRejectedValue(new Error('worker crashed')),
    }),
    originalCv: createOriginalCvApi(),
    vacancy: createVacancyApi(),
  }

  render(<App />)

  await waitFor(() => {
    expect(
      screen.getByText(
        'Unable to complete the AI worker startup check. Restart the app or verify the local AI worker setup.',
      ),
    ).toBeDefined()
  })

  expect(screen.getByText('Blocked')).toBeDefined()
})

test('imports the first original CV after readiness passes and transitions into the workspace view', async () => {
  globalThis.window.cvMaxxing = {
    aiWorker: createAiWorkerApi({
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
      getStartupDestination: vi.fn().mockResolvedValue('first_launch'),
    }),
    originalCv: createOriginalCvApi(),
    vacancy: createVacancyApi(),
  }

  render(<App />)

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
    expect(screen.getByRole('heading', { name: 'Original CV active' })).toBeDefined()
  })

  expect(globalThis.window.cvMaxxing.originalCv.importOriginalCv).toHaveBeenCalledTimes(1)
  expect(screen.getByText('ada-lovelace.pdf')).toBeDefined()
  expect(screen.getByText('1 snapshots stored')).toBeDefined()
})

test('shows the active original CV and supports replacement inside the workspace route', async () => {
  globalThis.window.cvMaxxing = {
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
      }),
    }),
    vacancy: createVacancyApi(),
  }

  render(<App />)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Original CV active' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Original CV file'), {
    target: {
      files: [
        new File(['PK'], 'ada-lovelace-revised.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Replace original CV' }))

  await waitFor(() => {
    expect(screen.getByText('ada-lovelace-revised.docx')).toBeDefined()
  })

  expect(screen.getByText('2 snapshots stored')).toBeDefined()
})

test('fetches a vacancy URL inside the workspace and renders a compact ready preview', async () => {
  globalThis.window.cvMaxxing = {
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
    vacancy: createVacancyApi(),
  }

  render(<App />)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Original CV active' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Job vacancy URL'), {
    target: {
      value: 'https://boards.greenhouse.io/example/jobs/123',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Fetch vacancy' }))

  await waitFor(() => {
    expect(screen.getByText('Senior Product Designer')).toBeDefined()
  })

  expect(globalThis.window.cvMaxxing.vacancy.ingestVacancyUrl).toHaveBeenCalledWith({
    url: 'https://boards.greenhouse.io/example/jobs/123',
  })
  expect(screen.getByText('Greenhouse')).toBeDefined()
  expect(screen.getByText('Example Labs')).toBeDefined()
  expect(screen.getByText('Ready for adaptation')).toBeDefined()
})

test('shows the browser-assisted fallback for blocked LinkedIn vacancy URLs', async () => {
  globalThis.window.cvMaxxing = {
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
    }),
  }

  render(<App />)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Original CV active' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Job vacancy URL'), {
    target: {
      value: 'https://www.linkedin.com/jobs/view/123456',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Fetch vacancy' }))

  await waitFor(() => {
    expect(screen.getByText('Needs browser sign-in')).toBeDefined()
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open internal browser session' }))

  await waitFor(() => {
    expect(globalThis.window.cvMaxxing.vacancy.openVacancyBrowserSession).toHaveBeenCalledWith({
      url: 'https://www.linkedin.com/jobs/view/123456',
    })
  })
  expect(
    screen.getByText(
      'Open the internal browser session for authenticated pages, or paste the full job text instead.',
    ),
  ).toBeDefined()
})

test('submits pasted vacancy text and updates the review preview in the workspace', async () => {
  globalThis.window.cvMaxxing = {
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
    vacancy: createVacancyApi(),
  }

  render(<App />)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Original CV active' })).toBeDefined()
  })

  fireEvent.change(screen.getByLabelText('Reference vacancy URL'), {
    target: {
      value: 'https://jobs.example.com/senior-product-designer',
    },
  })
  fireEvent.change(screen.getByLabelText('Pasted vacancy text'), {
    target: {
      value:
        'Senior Product Designer\nExample Labs\nLondon, United Kingdom\nResponsibilities\nLead product design for AI-assisted desktop workflows.\nRequirements\nStrong written communication.',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Use pasted vacancy text' }))

  await waitFor(() => {
    expect(
      screen.getAllByText('Lead product design for AI-assisted desktop workflows.').length,
    ).toBeGreaterThan(0)
  })

  expect(globalThis.window.cvMaxxing.vacancy.ingestPastedVacancy).toHaveBeenCalledWith({
    text: 'Senior Product Designer\nExample Labs\nLondon, United Kingdom\nResponsibilities\nLead product design for AI-assisted desktop workflows.\nRequirements\nStrong written communication.',
    url: 'https://jobs.example.com/senior-product-designer',
  })
})
