import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createAiWorkerReadinessStore } from '../ai-worker-readiness-store.js'
import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js'
import {
  createTailoredApplicationSessionService,
  type TailoredApplicationGenerationResult,
} from '../tailored-application-session-service.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      })
    }),
  )
})

test('assembles structured worker inputs and persists immutable tailored-application artifacts after resume', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const capturedInputs: {
    files: Record<string, string>
    taskJson: string
  }[] = []
  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    generateId: createIdGenerator(['command-123', 'run-123', 'tailored-application-123']),
    getCurrentTimestamp: () => {
      return '2026-04-09T09:30:00.000Z'
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    worker: {
      runGeneration: async ({ runDirectoryPath }) => {
        const inputDirectoryPath = path.join(runDirectoryPath, 'input')
        const files = Object.fromEntries(
          await Promise.all(
            [
              'original-cv.json',
              'original-cv.txt',
              'vacancy.json',
              'vacancy.txt',
              'writing-style-profile.json',
              'task.json',
            ].map(async (filename) => {
              const content = await readFile(path.join(inputDirectoryPath, filename), 'utf8')

              return [filename, content] as const
            }),
          ),
        )
        const taskJson = files['task.json']

        if (taskJson === undefined) {
          throw new Error('Expected task.json to be captured.')
        }

        capturedInputs.push({
          files,
          taskJson,
        })

        return createValidGenerationResult()
      },
    },
  })

  await expect(
    service.startPendingGeneration({
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
  ).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  expect(capturedInputs).toHaveLength(1)
  expect(capturedInputs[0]?.files['original-cv.txt']).toContain(
    'Led product design for AI-assisted desktop tooling.',
  )
  expect(capturedInputs[0]?.files['vacancy.txt']).toContain(
    'Build reliable desktop tooling for technical users.',
  )
  expect(capturedInputs[0]?.taskJson).toContain('"workerMustNotGeneratePdf":true')
  expect(capturedInputs[0]?.taskJson).toContain('"workerMustNotFetchContext":true')

  await expect(
    harness.localAppData.metadata.get({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toMatchObject({
    createdAt: '2026-04-09T09:30:00.000Z',
    originalCvId: 'original-cv-123',
    status: 'ready',
    vacancyId: 'vacancy-123',
  })

  await expect(
    harness.localAppData.artifacts.list({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual([
    'adaptation-summary.json',
    'adapted-cv.json',
    'cover-letter.json',
    'cover-letter.txt',
  ])

  await expect(
    harness.localAppData.artifacts.read({
      id: 'tailored-application-123',
      name: 'cover-letter.txt',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual(Buffer.from(createValidGenerationResult().coverLetterPlainText, 'utf8'))

  await expect(
    stat(path.join(harness.paths.rootDirectoryPath, 'runs', 'run-123')),
  ).rejects.toThrow()
})

test('rejects fabricated output, clears partial artifacts, and resets the pending session', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    generateId: createIdGenerator(['command-123', 'run-123', 'tailored-application-123']),
    getCurrentTimestamp: () => {
      return '2026-04-09T09:30:00.000Z'
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    worker: {
      runGeneration: () => {
        return Promise.resolve({
          ...createValidGenerationResult(),
          adaptedCv: {
            ...createValidGenerationResult().adaptedCv,
            summary: {
              sourceEvidence: [
                'Design leader focused on complex workflow products for technical users.',
              ],
              text: 'Led a team that increased delivery by 300% using Kubernetes.',
            },
          },
        })
      },
    },
  })

  await service.startPendingGeneration({
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  })

  await expect(service.resumePendingGeneration()).rejects.toThrow(
    'Generated tailored application failed validation.',
  )
  await expect(service.getPendingGenerationCommand()).resolves.toBeNull()
  await expect(harness.readinessStore.getStartupDestination()).resolves.toBe('workspace_empty')
  await expect(
    harness.localAppData.metadata.get({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toBeNull()
  await expect(
    stat(path.join(harness.paths.rootDirectoryPath, 'runs', 'run-123')),
  ).rejects.toThrow()
})

test('preserves the underlying generation failure as the thrown error cause', async () => {
  const harness = await createHarness()
  const generationFailure = new Error('disk full')

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    generateId: createIdGenerator(['command-123', 'run-123', 'tailored-application-123']),
    getCurrentTimestamp: () => {
      return '2026-04-09T09:30:00.000Z'
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    worker: {
      runGeneration: () => {
        return Promise.reject(generationFailure)
      },
    },
  })

  await service.startPendingGeneration({
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  })

  await expect(service.resumePendingGeneration()).rejects.toMatchObject({
    cause: generationFailure,
    message: 'Tailored application generation failed.',
  })
})

test('cancels an active generation, removes transient workspaces, and preserves the vacancy workspace', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  let abortSignalTriggered = false
  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    generateId: createIdGenerator(['command-123', 'run-123', 'tailored-application-123']),
    getCurrentTimestamp: () => {
      return '2026-04-09T09:30:00.000Z'
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    worker: {
      runGeneration: async ({ signal }) => {
        return await new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            abortSignalTriggered = true
            reject(new Error('Generation cancelled.'))

            return
          }

          signal.addEventListener('abort', () => {
            abortSignalTriggered = true
            reject(new Error('Generation cancelled.'))
          })
        })
      },
    },
  })

  await service.startPendingGeneration({
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  })

  const resumePromise = service.resumePendingGeneration()

  await mkdir(path.join(harness.paths.rootDirectoryPath, 'runs'), {
    recursive: true,
  })
  await service.abandonPendingGeneration()

  await expect(resumePromise).rejects.toThrow('Generation cancelled.')
  expect(abortSignalTriggered).toBe(true)
  await expect(service.getPendingGenerationCommand()).resolves.toBeNull()
  await expect(
    harness.localAppData.metadata.get({
      id: 'current',
      scope: 'vacancy-workspace',
    }),
  ).resolves.toMatchObject({
    vacancyId: 'vacancy-123',
  })
  await expect(
    stat(path.join(harness.paths.rootDirectoryPath, 'runs', 'run-123')),
  ).rejects.toThrow()
})

test('persists a resumable pending command before sign-in repair and resumes the exact vacancy after readiness succeeds', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const retryAiWorkerPreflight = vi
    .fn()
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      failureCode: 'auth_missing',
      message:
        'The local AI worker needs a valid sign-in before CV Maxxing can resume your tailored application.',
      provider: 'codex',
      status: 'sign_in_required',
    })
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight,
    },
    generateId: createIdGenerator(['command-123', 'run-123', 'tailored-application-123']),
    getCurrentTimestamp: () => {
      return '2026-04-09T09:30:00.000Z'
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    worker: {
      runGeneration: () => Promise.resolve(createValidGenerationResult()),
    },
  })

  await expect(
    service.startPendingGeneration({
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
  ).resolves.toMatchObject({
    canResumeGeneration: true,
    failureCode: 'auth_missing',
    status: 'sign_in_required',
  })

  await expect(service.getPendingGenerationCommand()).resolves.toEqual({
    commandId: 'command-123',
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
    vacancyId: 'vacancy-123',
  })

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })
})

