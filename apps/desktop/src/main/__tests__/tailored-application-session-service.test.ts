import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import type {
  AdaptedCvModel,
  TailoredApplicationGenerationResult,
} from '../../shared/tailored-application.js'
import type { NormalizedOriginalCvExperienceEntry } from '../original-cv-normalization-service.js'
import { createAiWorkerReadinessStore } from '../ai-worker-readiness-store.js'
import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js'
import {
  createTailoredApplicationSessionService,
  type AdaptedCvRenderer,
} from '../tailored-application-session-service.js'
import { createWorkspaceSelectionStore } from '../workspace-selection-store.js'

const temporaryDirectories: string[] = []

function createNormalizedOriginalCvExperienceEntry(
  overrides: Partial<NormalizedOriginalCvExperienceEntry> = {},
): NormalizedOriginalCvExperienceEntry {
  return {
    dateRange: '2022 — Present',
    employer: 'Analytical Engines Ltd',
    roleTitle: 'Lead Product Designer',
    summary: 'Led product design for AI-assisted desktop tooling.',
    ...overrides,
  }
}

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
  const renderAdaptedCvPdf = vi.fn<AdaptedCvRenderer['renderAdaptedCvPdf']>().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
  })
  const renderCoverLetterPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf,
    },
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
    adaptedCvPageCount: 1,
    adaptedCvPageWarning: null,
    coverLetterPageCount: 1,
    coverLetterPageWarning: null,
    createdAt: '2026-04-09T09:30:00.000Z',
    employer: 'Example Labs',
    originalCvId: 'original-cv-123',
    status: 'ready',
    vacancyId: 'vacancy-123',
    vacancyTitle: 'Senior platform engineer',
  })

  await expect(
    harness.localAppData.artifacts.list({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual([
    'adaptation-summary.json',
    'adapted-cv.json',
    'adapted-cv.pdf',
    'cover-letter.json',
    'cover-letter.pdf',
    'cover-letter.txt',
  ])

  expect(renderAdaptedCvPdf).toHaveBeenCalledTimes(1)

  const renderAdaptedCvCall = renderAdaptedCvPdf.mock.calls[0]

  if (renderAdaptedCvCall === undefined) {
    throw new Error('Expected the adapted-CV renderer to be called.')
  }

  expect(renderAdaptedCvCall[0]).toMatchObject({
    adaptedCv: {
      candidateName: 'Ada Lovelace',
      header: {
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: 'ada-lovelace.dev',
        },
        intro: {
          text: 'Design leader shaping truthful desktop workflow products for technical users.',
        },
      },
    },
    employer: 'Example Labs',
    vacancyTitle: 'Senior platform engineer',
  })
  expect(renderCoverLetterPdf).toHaveBeenCalledWith({
    coverLetter: createValidGenerationResult().coverLetter,
    employer: 'Example Labs',
    vacancyTitle: 'Senior platform engineer',
  })

  await expect(
    harness.localAppData.artifacts.read({
      id: 'tailored-application-123',
      name: 'cover-letter.txt',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual(
    Buffer.from(
      buildExpectedCoverLetterPlainText(createValidGenerationResult().coverLetter),
      'utf8',
    ),
  )

  await expect(
    stat(path.join(harness.paths.rootDirectoryPath, 'runs', 'run-123')),
  ).rejects.toThrow()
})

test('renders adapted-CV header contact from the stored normalized original CV instead of reparsing extracted text', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      [
        'Ada Lovelace',
        'Principal Product Designer',
        'mo.gusbi@motechdevelopment.co.uk',
        'Summary',
        'Design leader focused on complex workflow products for technical users.',
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
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: 'ada-lovelace.dev',
        },
        experience: [
          createNormalizedOriginalCvExperienceEntry({
            dateRange: '',
            employer: '',
            roleTitle: '',
          }),
        ],
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

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
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
        return Promise.resolve(createValidGenerationResult())
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
  await service.resumePendingGeneration()

  expect(renderAdaptedCvPdf).toHaveBeenCalledTimes(1)

  const renderAdaptedCvCalls = renderAdaptedCvPdf.mock.calls as Parameters<
    AdaptedCvRenderer['renderAdaptedCvPdf']
  >[]
  const renderAdaptedCvInput = renderAdaptedCvCalls[0]?.[0]

  expect(renderAdaptedCvInput?.employer).toBe('Example Labs')
  expect(renderAdaptedCvInput?.vacancyTitle).toBe('Senior platform engineer')
  expect(renderAdaptedCvInput?.adaptedCv.header.contact).toEqual({
    email: 'ada@lovelace.dev',
    location: 'London, United Kingdom',
    phone: '+44 7700 900123',
    professionalLink: 'ada-lovelace.dev',
  })
  expect(renderAdaptedCvInput?.adaptedCv.header.intro).toEqual({
    text: 'Design leader shaping truthful desktop workflow products for technical users.',
  })
})

test('preserves optional adapted-CV sections through rendering and artifact persistence', async () => {
  const harness = await createHarness()
  const expectedOptionalSections = [
    {
      items: [
        {
          text: 'AWS',
        },
        {
          text: 'Docker',
        },
      ],
      kind: 'tools' as const,
    },
    {
      items: [
        {
          text: 'Reduced a fragile daily import process from 2 hours to 30 minutes while improving reliability.',
        },
      ],
      kind: 'impact_highlights' as const,
    },
  ]

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
  })

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              ...result.adaptedCv.sections.slice(0, -1),
              ...expectedOptionalSections,
              result.adaptedCv.sections.at(-1) ?? {
                kind: 'references',
              },
            ],
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

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  const renderedAdaptedCvInput = renderAdaptedCvPdf.mock.calls.at(0)?.[0] as
    | {
        adaptedCv: Pick<TailoredApplicationGenerationResult['adaptedCv'], 'sections'>
      }
    | undefined

  expect(renderedAdaptedCvInput).toBeDefined()
  expect(renderedAdaptedCvInput?.adaptedCv.sections).toEqual(
    expect.arrayContaining(expectedOptionalSections),
  )

  const persistedAdaptedCvBuffer = await harness.localAppData.artifacts.read({
    id: 'tailored-application-123',
    name: 'adapted-cv.json',
    scope: 'tailored-applications',
  })

  expect(persistedAdaptedCvBuffer).not.toBeNull()
  const persistedAdaptedCv = JSON.parse(persistedAdaptedCvBuffer?.toString('utf8') ?? '{}') as Pick<
    TailoredApplicationGenerationResult['adaptedCv'],
    'sections'
  >

  expect(persistedAdaptedCv.sections).toEqual(expect.arrayContaining(expectedOptionalSections))
})

