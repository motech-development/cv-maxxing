import { expect, test, vi } from 'vitest'

import {
  AI_WORKER_IPC_CHANNELS,
  ORIGINAL_CV_IPC_CHANNELS,
  TAILORED_APPLICATION_IPC_CHANNELS,
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
    .mockResolvedValueOnce('workspace')
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
        skills: ['Product strategy', 'UX research', 'Workflow design'],
        summary: 'Design leader focused on complex workflow products.',
      },
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
    .mockResolvedValueOnce({
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
  await expect(desktopApi.aiWorker.getStartupDestination()).resolves.toBe('workspace')
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
  await expect(desktopApi.originalCv.getActiveOriginalCvDetail()).resolves.toEqual({
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
      skills: ['Product strategy', 'UX research', 'Workflow design'],
      summary: 'Design leader focused on complex workflow products.',
    },
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
  await expect(desktopApi.vacancy.clearVacancyWorkspaceState()).resolves.toBeUndefined()
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
  ).resolves.toEqual({
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

  expect(invoke).toHaveBeenNthCalledWith(1, AI_WORKER_IPC_CHANNELS.getPreflight)
  expect(invoke).toHaveBeenNthCalledWith(2, AI_WORKER_IPC_CHANNELS.retryPreflight)
  expect(invoke).toHaveBeenNthCalledWith(3, AI_WORKER_IPC_CHANNELS.startSignIn)
  expect(invoke).toHaveBeenNthCalledWith(4, AI_WORKER_IPC_CHANNELS.getStartupDestination)
  expect(invoke).toHaveBeenNthCalledWith(5, AI_WORKER_IPC_CHANNELS.openSetupGuide)
  expect(invoke).toHaveBeenNthCalledWith(6, ORIGINAL_CV_IPC_CHANNELS.getWorkspaceState)
  expect(invoke).toHaveBeenNthCalledWith(7, ORIGINAL_CV_IPC_CHANNELS.getActiveDetail)
  expect(invoke).toHaveBeenNthCalledWith(8, ORIGINAL_CV_IPC_CHANNELS.importOriginalCv, {
    content: new Uint8Array([80, 68, 70]),
    filename: 'ada-lovelace-revised.docx',
  })
  expect(invoke).toHaveBeenNthCalledWith(9, VACANCY_IPC_CHANNELS.getWorkspaceState)
  expect(invoke).toHaveBeenNthCalledWith(10, VACANCY_IPC_CHANNELS.clearWorkspaceState)
  expect(invoke).toHaveBeenNthCalledWith(11, VACANCY_IPC_CHANNELS.ingestUrl, {
    url: 'https://boards.greenhouse.io/example/jobs/123',
  })
  expect(invoke).toHaveBeenNthCalledWith(12, VACANCY_IPC_CHANNELS.ingestPasted, {
    text: 'Senior Product Designer',
    url: 'https://jobs.example.com/senior-product-designer',
  })
  expect(invoke).toHaveBeenNthCalledWith(13, VACANCY_IPC_CHANNELS.openBrowserSession, {
    url: 'https://www.linkedin.com/jobs/view/123456',
  })
})

test('preload exposes tailored-application repair and resume commands over typed IPC', async () => {
  const invoke = vi
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
    .mockResolvedValueOnce({
      generationRunId: 'run-123',
      tailoredApplicationId: 'tailored-application-123',
    })
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      failureCode: 'auth_expired',
      message:
        'Your AI sign-in has expired. Sign in again before CV Maxxing can finish your CV and cover letter.',
      provider: 'codex',
      status: 'sign_in_required',
    })
    .mockResolvedValueOnce({
      workspaceState: {
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
      },
    })
    .mockImplementationOnce(() => Promise.resolve())
    .mockImplementationOnce(() => Promise.resolve())
    .mockResolvedValueOnce({
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
    .mockResolvedValueOnce({
      jobs: {
        kind: 'tailored_application',
        tailoredApplicationId: 'tailored-application-123',
      },
      originalCv: {
        kind: 'active_original_cv',
        originalCvId: 'original-cv-123',
      },
      topLevelSection: 'settings',
    })
    .mockResolvedValueOnce({
      adaptedCv: {
        pageCount: 4,
        pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      },
      adaptationSummary: {
        emphasized: [
          {
            text: 'Emphasises workflow-design leadership for the job vacancy.',
          },
        ],
        gaps: ['Add stronger evidence for direct workflow-shipping metrics.'],
        omitted: [
          {
            text: 'Compresses broader communication language to keep the tailored application focused.',
          },
        ],
        validationHints: ['Validate any performance claims against the original CV snapshot.'],
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
      title: 'Senior platform engineer · Example Labs',
      vacancy: {
        blockingReason: null,
        canGenerate: true,
        employer: 'Example Labs',
        fetchedAt: '2026-04-08T21:18:00.000Z',
        id: 'vacancy-123',
        inputType: 'url',
        location: 'London, United Kingdom',
        originalUrl: 'https://jobs.example.com/roles/123',
        requirements: ['Experience shipping workflow software.'],
        resolvedUrl: 'https://jobs.example.com/roles/123',
        responsibilities: ['Lead product design for authenticated desktop workflows.'],
        source: 'linkedin',
        status: 'ready',
        textPreview: 'Lead product design for authenticated desktop workflows.',
        title: 'Senior platform engineer',
      },
      vacancyTitle: 'Senior platform engineer',
    })
    .mockResolvedValueOnce({
      filePath: '/exports/Ada Lovelace - Senior platform engineer - adapted-cv (2).pdf',
      overwriteAvoided: true,
      pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
    })
    .mockResolvedValueOnce({
      filePath: '/exports/Ada Lovelace - Senior platform engineer - cover-letter (2).pdf',
      overwriteAvoided: true,
      pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
    })

  const desktopApi = createDesktopApi({
    invoke,
  })

  await expect(desktopApi.tailoredApplication.getPendingGenerationCommand()).resolves.toEqual({
    commandId: 'command-123',
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyId: 'vacancy-123',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  })
  await expect(desktopApi.tailoredApplication.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })
  await expect(
    desktopApi.tailoredApplication.startPendingGeneration({
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
  ).resolves.toEqual({
    canResumeGeneration: true,
    failureCode: 'auth_expired',
    message:
      'Your AI sign-in has expired. Sign in again before CV Maxxing can finish your CV and cover letter.',
    provider: 'codex',
    status: 'sign_in_required',
  })
  await expect(
    desktopApi.tailoredApplication.completePendingGeneration('command-123'),
  ).resolves.toEqual({
    workspaceState: {
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
    },
  })
  await expect(desktopApi.tailoredApplication.abandonPendingGeneration()).resolves.toBeUndefined()
  await expect(
    desktopApi.tailoredApplication.deleteTailoredApplication('tailored-application-123'),
  ).resolves.toBeUndefined()
  await expect(desktopApi.tailoredApplication.getWorkspaceState()).resolves.toEqual({
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
  await expect(desktopApi.tailoredApplication.getWorkspaceSelection()).resolves.toEqual({
    jobs: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-123',
    },
    originalCv: {
      kind: 'active_original_cv',
      originalCvId: 'original-cv-123',
    },
    topLevelSection: 'settings',
  })
  await expect(
    desktopApi.tailoredApplication.getTailoredApplicationPreview('tailored-application-123'),
  ).resolves.toEqual({
    adaptedCv: {
      pageCount: 4,
      pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    adaptationSummary: {
      emphasized: [
        {
          text: 'Emphasises workflow-design leadership for the job vacancy.',
        },
      ],
      gaps: ['Add stronger evidence for direct workflow-shipping metrics.'],
      omitted: [
        {
          text: 'Compresses broader communication language to keep the tailored application focused.',
        },
      ],
      validationHints: ['Validate any performance claims against the original CV snapshot.'],
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
    title: 'Senior platform engineer · Example Labs',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-08T21:18:00.000Z',
      id: 'vacancy-123',
      inputType: 'url',
      location: 'London, United Kingdom',
      originalUrl: 'https://jobs.example.com/roles/123',
      requirements: ['Experience shipping workflow software.'],
      resolvedUrl: 'https://jobs.example.com/roles/123',
      responsibilities: ['Lead product design for authenticated desktop workflows.'],
      source: 'linkedin',
      status: 'ready',
      textPreview: 'Lead product design for authenticated desktop workflows.',
      title: 'Senior platform engineer',
    },
    vacancyTitle: 'Senior platform engineer',
  })
  await expect(
    desktopApi.tailoredApplication.exportAdaptedCvPdf('tailored-application-123'),
  ).resolves.toEqual({
    filePath: '/exports/Ada Lovelace - Senior platform engineer - adapted-cv (2).pdf',
    overwriteAvoided: true,
    pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
  })
  await expect(
    desktopApi.tailoredApplication.exportCoverLetterPdf('tailored-application-123'),
  ).resolves.toEqual({
    filePath: '/exports/Ada Lovelace - Senior platform engineer - cover-letter (2).pdf',
    overwriteAvoided: true,
    pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
  })

  expect(invoke).toHaveBeenNthCalledWith(1, TAILORED_APPLICATION_IPC_CHANNELS.getPendingGeneration)
  expect(invoke).toHaveBeenNthCalledWith(
    2,
    TAILORED_APPLICATION_IPC_CHANNELS.resumePendingGeneration,
  )
  expect(invoke).toHaveBeenNthCalledWith(
    3,
    TAILORED_APPLICATION_IPC_CHANNELS.startPendingGeneration,
    {
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    },
  )
  expect(invoke).toHaveBeenNthCalledWith(
    4,
    TAILORED_APPLICATION_IPC_CHANNELS.completePendingGeneration,
    {
      commandId: 'command-123',
    },
  )
  expect(invoke).toHaveBeenNthCalledWith(
    5,
    TAILORED_APPLICATION_IPC_CHANNELS.abandonPendingGeneration,
  )
  expect(invoke).toHaveBeenNthCalledWith(6, TAILORED_APPLICATION_IPC_CHANNELS.delete, {
    tailoredApplicationId: 'tailored-application-123',
  })
  expect(invoke).toHaveBeenNthCalledWith(7, TAILORED_APPLICATION_IPC_CHANNELS.getWorkspaceState)
  expect(invoke).toHaveBeenNthCalledWith(8, TAILORED_APPLICATION_IPC_CHANNELS.getWorkspaceSelection)
  expect(invoke).toHaveBeenNthCalledWith(9, TAILORED_APPLICATION_IPC_CHANNELS.getPreview, {
    tailoredApplicationId: 'tailored-application-123',
  })
  expect(invoke).toHaveBeenNthCalledWith(10, TAILORED_APPLICATION_IPC_CHANNELS.exportAdaptedCvPdf, {
    tailoredApplicationId: 'tailored-application-123',
  })
  expect(invoke).toHaveBeenNthCalledWith(
    11,
    TAILORED_APPLICATION_IPC_CHANNELS.exportCoverLetterPdf,
    {
      tailoredApplicationId: 'tailored-application-123',
    },
  )
})

test('preload forwards import-boundary readiness failures without remapping them', async () => {
  const invoke = vi.fn().mockResolvedValue({
    kind: 'ai_worker_not_ready',
    preflight: {
      canResumeGeneration: true,
      failureCode: 'auth_expired',
      message:
        'The local AI worker sign-in has expired. Sign in again before the workspace can open.',
      provider: 'codex',
      status: 'sign_in_required',
    },
  })
  const desktopApi = createDesktopApi({
    invoke,
  })

  await expect(
    desktopApi.originalCv.importOriginalCv({
      content: new Uint8Array([80, 68, 70]),
      filename: 'ada-lovelace.pdf',
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
  })

  expect(invoke).toHaveBeenCalledWith(ORIGINAL_CV_IPC_CHANNELS.importOriginalCv, {
    content: new Uint8Array([80, 68, 70]),
    filename: 'ada-lovelace.pdf',
  })
})