test('cleans interrupted running sessions on startup recovery without deleting the saved vacancy snapshot', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  await harness.readinessStore.savePendingGenerationCommand({
    commandId: 'command-123',
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
    vacancyId: 'vacancy-123',
  })
  await harness.readinessStore.setStartupDestination('workspace_loading')
  await harness.localAppData.metadata.put({
    id: 'active-session',
    scope: 'pending-generation-session',
    value: {
      commandId: 'command-123',
      generationRunId: 'run-123',
      stage: 'running',
      tailoredApplicationId: 'tailored-application-123',
    },
  })
  await harness.localAppData.metadata.put({
    id: 'run-123',
    scope: 'generation-runs',
    value: {
      startedAt: '2026-04-09T09:30:00.000Z',
      status: 'running',
      tailoredApplicationId: 'tailored-application-123',
    },
  })
  await harness.localAppData.metadata.put({
    id: 'tailored-application-123',
    scope: 'tailored-applications',
    value: {
      createdAt: '2026-04-09T09:30:00.000Z',
      originalCvId: 'original-cv-123',
      status: 'generating',
      vacancyId: 'vacancy-123',
    },
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from('{}', 'utf8'),
    id: 'tailored-application-123',
    name: 'adapted-cv.json',
    scope: 'tailored-applications',
  })
  await mkdir(path.join(harness.paths.rootDirectoryPath, 'runs', 'run-123', 'output'), {
    recursive: true,
  })

  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    generateId: createIdGenerator([]),
    getCurrentTimestamp: () => {
      return '2026-04-09T10:00:00.000Z'
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    worker: {
      runGeneration: vi.fn(),
    },
  })

  await expect(service.recoverInterruptedGeneration()).resolves.toBeUndefined()

  await expect(service.getPendingGenerationCommand()).resolves.toBeNull()
  await expect(harness.readinessStore.getStartupDestination()).resolves.toBe('workspace_empty')
  await expect(
    harness.localAppData.metadata.get({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toBeNull()
  await expect(
    harness.localAppData.metadata.get({
      id: 'current',
      scope: 'vacancy-workspace',
    }),
  ).resolves.toMatchObject({
    vacancyId: 'vacancy-123',
  })
  await expect(
    stat(path.join(harness.paths.rootDirectoryPath, 'runs', 'run-123')),
  ).rejects.toThrow()
})

function createIdGenerator(values: string[]) {
  let index = 0

  return () => {
    const value = values[index]

    if (value === undefined) {
      throw new Error('Ran out of deterministic IDs for the test.')
    }

    index += 1

    return value
  }
}

async function createHarness() {
  const rootDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-tailored-application-service-'),
  )

  temporaryDirectories.push(rootDirectoryPath)

  const paths = createLocalAppDataPaths(rootDirectoryPath)
  const localAppData = await openLocalAppData({
    keychain: {
      clearAppDataKey: vi.fn().mockImplementation(() => Promise.resolve()),
      getOrCreateAppDataKey: vi.fn().mockResolvedValue(Buffer.alloc(32, 7)),
    },
    paths,
  })

  return {
    localAppData,
    paths,
    readinessStore: createAiWorkerReadinessStore({
      localAppData,
    }),
  }
}