test('persists the renderer-applied adapted CV when sidebar fit omits optional items', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi
    .fn<AdaptedCvRenderer['renderAdaptedCvPdf']>()
    .mockImplementation(({ adaptedCv }) => {
      const toolsSection = adaptedCv.sections.find((section) => {
        return section.kind === 'tools'
      })

      if (toolsSection?.kind !== 'tools') {
        throw new Error('Expected tools to be present in the adapted CV fixture.')
      }

      return Promise.resolve({
        appliedAdaptedCv: {
          ...adaptedCv,
          sections: adaptedCv.sections.map((section: AdaptedCvModel['sections'][number]) => {
            if (section.kind !== 'tools') {
              return section
            }

            return {
              ...section,
              items: section.items.slice(0, 1),
            }
          }),
        },
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      })
    })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              ...result.adaptedCv.sections.slice(0, -1),
              {
                items: [
                  {
                    text: 'Figma',
                  },
                  {
                    text: 'FigJam',
                  },
                ],
                kind: 'tools',
              },
              result.adaptedCv.sections.at(-1) ?? {
                kind: 'references',
              },
            ],
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

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  const persistedAdaptedCvBuffer = await harness.localAppData.artifacts.read({
    id: 'tailored-application-123',
    name: 'adapted-cv.json',
    scope: 'tailored-applications',
  })

  expect(persistedAdaptedCvBuffer).not.toBeNull()
  const persistedAdaptedCv = JSON.parse(persistedAdaptedCvBuffer?.toString('utf8') ?? '{}') as Pick<
    TailoredApplicationGenerationResult['adaptedCv'],
    'sections'
  >
  const persistedToolsSection = persistedAdaptedCv.sections.find((section) => {
    return section.kind === 'tools'
  })

  expect(persistedToolsSection).toEqual({
    items: [
      {
        text: 'Figma',
      },
    ],
    kind: 'tools',
  })
})

test('passes derived original-CV normalization artifacts through to the tailored-application worker unchanged', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.metadata.put({
    id: 'original-cv-123',
    scope: 'original-cvs',
    value: {
      checksum: 'checksum-123',
      extractedText: [
        'Ada Lovelace',
        'London, United Kingdom',
        'Profile',
        'Product design leader for technical workflow tooling and regulated content systems.',
        'Career Highlights',
        'Analytical Engines Ltd',
        'Led product design for AI-assisted desktop tooling across import and export flows.',
        'Difference Engines Ltd',
        'Built content systems and UX research practices for complex workflow products.',
        'Core Skills',
        'Workflow design, UX research, content systems',
      ].join('\n'),
      fileType: 'pdf',
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      id: 'original-cv-123',
      importedAt: '2026-04-08T14:30:00.000Z',
      isActive: true,
      originalFilename: 'ada-lovelace-variant.pdf',
      pageCount: 1,
      summary:
        'Design leader shaping truthful workflow products for technical users and regulated content teams.',
      writingStyle: {
        averageSentenceLength: 14,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'formal',
      },
    },
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      JSON.stringify({
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: 'ada-lovelace.dev',
        },
        experience: [
          createNormalizedOriginalCvExperienceEntry({
            summary:
              'Led product design for AI-assisted desktop tooling across import and export flows.',
          }),
        ],
        fullName: 'Ada Lovelace',
        headline: 'Principal Product Designer',
        skills: ['Workflow design', 'UX research', 'Content systems'],
        summary:
          'Design leader shaping truthful workflow products for technical users and regulated content teams.',
      }),
      'utf8',
    ),
    id: 'original-cv-123',
    name: 'normalized.json',
    scope: 'original-cvs',
  })

  const capturedOriginalCvJson: string[] = []
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      }),
    },
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
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
        capturedOriginalCvJson.push(
          await readFile(path.join(runDirectoryPath, 'input', 'original-cv.json'), 'utf8'),
        )

        return createValidGenerationResult()
      },
    },
  })

  await service.startPendingGeneration({
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace-variant.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  })
  await service.resumePendingGeneration()

  expect(capturedOriginalCvJson).toEqual([
    JSON.stringify({
      contact: {
        email: 'ada@lovelace.dev',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'ada-lovelace.dev',
      },
      experience: [
        createNormalizedOriginalCvExperienceEntry({
          summary:
            'Led product design for AI-assisted desktop tooling across import and export flows.',
        }),
      ],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Workflow design', 'UX research', 'Content systems'],
      summary:
        'Design leader shaping truthful workflow products for technical users and regulated content teams.',
    }),
  ])
})

test('bounds oversized original-CV and vacancy extracted text before invoking the tailored-generation worker', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.artifacts.write({
    content: Buffer.from(`Ada Lovelace\nPrincipal Product Designer\n${'A'.repeat(40_000)}`, 'utf8'),
    id: 'original-cv-123',
    name: 'extracted.txt',
    scope: 'original-cvs',
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      `Full Stack Engineer | TypeScript, React, Node.js, AWS\n${'B'.repeat(40_000)}`,
      'utf8',
    ),
    id: 'vacancy-123',
    name: 'extracted.txt',
    scope: 'vacancies',
  })

  const capturedInputTexts: {
    originalCvText: string
    vacancyText: string
  }[] = []

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      }),
    },
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
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
        capturedInputTexts.push({
          originalCvText: await readFile(
            path.join(runDirectoryPath, 'input', 'original-cv.txt'),
            'utf8',
          ),
          vacancyText: await readFile(path.join(runDirectoryPath, 'input', 'vacancy.txt'), 'utf8'),
        })

        return createValidGenerationResult()
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
  await service.resumePendingGeneration()

  expect(capturedInputTexts).toHaveLength(1)
  expect(capturedInputTexts[0]?.originalCvText.length).toBeLessThanOrEqual(24_000)
  expect(capturedInputTexts[0]?.vacancyText.length).toBeLessThanOrEqual(24_000)
  expect(capturedInputTexts[0]?.originalCvText.startsWith('Ada Lovelace')).toBe(true)
  expect(capturedInputTexts[0]?.vacancyText.startsWith('Full Stack Engineer')).toBe(true)
})

