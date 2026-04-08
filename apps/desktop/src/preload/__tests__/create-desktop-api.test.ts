import { expect, test, vi } from 'vitest'

import {
  AI_WORKER_IPC_CHANNELS,
  ORIGINAL_CV_IPC_CHANNELS,
  VACANCY_IPC_CHANNELS,
} from '../../shared/ipc.js'
import { createDesktopApi } from '../create-desktop-api.js'

test('preload exposes the AI worker onboarding queries and commands over typed IPC', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
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
    })
    .mockResolvedValueOnce('workspace_active')
    .mockImplementationOnce(() => Promise.resolve())
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
    .mockResolvedValueOnce({
      draft: {
        text: '',
        url: '',
      },
      vacancy: null,
    })
    .mockResolvedValueOnce({
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
    })
    .mockResolvedValueOnce({
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
    })
    .mockImplementationOnce(() => Promise.resolve())

  const desktopApi = createDesktopApi({
    invoke,
  })

  await expect(desktopApi.aiWorker.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
  await expect(desktopApi.aiWorker.retryAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: false,
    failureCode: 'runtime_missing',
    message: 'The local AI worker is unavailable. Check setup, then retry.',
    provider: 'codex',
    status: 'unavailable',
  })
  await expect(desktopApi.aiWorker.startAiWorkerSignIn()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
  await expect(desktopApi.aiWorker.getStartupDestination()).resolves.toBe('workspace_active')
  await expect(desktopApi.aiWorker.openAiWorkerSetupGuide()).resolves.toBeUndefined()
  await expect(desktopApi.originalCv.getOriginalCvWorkspaceState()).resolves.toEqual({
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
  await expect(
    desktopApi.originalCv.importOriginalCv({
      content: new Uint8Array([80, 68, 70]),
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
  })
  await expect(desktopApi.vacancy.getVacancyWorkspaceState()).resolves.toEqual({
    draft: {
      text: '',
      url: '',
    },
    vacancy: null,
  })
  await expect(
    desktopApi.vacancy.ingestVacancyUrl({
      url: 'https://boards.greenhouse.io/example/jobs/123',
    }),
  ).resolves.toEqual({
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
  })
  await expect(
    desktopApi.vacancy.ingestPastedVacancy({
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
  })
  await expect(
    desktopApi.vacancy.openVacancyBrowserSession({
      url: 'https://www.linkedin.com/jobs/view/123456',
    }),
  ).resolves.toBeUndefined()

  expect(invoke).toHaveBeenNthCalledWith(1, AI_WORKER_IPC_CHANNELS.getPreflight)
  expect(invoke).toHaveBeenNthCalledWith(2, AI_WORKER_IPC_CHANNELS.retryPreflight)
  expect(invoke).toHaveBeenNthCalledWith(3, AI_WORKER_IPC_CHANNELS.startSignIn)
  expect(invoke).toHaveBeenNthCalledWith(4, AI_WORKER_IPC_CHANNELS.getStartupDestination)
  expect(invoke).toHaveBeenNthCalledWith(5, AI_WORKER_IPC_CHANNELS.openSetupGuide)
  expect(invoke).toHaveBeenNthCalledWith(6, ORIGINAL_CV_IPC_CHANNELS.getWorkspaceState)
  expect(invoke).toHaveBeenNthCalledWith(7, ORIGINAL_CV_IPC_CHANNELS.importOriginalCv, {
    content: new Uint8Array([80, 68, 70]),
    filename: 'ada-lovelace-revised.docx',
  })
  expect(invoke).toHaveBeenNthCalledWith(8, VACANCY_IPC_CHANNELS.getWorkspaceState)
  expect(invoke).toHaveBeenNthCalledWith(9, VACANCY_IPC_CHANNELS.ingestUrl, {
    url: 'https://boards.greenhouse.io/example/jobs/123',
  })
  expect(invoke).toHaveBeenNthCalledWith(10, VACANCY_IPC_CHANNELS.ingestPasted, {
    text: 'Senior Product Designer',
    url: 'https://jobs.example.com/senior-product-designer',
  })
  expect(invoke).toHaveBeenNthCalledWith(11, VACANCY_IPC_CHANNELS.openBrowserSession, {
    url: 'https://www.linkedin.com/jobs/view/123456',
  })
})