async function seedOriginalCvAndVacancy(harness: {
  localAppData: Awaited<ReturnType<typeof openLocalAppData>>
}) {
  await harness.localAppData.metadata.put({
    id: 'original-cv-123',
    scope: 'original-cvs',
    value: {
      checksum: 'checksum-123',
      extractedText: [
        'Ada Lovelace',
        'Principal Product Designer',
        'Summary',
        'Design leader focused on complex workflow products for technical users.',
        'Experience',
        'Principal Product Designer | Analytical Engines Ltd',
        'Led product design for AI-assisted desktop tooling.',
        'Skills',
        'Product strategy, UX research, prototyping',
      ].join('\n'),
      fileType: 'pdf',
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      id: 'original-cv-123',
      importedAt: '2026-04-08T14:30:00.000Z',
      isActive: true,
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 1,
      summary: 'Design leader focused on complex workflow products for technical users.',
      writingStyle: {
        averageSentenceLength: 7,
        clicheDetections: ['passionate', 'world-class'],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      JSON.stringify({
        experience: ['Led product design for AI-assisted desktop tooling.'],
        fullName: 'Ada Lovelace',
        headline: 'Principal Product Designer',
        skills: ['Product strategy', 'UX research', 'prototyping'],
        summary: 'Design leader focused on complex workflow products for technical users.',
      }),
      'utf8',
    ),
    id: 'original-cv-123',
    name: 'normalized.json',
    scope: 'original-cvs',
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      [
        'Ada Lovelace',
        'Principal Product Designer',
        'Design leader focused on complex workflow products for technical users.',
        'Led product design for AI-assisted desktop tooling.',
        'Product strategy, UX research, prototyping',
      ].join('\n'),
      'utf8',
    ),
    id: 'original-cv-123',
    name: 'extracted.txt',
    scope: 'original-cvs',
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      JSON.stringify({
        averageSentenceLength: 7,
        clicheDetections: ['passionate', 'world-class'],
        firstPersonUsage: 'absent',
        formality: 'direct',
      }),
      'utf8',
    ),
    id: 'original-cv-123',
    name: 'writing-style-profile.json',
    scope: 'original-cvs',
  })
  await harness.localAppData.metadata.put({
    id: 'vacancy-123',
    scope: 'vacancies',
    value: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-08T21:00:00.000Z',
      inputType: 'pasted_text',
      location: 'London, United Kingdom',
      originalUrl: 'https://jobs.example.com/roles/123',
      requirements: ['Experience shipping workflow software.'],
      resolvedUrl: 'https://jobs.example.com/roles/123',
      responsibilities: ['Build reliable desktop tooling for technical users.'],
      source: 'generic',
      status: 'ready',
      textPreview: 'Build reliable desktop tooling for technical users.',
      title: 'Senior platform engineer',
    },
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      [
        'Senior platform engineer',
        'Example Labs',
        'London, United Kingdom',
        '',
        'Responsibilities',
        '- Build reliable desktop tooling for technical users.',
        '',
        'Requirements',
        '- Experience shipping workflow software.',
      ].join('\n'),
      'utf8',
    ),
    id: 'vacancy-123',
    name: 'extracted.txt',
    scope: 'vacancies',
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      JSON.stringify({
        bodyText: 'Build reliable desktop tooling for technical users.',
        employer: 'Example Labs',
        location: 'London, United Kingdom',
        requirements: ['Experience shipping workflow software.'],
        responsibilities: ['Build reliable desktop tooling for technical users.'],
        title: 'Senior platform engineer',
      }),
      'utf8',
    ),
    id: 'vacancy-123',
    name: 'normalized.json',
    scope: 'vacancies',
  })
  await harness.localAppData.metadata.put({
    id: 'current',
    scope: 'vacancy-workspace',
    value: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
      vacancyId: 'vacancy-123',
    },
  })
}