test('keeps existing original CV snapshots unavailable when required artifacts are missing instead of repairing them', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.deleteScopedData({
    id: 'original-cv-123',
    scope: 'original-cvs',
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      [
        'Ada Lovelace',
        'Principal Product Designer',
        'Summary',
        'Design leader focused on complex workflow products for technical users.',
      ].join('\n'),
      'utf8',
    ),
    id: 'original-cv-123',
    name: 'extracted.txt',
    scope: 'original-cvs',
  })

  const runGeneration = vi.fn()
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn(),
    },
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn(),
    },
    generateId: createIdGenerator(['command-123', 'run-123', 'tailored-application-123']),
    getCurrentTimestamp: () => {
      return '2026-04-09T09:30:00.000Z'
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    worker: {
      runGeneration,
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

  await expect(service.resumePendingGeneration()).rejects.toThrow("We couldn't load your CV.")
  await expect(
    harness.localAppData.artifacts.read({
      id: 'original-cv-123',
      name: 'normalized.json',
      scope: 'original-cvs',
    }),
  ).resolves.toBeNull()
  expect(runGeneration).not.toHaveBeenCalled()
})

test('returns both PDF artifacts in the preview payload and exports the cover-letter PDF with overwrite avoidance', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const exportDialog = {
    showSaveDialog: vi.fn().mockResolvedValue({
      canceled: false,
      filePath: path.join(harness.paths.rootDirectoryPath, 'exports', 'cover-letter.pdf'),
    }),
  }
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 4,
        pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 2,
        pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
      }),
    },
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    exportDialog,
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

  await service.startPendingGeneration({
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  })
  await service.resumePendingGeneration()
  await mkdir(path.join(harness.paths.rootDirectoryPath, 'exports'), {
    recursive: true,
  })
  await writeFile(
    path.join(harness.paths.rootDirectoryPath, 'exports', 'cover-letter.pdf'),
    'existing',
    'utf8',
  )

  await expect(service.getTailoredApplicationPreview('tailored-application-123')).resolves.toEqual({
    adaptedCv: {
      pageCount: 4,
      pageWarning: 'This adapted CV runs to 4 pages. Export is still available.',
      pdfBytes: new Uint8Array(Buffer.from('%PDF-1.7 adapted cv', 'utf8')),
    },
    adaptationSummary: createValidGenerationResult().adaptationSummary,
    coverLetter: {
      pageCount: 2,
      pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
      pdfBytes: new Uint8Array(Buffer.from('%PDF-1.7 cover letter', 'utf8')),
      plainText: buildExpectedCoverLetterPlainText(createValidGenerationResult().coverLetter),
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
      summary: 'Design leader focused on complex workflow products for technical users.',
      writingStyle: {
        averageSentenceLength: 7,
        clicheDetections: ['passionate', 'world-class'],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
    title: 'Senior platform engineer · Example Labs',
    vacancy: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-08T21:00:00.000Z',
      id: 'vacancy-123',
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
    vacancyTitle: 'Senior platform engineer',
  })
  await expect(service.exportCoverLetterPdf('tailored-application-123')).resolves.toEqual({
    filePath: path.join(harness.paths.rootDirectoryPath, 'exports', 'cover-letter (2).pdf'),
    overwriteAvoided: true,
    pageWarning: 'This cover letter runs to 2 pages. Export and copy remain available.',
  })
})

test('uses a consumer-friendly saved-job fallback title when vacancy metadata is incomplete', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
      }),
    },
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
      runGeneration: () => Promise.resolve(createValidGenerationResult()),
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
  await service.resumePendingGeneration()

  await harness.localAppData.metadata.put({
    id: 'tailored-application-123',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 1,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-09T09:30:00.000Z',
      employer: null,
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: null,
    },
  })

  await expect(service.getWorkspaceState()).resolves.toEqual({
    activeApplicationId: null,
    applications: [
      {
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: null,
        id: 'tailored-application-123',
        pageCount: 1,
        pageWarning: null,
        title: 'Saved job',
        vacancyTitle: null,
      },
    ],
  })

  await expect(
    service.getTailoredApplicationPreview('tailored-application-123'),
  ).resolves.toMatchObject({
    employer: null,
    title: 'Saved job',
    vacancyTitle: null,
  })

  await harness.localAppData.metadata.put({
    id: 'tailored-application-123',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 1,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-09T09:30:00.000Z',
      employer: 'Example Labs',
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: null,
    },
  })

  await expect(service.getWorkspaceState()).resolves.toEqual({
    activeApplicationId: null,
    applications: [
      {
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
        pageCount: 1,
        pageWarning: null,
        title: 'Saved job · Example Labs',
        vacancyTitle: null,
      },
    ],
  })

  await expect(
    service.getTailoredApplicationPreview('tailored-application-123'),
  ).resolves.toMatchObject({
    employer: 'Example Labs',
    title: 'Saved job · Example Labs',
    vacancyTitle: null,
  })
})

test('deletes a tailored application without removing original CV or job vacancy snapshots used elsewhere', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.metadata.put({
    id: 'tailored-application-456',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 2,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-09T10:00:00.000Z',
      employer: 'Example Labs',
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: 'Senior platform engineer',
    },
  })
  await harness.localAppData.metadata.put({
    id: 'run-456',
    scope: 'generation-runs',
    value: {
      finishedAt: '2026-04-09T10:05:00.000Z',
      provider: 'codex',
      startedAt: '2026-04-09T10:00:00.000Z',
      status: 'ready',
      tailoredApplicationId: 'tailored-application-456',
    },
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from('{}', 'utf8'),
    id: 'tailored-application-456',
    name: 'adapted-cv.json',
    scope: 'tailored-applications',
  })

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn(),
    },
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn(),
    },
    generateId: createIdGenerator([]),
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    worker: {
      runGeneration: vi.fn(),
    },
  })

  await expect(
    service.deleteTailoredApplication('tailored-application-456'),
  ).resolves.toBeUndefined()

  await expect(
    harness.localAppData.metadata.get({
      id: 'tailored-application-456',
      scope: 'tailored-applications',
    }),
  ).resolves.toBeNull()
  await expect(
    harness.localAppData.metadata.get({
      id: 'run-456',
      scope: 'generation-runs',
    }),
  ).resolves.toBeNull()
  await expect(
    harness.localAppData.artifacts.list({
      id: 'tailored-application-456',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual([])
  await expect(
    harness.localAppData.metadata.get({
      id: 'original-cv-123',
      scope: 'original-cvs',
    }),
  ).resolves.toMatchObject({
    originalFilename: 'ada-lovelace.pdf',
  })
  await expect(
    harness.localAppData.metadata.get({
      id: 'vacancy-123',
      scope: 'vacancies',
    }),
  ).resolves.toMatchObject({
    title: 'Senior platform engineer',
  })
})

test('returns null when a saved adaptation summary artifact is malformed', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      }),
    },
    aiWorker: {
      retryAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
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
      runGeneration: () => Promise.resolve(createValidGenerationResult()),
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
  await service.resumePendingGeneration()
  await harness.localAppData.artifacts.write({
    content: Buffer.from('{invalid json', 'utf8'),
    id: 'tailored-application-123',
    name: 'adaptation-summary.json',
    scope: 'tailored-applications',
  })

  await expect(
    service.getTailoredApplicationPreview('tailored-application-123'),
  ).resolves.toBeNull()
})

test('accepts adapted output without numeric truthfulness validation', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
            sections: [
              {
                kind: 'profile',
                summary: {
                  text: 'Led a team that increased delivery by 300% using Kubernetes.',
                },
              },
              ...createValidGenerationResult().adaptedCv.sections.slice(1),
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })
  await expect(
    harness.localAppData.metadata.get({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toMatchObject({
    status: 'ready',
  })
  await expect(
    stat(path.join(harness.paths.rootDirectoryPath, 'runs', 'run-123')),
  ).rejects.toThrow()
})

test('rejects generation output when the JSON contract shape is invalid', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            headline: {} as never,
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    detail: 'Expected adaptedCv.headline.text to be a string.',
    path: 'adaptedCv',
  })
  await expect(resumePromise).rejects.toThrow(
    "We couldn't finish your CV and cover letter. Try tailoring this job again.",
  )
})

test('rejects adapted output when structured experience semantics are incomplete', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()
        const [profileSection] = result.adaptedCv.sections

        if (profileSection === undefined) {
          throw new Error('Expected the profile section to exist in the test fixture.')
        }

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              profileSection,
              {
                items: [{} as never],
                kind: 'experience',
              },
              ...result.adaptedCv.sections.slice(2),
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    detail: 'Expected adaptedCv.sections[1] to match the section contract.',
    path: 'adaptedCv',
  })
})

test('normalizes a stacked vacancy-style headline to the role name before rendering and persistence', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
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
      title: 'Full Stack Engineer | TypeScript, React, Node.js, AWS',
    },
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      JSON.stringify({
        bodyText: 'Build reliable desktop tooling for technical users.',
        employer: 'Example Labs',
        location: 'London, United Kingdom',
        requirements: ['Experience shipping workflow software.'],
        responsibilities: ['Build reliable desktop tooling for technical users.'],
        title: 'Full Stack Engineer | TypeScript, React, Node.js, AWS',
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
      text: 'Full Stack Engineer | TypeScript, React, Node.js, AWS',
      url: 'https://jobs.example.com/roles/123',
      vacancyId: 'vacancy-123',
    },
  })

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            headline: {
              text: 'Full Stack Engineer | TypeScript, React, Node.js, AWS',
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
      text: 'Full Stack Engineer | TypeScript, React, Node.js, AWS',
      url: 'https://jobs.example.com/roles/123',
    },
  })

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  const renderAdaptedCvCall = renderAdaptedCvPdf.mock.calls[0]

  if (renderAdaptedCvCall === undefined) {
    throw new Error('Expected the adapted-CV renderer to be called.')
  }

  expect(renderAdaptedCvCall[0]).toMatchObject({
    adaptedCv: {
      headline: {
        text: 'Full Stack Engineer',
      },
    },
    employer: 'Example Labs',
    vacancyTitle: 'Full Stack Engineer | TypeScript, React, Node.js, AWS',
  })

  await expect(
    harness.localAppData.artifacts.read({
      id: 'tailored-application-123',
      name: 'adapted-cv.json',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual(expect.any(Buffer))

  const persistedAdaptedCvBuffer = await harness.localAppData.artifacts.read({
    id: 'tailored-application-123',
    name: 'adapted-cv.json',
    scope: 'tailored-applications',
  })

  expect(persistedAdaptedCvBuffer).not.toBeNull()
  expect(JSON.parse(persistedAdaptedCvBuffer?.toString('utf8') ?? '{}')).toMatchObject({
    headline: {
      text: 'Full Stack Engineer',
    },
  })
})

test('normalizes a slash-separated vacancy-style headline to the role name before rendering', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
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
      title: 'Full Stack Engineer',
    },
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      JSON.stringify({
        bodyText: 'Build reliable desktop tooling for technical users.',
        employer: 'Example Labs',
        location: 'London, United Kingdom',
        requirements: ['Experience shipping workflow software.'],
        responsibilities: ['Build reliable desktop tooling for technical users.'],
        title: 'Full Stack Engineer',
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
      text: 'Full Stack Engineer',
      url: 'https://jobs.example.com/roles/123',
      vacancyId: 'vacancy-123',
    },
  })

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            headline: {
              text: 'Full Stack Engineer / TypeScript, React, Node.js',
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
      text: 'Full Stack Engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  })

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  const renderAdaptedCvCall = renderAdaptedCvPdf.mock.calls[0]

  if (renderAdaptedCvCall === undefined) {
    throw new Error('Expected the adapted-CV renderer to be called.')
  }

  expect(renderAdaptedCvCall[0]).toMatchObject({
    adaptedCv: {
      headline: {
        text: 'Full Stack Engineer',
      },
    },
  })
})