function createValidGenerationResult(): TailoredApplicationGenerationResult {
  return {
    adaptationSummary: {
      emphasized: [
        {
          sourceEvidence: [
            'Led product design for AI-assisted desktop tooling.',
            'Build reliable desktop tooling for technical users.',
          ],
          text: 'Emphasises desktop workflow design for technical users.',
        },
      ],
      gaps: [
        'The vacancy asks for workflow-software shipping experience; the original CV shows related desktop-tooling design work but does not claim engineering ownership.',
      ],
      omitted: [
        {
          sourceEvidence: ['Product strategy, UX research, prototyping'],
          text: 'Compresses broader research language so the vacancy-specific desktop tooling evidence stays primary.',
        },
      ],
      validationHints: ['Keep interview examples grounded in shipped desktop workflow tooling.'],
    },
    adaptedCv: {
      candidateName: 'Ada Lovelace',
      experienceHighlights: [
        {
          bullets: [
            {
              sourceEvidence: [
                'Led product design for AI-assisted desktop tooling.',
                'Build reliable desktop tooling for technical users.',
              ],
              text: 'Led product design for AI-assisted desktop tooling used by technical teams.',
            },
          ],
          heading: 'Analytical Engines Ltd',
        },
      ],
      headline: {
        sourceEvidence: [
          'Principal Product Designer',
          'Build reliable desktop tooling for technical users.',
        ],
        text: 'Principal Product Designer for desktop workflow products',
      },
      skills: [
        {
          sourceEvidence: ['Product strategy, UX research, prototyping'],
          text: 'Product strategy',
        },
        {
          sourceEvidence: ['Product strategy, UX research, prototyping'],
          text: 'UX research',
        },
      ],
      summary: {
        sourceEvidence: [
          'Design leader focused on complex workflow products for technical users.',
          'Build reliable desktop tooling for technical users.',
        ],
        text: 'Design leader adapting complex desktop workflow products for technical users.',
      },
    },
    coverLetter: {
      body: [
        {
          sourceEvidence: [
            'Led product design for AI-assisted desktop tooling.',
            'Build reliable desktop tooling for technical users.',
          ],
          text: 'I have led product design for AI-assisted desktop tooling, which aligns with your focus on reliable tooling for technical users.',
        },
      ],
      closing: {
        sourceEvidence: ['Design leader focused on complex workflow products for technical users.'],
        text: 'I would welcome the chance to discuss how that experience could support Example Labs.',
      },
      date: '9 April 2026',
      greeting: 'Dear Hiring Manager,',
      opening: {
        sourceEvidence: ['Principal Product Designer', 'Senior platform engineer'],
        text: 'I am applying for the Senior platform engineer role at Example Labs.',
      },
      signature: 'Ada Lovelace',
    },
    coverLetterPlainText: [
      '9 April 2026',
      '',
      'Dear Hiring Manager,',
      '',
      'I am applying for the Senior platform engineer role at Example Labs.',
      '',
      'I have led product design for AI-assisted desktop tooling, which aligns with your focus on reliable tooling for technical users.',
      '',
      'I would welcome the chance to discuss how that experience could support Example Labs.',
      '',
      'Ada Lovelace',
    ].join('\n'),
    trace: {
      model: 'gpt-5.4-codex',
      provider: 'codex',
      sessionId: 'session-123',
    },
  }
}