test('persists raw generation output and validation details when required sections are omitted', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: result.adaptedCv.sections.filter((section) => {
              return section.kind === 'profile' || section.kind === 'references'
            }),
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    detail:
      'Expected adaptedCv.sections to include experience, core_skills. Received sections: profile, references.',
    path: 'adaptedCv',
  })

  await expect(
    harness.localAppData.artifacts.read({
      id: 'run-123',
      name: 'contract-validation-error.json',
      scope: 'generation-runs',
    }),
  ).resolves.toEqual(
    Buffer.from(
      JSON.stringify({
        code: 'adapted_cv_invalid',
        detail:
          'Expected adaptedCv.sections to include experience, core_skills. Received sections: profile, references.',
        invalidSection: null,
        invalidSectionIndex: null,
        path: 'adaptedCv',
      }),
      'utf8',
    ),
  )

  const rawGenerationResultBuffer = await harness.localAppData.artifacts.read({
    id: 'run-123',
    name: 'raw-generation-result.json',
    scope: 'generation-runs',
  })

  expect(rawGenerationResultBuffer).not.toBeNull()
  const rawGenerationResult = JSON.parse(rawGenerationResultBuffer?.toString('utf8') ?? '{}') as {
    adaptedCv?: {
      sections?: {
        kind?: string
      }[]
    }
  }

  expect(rawGenerationResult.adaptedCv?.sections).toMatchObject([
    {
      kind: 'profile',
    },
    {
      kind: 'references',
    },
  ])
})

test('rejects adapted output when it omits source experience roles from the original CV chronology', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      JSON.stringify({
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: 'ada-lovelace.dev',
        },
        experience: [
          createNormalizedOriginalCvExperienceEntry(),
          createNormalizedOriginalCvExperienceEntry({
            dateRange: 'January 2016 - November 2017',
            employer: 'Leighton',
            roleTitle: 'Web Developer',
            summary: 'Built product delivery workflows for client platforms.',
          }),
          createNormalizedOriginalCvExperienceEntry({
            dateRange: 'October 2014 - April 2015',
            employer: 'Leighton',
            roleTitle: 'Web Developer',
            summary: 'Created and maintained website components for editors.',
          }),
        ],
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

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()
        const [profileSection, experienceSection] = result.adaptedCv.sections

        if (profileSection === undefined || experienceSection?.kind !== 'experience') {
          throw new Error(
            'Expected the profile and experience sections to exist in the test fixture.',
          )
        }

        const [firstExperienceItem] = experienceSection.items

        if (firstExperienceItem === undefined) {
          throw new Error('Expected at least one experience item in the test fixture.')
        }

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              profileSection,
              {
                ...experienceSection,
                items: [
                  firstExperienceItem,
                  {
                    bullets: [
                      {
                        text: 'Built product delivery workflows for client platforms.',
                      },
                    ],
                    dateRange: 'January 2016 - November 2017',
                    employer: 'Leighton',
                    location: 'London',
                    roleTitle: 'Web Developer',
                  },
                ],
              },
              ...result.adaptedCv.sections.slice(2),
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    detail:
      'Expected adaptedCv.sections experience items to retain every source role from originalCv.experience. Missing: Web Developer | Leighton | October 2014 - April 2015.',
    path: 'adaptedCv',
  })
})

test('accepts adapted output when source experience entries are stored as single-line summaries', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      JSON.stringify({
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: 'ada-lovelace.dev',
        },
        experience: [
          createNormalizedOriginalCvExperienceEntry({
            summary:
              'Led product design for AI-assisted desktop tooling across import and export flows.',
          }),
        ],
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

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        return Promise.resolve(createValidGenerationResult())
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

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })
  expect(renderAdaptedCvPdf).toHaveBeenCalledTimes(1)
})

test('rejects adapted output when the headline is not a canonical role label', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            headline: {
              text: 'Distributed Systems Builder',
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    path: 'adaptedCv',
  })
  await expect(resumePromise).rejects.toThrow(
    "We couldn't finish your CV and cover letter. Try tailoring this job again.",
  )
})

test('rejects adapted output when capped sidebar sections exceed their contract limits', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              ...result.adaptedCv.sections,
              {
                items: Array.from({ length: 4 }, (_, index) => {
                  return {
                    text: `Language ${String(index + 1)}`,
                  }
                }),
                kind: 'languages',
              },
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    path: 'adaptedCv',
  })
})

test('rejects adapted output when core skills degrade into sentence-like sidebar content', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()
        const profileSection = result.adaptedCv.sections[0]
        const experienceSection = result.adaptedCv.sections[1]

        if (profileSection === undefined || experienceSection === undefined) {
          throw new Error('Expected mandatory profile and experience sections in the fixture.')
        }

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              profileSection,
              experienceSection,
              {
                items: [
                  {
                    text: 'Built backend microservices for notifications, forms and meeting booking to reduce duplication across services.',
                  },
                ],
                kind: 'core_skills',
              },
              ...result.adaptedCv.sections.slice(3),
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    detail:
      'Expected adaptedCv.sections[2] core_skills items to be concise sidebar labels rather than sentence-like content.',
    path: 'adaptedCv',
  })
  expect(renderAdaptedCvPdf).not.toHaveBeenCalled()
})

test('rejects adapted output when selected work degrades into bare tool labels', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              ...result.adaptedCv.sections.slice(0, 2),
              {
                items: [
                  {
                    text: 'AWS',
                  },
                  {
                    text: 'Docker',
                  },
                ],
                kind: 'selected_work',
              },
              ...result.adaptedCv.sections.slice(2),
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    detail:
      'Expected adaptedCv.sections[2] selected_work items to contain grounded evidence lines rather than bare skill or tool labels.',
    path: 'adaptedCv',
  })
  expect(renderAdaptedCvPdf).not.toHaveBeenCalled()
})

test('rejects adapted output when tools duplicate core skills', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              ...result.adaptedCv.sections.slice(0, -1),
              {
                items: [
                  {
                    text: 'Product strategy',
                  },
                  {
                    text: 'Figma',
                  },
                ],
                kind: 'tools',
              },
              result.adaptedCv.sections.at(-1) ?? {
                kind: 'references',
              },
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    detail:
      'Expected adaptedCv tools items to avoid duplicating core_skills entries. Overlap: Product strategy.',
    path: 'adaptedCv',
  })
  expect(renderAdaptedCvPdf).not.toHaveBeenCalled()
})

test('rejects grouped tool labels so Codex must return ungrouped tool items', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              ...result.adaptedCv.sections.slice(0, -1),
              {
                items: [
                  {
                    text: 'NoSQL databases (MongoDB, AWS DynamoDB)',
                  },
                  {
                    text: 'Serverless Framework',
                  },
                ],
                kind: 'tools',
              },
              result.adaptedCv.sections.at(-1) ?? {
                kind: 'references',
              },
            ],
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

  await expect(service.resumePendingGeneration()).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    detail: 'Expected adaptedCv.sections[3] tools items to be concise ungrouped sidebar labels.',
    path: 'adaptedCv',
  })

  await expect(
    harness.localAppData.artifacts.read({
      id: 'run-123',
      name: 'contract-validation-error.json',
      scope: 'generation-runs',
    }),
  ).resolves.toEqual(
    Buffer.from(
      JSON.stringify({
        code: 'adapted_cv_invalid',
        detail:
          'Expected adaptedCv.sections[3] tools items to be concise ungrouped sidebar labels.',
        invalidSection: {
          items: [
            {
              text: 'NoSQL databases (MongoDB, AWS DynamoDB)',
            },
            {
              text: 'Serverless Framework',
            },
          ],
          kind: 'tools',
        },
        invalidSectionIndex: 3,
        path: 'adaptedCv',
      }),
      'utf8',
    ),
  )

  expect(renderAdaptedCvPdf).not.toHaveBeenCalled()
})

test('accepts concise tool labels with internal periods such as Node.js', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              ...result.adaptedCv.sections.slice(0, -1),
              {
                items: [
                  {
                    text: 'React',
                  },
                  {
                    text: 'React Native',
                  },
                  {
                    text: 'Node.js',
                  },
                  {
                    text: 'TypeScript',
                  },
                  {
                    text: 'AWS',
                  },
                  {
                    text: 'PostgreSQL',
                  },
                ],
                kind: 'tools',
              },
              result.adaptedCv.sections.at(-1) ?? {
                kind: 'references',
              },
            ],
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

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })
  expect(renderAdaptedCvPdf).toHaveBeenCalledTimes(1)
})

test('rejects adapted output when a mandatory tailored-CV section is empty', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              {
                kind: 'profile',
                summary: {
                  text: '   ',
                },
              },
              ...result.adaptedCv.sections.slice(1),
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    path: 'adaptedCv',
  })
  expect(renderAdaptedCvPdf).not.toHaveBeenCalled()
})

test('rejects adapted output when the profile breaches the page-one template-fit limit', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            sections: [
              {
                kind: 'profile',
                summary: {
                  text: 'Template fit '.repeat(120),
                },
              },
              ...result.adaptedCv.sections.slice(1),
            ],
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    path: 'adaptedCv',
  })
  expect(renderAdaptedCvPdf).not.toHaveBeenCalled()
})

test('rejects adapted output when the header intro breaches the concise intro limit', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const renderAdaptedCvPdf = vi.fn().mockResolvedValue({
    pageCount: 1,
    pageWarning: null,
    pdfBytes: new Uint8Array([37, 80, 68, 70]),
  })
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf,
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()

        return Promise.resolve({
          ...result,
          adaptedCv: {
            ...result.adaptedCv,
            header: {
              intro: {
                text: 'This header intro has drifted into an oversized recruiter-facing paragraph that keeps adding explanatory detail about workflow delivery, stakeholder alignment, systems thinking, operating cadence, and cross-functional influence until it clearly stops behaving like the short intro line required by the CV template.',
              },
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

  const resumePromise = service.resumePendingGeneration()

  await expect(resumePromise).rejects.toMatchObject({
    code: 'adapted_cv_invalid',
    path: 'adaptedCv',
  })
  expect(renderAdaptedCvPdf).not.toHaveBeenCalled()
})

test('derives the persisted cover-letter plain text from the canonical cover-letter model', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
      }),
    },
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
          coverLetterPlainText: 'incorrect plain text from worker',
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

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })
  await expect(
    harness.localAppData.artifacts.read({
      id: 'tailored-application-123',
      name: 'cover-letter.txt',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual(
    Buffer.from(
      buildExpectedCoverLetterPlainText(createValidGenerationResult().coverLetter),
      'utf8',
    ),
  )
})

test('preserves the underlying generation failure as the thrown error cause', async () => {
  const harness = await createHarness()
  const generationFailure = new Error('disk full')

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
    message: "We couldn't tailor your CV right now. Try again.",
  })
})

test('accepts cover-letter prose when only the JSON contract is validated', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
      }),
    },
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
        const result = createValidGenerationResult()
        const coverLetter = {
          ...result.coverLetter,
          body: [
            {
              text: 'I am passionate about joining your world-class team and bringing a results-driven approach to the role.',
            },
          ],
        }

        return Promise.resolve({
          ...result,
          coverLetter,
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

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })
  await expect(
    harness.localAppData.metadata.get({
      id: 'tailored-application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toMatchObject({
    status: 'ready',
  })
})

test('blocks generation before queueing when the selected original CV is non-English', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      [
        'Ada Lovelace',
        'Diseñadora principal de producto',
        '',
        'Resumen',
        'Diseña productos para usuarios técnicos con experiencia en flujos de trabajo complejos.',
        '',
        'Experiencia',
        'Diseñadora principal de producto | Analytical Engines Ltd',
        'Dirigió la creación de herramientas de escritorio para equipos técnicos.',
      ].join('\n'),
      'utf8',
    ),
    id: 'original-cv-123',
    name: 'extracted.txt',
    scope: 'original-cvs',
  })
  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn(),
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
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
  ).rejects.toThrow(
    'CV Maxxing v1 supports British English only. Use an English original CV to continue.',
  )
  await expect(service.getPendingGenerationCommand()).resolves.toBeNull()
})

test('blocks generation before queueing when the reviewed vacancy is non-English', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.metadata.put({
    id: 'vacancy-123',
    scope: 'vacancies',
    value: {
      blockingReason: null,
      canGenerate: true,
      employer: 'Example Labs',
      fetchedAt: '2026-04-08T21:00:00.000Z',
      inputType: 'pasted_text',
      location: 'Madrid, España',
      originalUrl: 'https://jobs.example.com/roles/123',
      requirements: ['Experiencia enviando software de flujo de trabajo.'],
      resolvedUrl: 'https://jobs.example.com/roles/123',
      responsibilities: ['Diseñar productos para usuarios técnicos con equipos de ingeniería.'],
      source: 'generic',
      status: 'ready',
      textPreview: 'Diseñar productos para usuarios técnicos con equipos de ingeniería.',
      title: 'Ingeniero de plataforma',
    },
  })
  await harness.localAppData.artifacts.write({
    content: Buffer.from(
      [
        'Ingeniero de plataforma',
        'Example Labs',
        'Madrid, España',
        '',
        'Responsabilidades',
        '- Diseñar productos para usuarios técnicos con equipos de ingeniería.',
        '- Colaborar con investigación y operaciones.',
        '',
        'Requisitos',
        '- Experiencia enviando software de flujo de trabajo.',
        '- Comunicación escrita sólida.',
      ].join('\n'),
      'utf8',
    ),
    id: 'vacancy-123',
    name: 'extracted.txt',
    scope: 'vacancies',
  })
  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn(),
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
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
  ).rejects.toThrow(
    'CV Maxxing v1 supports British English only. Review an English job before tailoring your CV.',
  )
  await expect(service.getPendingGenerationCommand()).resolves.toBeNull()
})

test('preserves the tailored-application generation timeout message for the loading-screen UI', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn(),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn(),
    },
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
        return Promise.reject(new Error('Tailored application generation timed out.'))
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
    'Tailoring your CV took too long. Try again.',
  )
})

test('cancels an active generation, removes transient workspaces, and preserves the vacancy workspace', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)

  let abortSignalTriggered = false
  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn(),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn(),
    },
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
      message: 'AI needs you to sign in before CV Maxxing can finish your CV and cover letter.',
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
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
      }),
    },
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

test('returns the updated saved-application list when completing generation so the renderer can replace the draft row atomically', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.metadata.put({
    id: 'tailored-application-456',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 2,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-08T09:30:00.000Z',
      employer: 'Nebula Labs',
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: 'Platform Product Manager',
    },
  })

  const service = createTailoredApplicationSessionService({
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn().mockResolvedValue({
        pageCount: 4,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 adapted cv', 'utf8'),
      }),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn().mockResolvedValue({
        pageCount: 1,
        pageWarning: null,
        pdfBytes: Buffer.from('%PDF-1.7 cover letter', 'utf8'),
      }),
    },
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
    status: 'ready',
  })

  await expect(service.resumePendingGeneration()).resolves.toEqual({
    generationRunId: 'run-123',
    tailoredApplicationId: 'tailored-application-123',
  })

  await expect(service.completePendingGeneration('command-123')).resolves.toEqual({
    workspaceState: {
      activeApplicationId: 'tailored-application-123',
      applications: [
        {
          createdAt: '2026-04-09T09:30:00.000Z',
          employer: 'Example Labs',
          id: 'tailored-application-123',
          pageCount: 4,
          pageWarning: null,
          title: 'Senior platform engineer · Example Labs',
          vacancyTitle: 'Senior platform engineer',
        },
        {
          createdAt: '2026-04-08T09:30:00.000Z',
          employer: 'Nebula Labs',
          id: 'tailored-application-456',
          pageCount: 2,
          pageWarning: null,
          title: 'Platform Product Manager · Nebula Labs',
          vacancyTitle: 'Platform Product Manager',
        },
      ],
    },
  })

  await expect(harness.readinessStore.getStartupDestination()).resolves.toBe('workspace')
  await expect(
    harness.localAppData.metadata.get({
      id: 'current',
      scope: 'vacancy-workspace',
    }),
  ).resolves.toBeNull()
})

test('restores the explicit saved tailored application selection when no meaningful draft exists', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.metadata.delete({
    id: 'current',
    scope: 'vacancy-workspace',
  })
  await harness.localAppData.metadata.put({
    id: 'tailored-application-123',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 2,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-09T09:30:00.000Z',
      employer: 'Example Labs',
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: 'Senior platform engineer',
    },
  })
  await harness.localAppData.metadata.put({
    id: 'tailored-application-456',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 2,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-08T09:30:00.000Z',
      employer: 'Nebula Labs',
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: 'Platform Product Manager',
    },
  })
  await harness.workspaceSelectionStore.setSelection({
    jobs: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-456',
    },
    originalCv: {
      kind: 'active_original_cv',
      originalCvId: 'original-cv-123',
    },
    topLevelSection: 'original_cv',
  })

  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn(),
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    workspaceSelectionStore: harness.workspaceSelectionStore,
  })

  await expect(service.getWorkspaceState()).resolves.toEqual({
    activeApplicationId: 'tailored-application-456',
    applications: [
      {
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
        pageCount: 2,
        pageWarning: null,
        title: 'Senior platform engineer · Example Labs',
        vacancyTitle: 'Senior platform engineer',
      },
      {
        createdAt: '2026-04-08T09:30:00.000Z',
        employer: 'Nebula Labs',
        id: 'tailored-application-456',
        pageCount: 2,
        pageWarning: null,
        title: 'Platform Product Manager · Nebula Labs',
        vacancyTitle: 'Platform Product Manager',
      },
    ],
  })
})

test('falls back from a stale saved selection to the meaningful current draft before saved history', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.metadata.put({
    id: 'tailored-application-123',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 2,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-09T09:30:00.000Z',
      employer: 'Example Labs',
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: 'Senior platform engineer',
    },
  })
  await harness.workspaceSelectionStore.setSelection({
    jobs: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-missing',
    },
    originalCv: {
      kind: 'active_original_cv',
      originalCvId: 'original-cv-123',
    },
    topLevelSection: 'settings',
  })

  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn(),
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    workspaceSelectionStore: harness.workspaceSelectionStore,
  })

  await expect(service.getWorkspaceState()).resolves.toEqual({
    activeApplicationId: null,
    applications: [
      {
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
        pageCount: 2,
        pageWarning: null,
        title: 'Senior platform engineer · Example Labs',
        vacancyTitle: 'Senior platform engineer',
      },
    ],
  })
})

test('falls back from a stale saved selection to the newest saved tailored application when no meaningful draft exists', async () => {
  const harness = await createHarness()

  await seedOriginalCvAndVacancy(harness)
  await harness.localAppData.metadata.delete({
    id: 'current',
    scope: 'vacancy-workspace',
  })
  await harness.localAppData.metadata.put({
    id: 'tailored-application-123',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 2,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-09T09:30:00.000Z',
      employer: 'Example Labs',
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: 'Senior platform engineer',
    },
  })
  await harness.localAppData.metadata.put({
    id: 'tailored-application-456',
    scope: 'tailored-applications',
    value: {
      adaptedCvPageCount: 2,
      adaptedCvPageWarning: null,
      candidateName: 'Ada Lovelace',
      coverLetterPageCount: 1,
      coverLetterPageWarning: null,
      createdAt: '2026-04-08T09:30:00.000Z',
      employer: 'Nebula Labs',
      originalCvId: 'original-cv-123',
      status: 'ready',
      vacancyId: 'vacancy-123',
      vacancyTitle: 'Platform Product Manager',
    },
  })
  await harness.workspaceSelectionStore.setSelection({
    jobs: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-missing',
    },
    originalCv: {
      kind: 'active_original_cv',
      originalCvId: 'original-cv-123',
    },
    topLevelSection: 'original_cv',
  })

  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn(),
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    workspaceSelectionStore: harness.workspaceSelectionStore,
  })

  await expect(service.getWorkspaceState()).resolves.toEqual({
    activeApplicationId: 'tailored-application-123',
    applications: [
      {
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Example Labs',
        id: 'tailored-application-123',
        pageCount: 2,
        pageWarning: null,
        title: 'Senior platform engineer · Example Labs',
        vacancyTitle: 'Senior platform engineer',
      },
      {
        createdAt: '2026-04-08T09:30:00.000Z',
        employer: 'Nebula Labs',
        id: 'tailored-application-456',
        pageCount: 2,
        pageWarning: null,
        title: 'Platform Product Manager · Nebula Labs',
        vacancyTitle: 'Platform Product Manager',
      },
    ],
  })
})

test('falls back from a stale saved selection to blank workspace when no draft or saved history remains', async () => {
  const harness = await createHarness()

  await harness.workspaceSelectionStore.setSelection({
    jobs: {
      kind: 'tailored_application',
      tailoredApplicationId: 'tailored-application-missing',
    },
    originalCv: {
      kind: 'none',
    },
    topLevelSection: 'settings',
  })

  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn(),
    },
    localAppData: harness.localAppData,
    readinessStore: harness.readinessStore,
    runWorkspaceRootPath: path.join(harness.paths.rootDirectoryPath, 'runs'),
    workspaceSelectionStore: harness.workspaceSelectionStore,
  })

  await expect(service.getWorkspaceState()).resolves.toEqual({
    activeApplicationId: null,
    applications: [],
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
  await harness.readinessStore.setStartupDestination('workspace')
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
    adaptedCvRenderer: {
      renderAdaptedCvPdf: vi.fn(),
    },
    coverLetterRenderer: {
      renderCoverLetterPdf: vi.fn(),
    },
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
  await expect(harness.readinessStore.getStartupDestination()).resolves.toBe('workspace')
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
    workspaceSelectionStore: createWorkspaceSelectionStore({
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
        'London, United Kingdom',
        '+44 7700 900123',
        'ada@lovelace.dev',
        'https://www.linkedin.com/in/ada-lovelace',
        'https://github.com/ada-lovelace',
        'ada-lovelace.dev',
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
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: 'ada-lovelace.dev',
        },
        experience: [createNormalizedOriginalCvExperienceEntry()],
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
        'London, United Kingdom',
        '+44 7700 900123',
        'ada@lovelace.dev',
        'https://www.linkedin.com/in/ada-lovelace',
        'https://github.com/ada-lovelace',
        'ada-lovelace.dev',
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
          text: 'Emphasises desktop workflow design for technical users.',
        },
      ],
      gaps: [
        'The vacancy asks for workflow-software shipping experience; the original CV shows related desktop-tooling design work but does not claim engineering ownership.',
      ],
      omitted: [
        {
          text: 'Compresses broader research language so the vacancy-specific desktop tooling evidence stays primary.',
        },
      ],
      validationHints: ['Keep interview examples grounded in shipped desktop workflow tooling.'],
    },
    adaptedCv: {
      candidateName: 'Ada Lovelace',
      header: {
        intro: {
          text: 'Design leader shaping truthful desktop workflow products for technical users.',
        },
      },
      headline: {
        text: 'Principal Product Designer',
      },
      sections: [
        {
          kind: 'profile',
          summary: {
            text: 'Design leader adapting complex desktop workflow products for technical users.',
          },
        },
        {
          items: [
            {
              bullets: [
                {
                  text: 'Led product design for AI-assisted desktop tooling used by technical teams.',
                },
              ],
              dateRange: '2022 — Present',
              employer: 'Analytical Engines Ltd',
              location: 'London',
              roleTitle: 'Lead Product Designer',
            },
          ],
          kind: 'experience',
        },
        {
          items: [
            {
              text: 'Product strategy',
            },
            {
              text: 'UX research',
            },
          ],
          kind: 'core_skills',
        },
        {
          kind: 'references',
        },
      ],
    },
    coverLetter: {
      body: [
        {
          text: 'I have led product design for AI-assisted desktop tooling, which aligns with your focus on reliable tooling for technical users.',
        },
      ],
      closing: {
        text: 'I would welcome the chance to discuss how that experience could support Example Labs.',
      },
      date: '9 April 2026',
      greeting: 'Dear Hiring Manager,',
      opening: {
        text: 'I am applying for the Senior platform engineer role at Example Labs.',
      },
      signature: 'Ada Lovelace',
    },
    trace: {
      model: 'gpt-5.4-codex',
      provider: 'codex',
      sessionId: 'session-123',
    },
  }
}

function buildExpectedCoverLetterPlainText(
  coverLetter: TailoredApplicationGenerationResult['coverLetter'],
): string {
  return [
    coverLetter.date,
    '',
    coverLetter.greeting,
    '',
    coverLetter.opening.text,
    '',
    ...coverLetter.body.flatMap((paragraph) => {
      return [paragraph.text, '']
    }),
    coverLetter.closing.text,
    '',
    coverLetter.signature,
  ].join('\n')
}
