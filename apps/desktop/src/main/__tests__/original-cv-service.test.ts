import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js'
import { OriginalCvNormalizationError } from '../original-cv-normalization-error.js'
import { createOriginalCvNormalizationService } from '../original-cv-normalization-service.js'
import { OriginalCvImportError, createOriginalCvService } from '../original-cv-service.js'
import type { KeychainBoundary, LocalAppDataPaths } from '../local-app-data-service.js'
import type {
  NormalizedOriginalCvContact,
  NormalizedOriginalCvExperienceEntry,
  OriginalCvNormalizationInput,
  OriginalCvNormalizationResult,
  OriginalCvNormalizationService,
} from '../original-cv-normalization-service.js'

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

async function createTestPaths(): Promise<LocalAppDataPaths> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-original-cv-service-'))

  temporaryDirectories.push(rootDirectoryPath)

  return createLocalAppDataPaths(rootDirectoryPath)
}

function createKeychainBoundary(secret = Buffer.alloc(32, 7)): KeychainBoundary {
  return {
    clearAppDataKey: vi.fn(() => Promise.resolve()),
    getOrCreateAppDataKey: vi.fn(() => Promise.resolve(secret)),
  }
}

function createNormalizationServiceMock(
  implementation?: OriginalCvNormalizationService['normalizeOriginalCv'],
): OriginalCvNormalizationService {
  return {
    normalizeOriginalCv:
      implementation ??
      vi.fn((input: OriginalCvNormalizationInput) => {
        return Promise.resolve(normalizeExtractedTextForTest(input.extractedText))
      }),
  }
}

function normalizeExtractedTextForTest(extractedText: string) {
  const lines = extractedText
    .split(/\r?\n/u)
    .map((line) => {
      return line.trim()
    })
    .filter((line) => {
      return line !== ''
    })

  const summaryIndex = lines.findIndex((line) => {
    return line.toLowerCase() === 'summary'
  })
  const experienceIndex = lines.findIndex((line) => {
    return line.toLowerCase() === 'experience'
  })
  const skillsIndex = lines.findIndex((line) => {
    return line.toLowerCase() === 'skills'
  })
  const experienceSectionEndIndex = skillsIndex === -1 ? undefined : skillsIndex
  const proseLines = lines.filter((line) => {
    return /\s/u.test(line) && !/^(summary|experience|skills)$/iu.test(line)
  })
  const sentenceLengths = proseLines.flatMap((line) => {
    return line
      .split(/[.!?]+/u)
      .map((sentence) => {
        return sentence.trim()
      })
      .filter((sentence) => {
        return sentence !== ''
      })
      .map((sentence) => {
        return sentence.split(/\s+/u).filter((word) => {
          return word !== ''
        }).length
      })
  })
  const averageSentenceLength =
    sentenceLengths.length === 0
      ? 0
      : Math.round(
          sentenceLengths.reduce((total, sentenceLength) => {
            return total + sentenceLength
          }, 0) / sentenceLengths.length,
        )

  return {
    normalizedCv: {
      contact: createNormalizedContact({
        email: '',
        location: '',
        phone: '',
        professionalLink: '',
      }),
      experience:
        experienceIndex === -1
          ? []
          : buildNormalizedExperienceEntriesForTest(
              lines.slice(experienceIndex + 1, experienceSectionEndIndex),
            ),
      fullName: lines[0] ?? '',
      headline: lines[1] ?? '',
      skills:
        skillsIndex === -1
          ? []
          : lines.slice(skillsIndex + 1).flatMap((line) => {
              return line
                .split(',')
                .map((entry) => {
                  return entry.trim()
                })
                .filter((entry) => {
                  return entry !== ''
                })
            }),
      summary: summaryIndex === -1 ? '' : (lines[summaryIndex + 1] ?? ''),
    },
    writingStyle: {
      averageSentenceLength,
      clicheDetections: ['results-driven', 'team player', 'hard-working'].filter((phrase) => {
        return extractedText.toLowerCase().includes(phrase)
      }),
      firstPersonUsage: /\b(i|me|my|mine|we|our|ours)\b/iu.test(extractedText) ? 'mixed' : 'absent',
      formality: averageSentenceLength >= 10 ? 'formal' : 'direct',
    } as const,
  } satisfies OriginalCvNormalizationResult
}

function buildNormalizedExperienceEntriesForTest(
  lines: string[],
): NormalizedOriginalCvExperienceEntry[] {
  const entries: NormalizedOriginalCvExperienceEntry[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const roleLine = lines[index]

    if (!roleLine?.includes('|')) {
      continue
    }

    const [roleTitle = '', employer = '', ...dateParts] = roleLine.split('|').map((part) => {
      return part.trim()
    })
    const nextLine = lines[index + 1]
    const summary = nextLine !== undefined && !nextLine.includes('|') ? nextLine : ''

    entries.push(
      createNormalizedExperienceEntry({
        dateRange: dateParts.join(' | '),
        employer,
        roleTitle,
        summary,
      }),
    )

    if (summary !== '') {
      index += 1
    }
  }

  return entries
}

function createNormalizedContact(
  overrides: Partial<NormalizedOriginalCvContact> = {},
): NormalizedOriginalCvContact {
  return {
    email: 'ada@lovelace.dev',
    location: 'London, United Kingdom',
    phone: '+44 7700 900123',
    professionalLink: 'ada-lovelace.dev',
    ...overrides,
  }
}

function createNormalizedExperienceEntry(
  overrides: Partial<NormalizedOriginalCvExperienceEntry> = {},
): NormalizedOriginalCvExperienceEntry {
  return {
    dateRange: '',
    employer: 'Analytical Engines Ltd',
    roleTitle: 'Principal Product Designer',
    summary: 'Led product design for AI-assisted desktop tooling.',
    ...overrides,
  }
}

test('imports the first original CV snapshot and persists encrypted source, text, normalized JSON, and writing style artifacts', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            email: '',
            location: '',
            phone: '',
            professionalLink: '',
          }),
          experience: [createNormalizedExperienceEntry()],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Product strategy', 'UX research', 'Prototyping'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: ['results-driven'],
          firstPersonUsage: 'mixed',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 2,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          '',
          'Summary',
          'Design leader focused on complex workflow products for technical users.',
          '',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling.',
          '',
          'Skills',
          'Product strategy, UX research, prototyping',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  const importedCv = await originalCvService.importOriginalCv({
    content: Buffer.from('%PDF-1.7 example', 'utf8'),
    filename: 'ada-lovelace.pdf',
  })

  expect(importedCv.fileType).toBe('pdf')
  expect(importedCv.headline).toBe('Principal Product Designer')
  expect(importedCv.id).toBe('original-cv-001')
  expect(importedCv.importedAt).toBe('2026-04-08T14:30:00.000Z')
  expect(importedCv.originalFilename).toBe('ada-lovelace.pdf')
  expect(importedCv.pageCount).toBe(2)
  expect(importedCv.snapshotCount).toBe(1)
  expect(importedCv.summary).toBe(
    'Design leader focused on complex workflow products for technical users.',
  )
  expect(importedCv.writingStyle).toEqual({
    averageSentenceLength: 13,
    clicheDetections: ['results-driven'],
    firstPersonUsage: 'mixed',
    formality: 'formal',
  })

  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: importedCv,
    snapshotCount: 1,
  })

  expect(normalizationService.normalizeOriginalCv).toHaveBeenCalledWith({
    extractedText: [
      'Ada Lovelace',
      'Principal Product Designer',
      '',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      '',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      '',
      'Skills',
      'Product strategy, UX research, prototyping',
    ].join('\n'),
    fileType: 'pdf',
    originalFilename: 'ada-lovelace.pdf',
    pageCount: 2,
  })

  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-001',
      name: 'source.pdf',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(Buffer.from('%PDF-1.7 example', 'utf8'))
  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-001',
      name: 'extracted.txt',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(
    Buffer.from(
      [
        'Ada Lovelace',
        'Principal Product Designer',
        '',
        'Summary',
        'Design leader focused on complex workflow products for technical users.',
        '',
        'Experience',
        'Principal Product Designer | Analytical Engines Ltd',
        'Led product design for AI-assisted desktop tooling.',
        '',
        'Skills',
        'Product strategy, UX research, prototyping',
      ].join('\n'),
      'utf8',
    ),
  )

  const normalizedArtifact = await localAppData.artifacts.read({
    id: 'original-cv-001',
    name: 'normalized.json',
    scope: 'original-cvs',
  })

  expect(normalizedArtifact?.toString('utf8')).toContain('"fullName":"Ada Lovelace"')
  expect(normalizedArtifact?.toString('utf8')).toContain('"headline":"Principal Product Designer"')

  const styleArtifact = await localAppData.artifacts.read({
    id: 'original-cv-001',
    name: 'writing-style-profile.json',
    scope: 'original-cvs',
  })

  expect(styleArtifact?.toString('utf8')).toContain('"firstPersonUsage":"mixed"')

  await localAppData.close()
})

test('imports a DOCX original CV through the same AI-backed normalization path and preserves existing artifact names', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            email: '',
            location: '',
            phone: '',
            professionalLink: '',
          }),
          experience: [
            createNormalizedExperienceEntry({
              employer: 'Difference Engines Ltd',
              roleTitle: 'Senior Content Strategist',
              summary: 'Built truthful CV adaptation workflows for complex desktop software.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Senior Content Strategist',
          skills: ['Content strategy', 'Information architecture', 'Editorial systems'],
          summary:
            'Content strategist shaping trustworthy workflow tools for technical job seekers.',
        },
        writingStyle: {
          averageSentenceLength: 11,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'direct',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Senior Content Strategist',
          '',
          'Summary',
          'Content strategist shaping trustworthy workflow tools for technical job seekers.',
          '',
          'Experience',
          'Senior Content Strategist | Difference Engines Ltd',
          'Built truthful CV adaptation workflows for complex desktop software.',
          '',
          'Skills',
          'Content strategy, information architecture, editorial systems',
        ].join('\n'),
      })
    }),
    extractTextFromPdf: vi.fn(),
    generateId: vi.fn(() => 'original-cv-002'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T15:00:00.000Z'),
    localAppData,
    normalizationService,
  })

  const importedCv = await originalCvService.importOriginalCv({
    content: Buffer.from('PK docx bytes', 'utf8'),
    filename: 'ada-lovelace.docx',
  })

  expect(importedCv).toEqual({
    fileType: 'docx',
    headline: 'Senior Content Strategist',
    id: 'original-cv-002',
    importedAt: '2026-04-08T15:00:00.000Z',
    originalFilename: 'ada-lovelace.docx',
    pageCount: 1,
    snapshotCount: 1,
    summary: 'Content strategist shaping trustworthy workflow tools for technical job seekers.',
    writingStyle: {
      averageSentenceLength: 11,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'direct',
    },
  })
  expect(normalizationService.normalizeOriginalCv).toHaveBeenCalledWith({
    extractedText: [
      'Ada Lovelace',
      'Senior Content Strategist',
      '',
      'Summary',
      'Content strategist shaping trustworthy workflow tools for technical job seekers.',
      '',
      'Experience',
      'Senior Content Strategist | Difference Engines Ltd',
      'Built truthful CV adaptation workflows for complex desktop software.',
      '',
      'Skills',
      'Content strategy, information architecture, editorial systems',
    ].join('\n'),
    fileType: 'docx',
    originalFilename: 'ada-lovelace.docx',
    pageCount: 1,
  })

  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-002',
      name: 'source.docx',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(Buffer.from('PK docx bytes', 'utf8'))

  const normalizedArtifact = await localAppData.artifacts.read({
    id: 'original-cv-002',
    name: 'normalized.json',
    scope: 'original-cvs',
  })

  expect(normalizedArtifact?.toString('utf8')).toContain('"headline":"Senior Content Strategist"')

  const writingStyleArtifact = await localAppData.artifacts.read({
    id: 'original-cv-002',
    name: 'writing-style-profile.json',
    scope: 'original-cvs',
  })

  expect(writingStyleArtifact?.toString('utf8')).toContain('"formality":"direct"')

  await localAppData.close()
})

test('imports a heading-variant original CV with grounded high-risk fields plus derived summary and regrouped experience while preserving the stored shape', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            email: '',
            location: '',
            phone: '',
            professionalLink: '',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Led product design for AI-assisted desktop tooling across import and export flows.',
            }),
            createNormalizedExperienceEntry({
              employer: 'Difference Engines Ltd',
              roleTitle: 'Senior Content Strategist',
              summary:
                'Built content systems and UX research practices for complex workflow products.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Content systems'],
          summary:
            'Design leader shaping truthful workflow products for technical users and regulated content teams.',
        },
        writingStyle: {
          averageSentenceLength: 14,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const extractedText = [
    'Ada Lovelace',
    'London, United Kingdom',
    'Principal Product Designer',
    '',
    'Profile',
    'Product design leader for technical workflow tooling and regulated content systems.',
    '',
    'Career Highlights',
    'Analytical Engines Ltd',
    'Led product design for AI-assisted desktop tooling across import and export flows.',
    'Difference Engines Ltd',
    'Built content systems and UX research practices for complex workflow products.',
    '',
    'Core Skills',
    'Workflow design, UX research, content systems',
  ].join('\n')
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: extractedText,
      })
    }),
    generateId: vi.fn(() => 'original-cv-003'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T15:15:00.000Z'),
    localAppData,
    normalizationService,
  })

  const importedCv = await originalCvService.importOriginalCv({
    content: Buffer.from('%PDF-1.7 derived', 'utf8'),
    filename: 'ada-lovelace-variant.pdf',
  })

  expect(importedCv).toEqual({
    fileType: 'pdf',
    headline: 'Principal Product Designer',
    id: 'original-cv-003',
    importedAt: '2026-04-08T15:15:00.000Z',
    originalFilename: 'ada-lovelace-variant.pdf',
    pageCount: 1,
    snapshotCount: 1,
    summary:
      'Design leader shaping truthful workflow products for technical users and regulated content teams.',
    writingStyle: {
      averageSentenceLength: 14,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'formal',
    },
  })
  expect(normalizationService.normalizeOriginalCv).toHaveBeenCalledWith({
    extractedText,
    fileType: 'pdf',
    originalFilename: 'ada-lovelace-variant.pdf',
    pageCount: 1,
  })

  const normalizedArtifact = await localAppData.artifacts.read({
    id: 'original-cv-003',
    name: 'normalized.json',
    scope: 'original-cvs',
  })

  expect(normalizedArtifact?.toString('utf8')).toBe(
    JSON.stringify({
      contact: {
        email: '',
        location: '',
        phone: '',
        professionalLink: '',
      },
      experience: [
        createNormalizedExperienceEntry({
          summary:
            'Led product design for AI-assisted desktop tooling across import and export flows.',
        }),
        createNormalizedExperienceEntry({
          employer: 'Difference Engines Ltd',
          roleTitle: 'Senior Content Strategist',
          summary: 'Built content systems and UX research practices for complex workflow products.',
        }),
      ],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Workflow design', 'UX research', 'Content systems'],
      summary:
        'Design leader shaping truthful workflow products for technical users and regulated content teams.',
    }),
  )

  await localAppData.close()
})

test('imports a CV without an explicit skills section when recovered skills stay grounded in the experience evidence', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            email: '',
            location: '',
            phone: '',
            professionalLink: '',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Designed workflow systems for AI-assisted desktop tooling and ran UX research across import and export journeys.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Desktop tooling'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          '',
          'Summary',
          'Design leader focused on complex workflow products for technical users.',
          '',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Designed workflow systems for AI-assisted desktop tooling and ran UX research across import and export journeys.',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-004'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T15:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  const importedCv = await originalCvService.importOriginalCv({
    content: Buffer.from('%PDF-1.7 recovered-skills', 'utf8'),
    filename: 'ada-lovelace-no-skills-section.pdf',
  })

  expect(importedCv).toEqual({
    fileType: 'pdf',
    headline: 'Principal Product Designer',
    id: 'original-cv-004',
    importedAt: '2026-04-08T15:30:00.000Z',
    originalFilename: 'ada-lovelace-no-skills-section.pdf',
    pageCount: 1,
    snapshotCount: 1,
    summary: 'Design leader focused on complex workflow products for technical users.',
    writingStyle: {
      averageSentenceLength: 13,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'formal',
    },
  })
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: importedCv,
    snapshotCount: 1,
  })

  const normalizedArtifact = await localAppData.artifacts.read({
    id: 'original-cv-004',
    name: 'normalized.json',
    scope: 'original-cvs',
  })

  expect(normalizedArtifact?.toString('utf8')).toContain(
    '"skills":["Workflow design","UX research","Desktop tooling"]',
  )

  await localAppData.close()
})

test('replaces the active original CV by creating a new snapshot and leaves existing tailored applications pinned to the earlier snapshot', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const pdfExtractor = vi
    .fn()
    .mockResolvedValueOnce({
      pageCount: 1,
      text: [
        'Ada Lovelace',
        'Principal Product Designer',
        '',
        'Summary',
        'Design leader focused on complex workflow products for technical users.',
        '',
        'Experience',
        'Principal Product Designer | Analytical Engines Ltd',
        'Led product design for AI-assisted desktop tooling.',
        '',
        'Skills',
        'Product strategy, UX research, prototyping',
      ].join('\n'),
    })
    .mockResolvedValueOnce({
      pageCount: 1,
      text: [
        'Ada Lovelace',
        'Staff Product Designer',
        '',
        'Summary',
        'Product designer adapting CVs for desktop AI tooling.',
        '',
        'Experience',
        'Staff Product Designer | Analytical Engines Ltd',
        'Refined import and adaptation workflows for complex authoring tools.',
        '',
        'Skills',
        'Design systems, desktop UX, content strategy',
      ].join('\n'),
    })
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: pdfExtractor,
    generateId: vi
      .fn()
      .mockReturnValueOnce('original-cv-001')
      .mockReturnValueOnce('original-cv-002'),
    getCurrentTimestamp: vi
      .fn()
      .mockReturnValueOnce('2026-04-08T14:30:00.000Z')
      .mockReturnValueOnce('2026-04-08T14:45:00.000Z'),
    localAppData,
    normalizationService: createNormalizationServiceMock(),
  })

  const firstImport = await originalCvService.importOriginalCv({
    content: Buffer.from('%PDF-1.7 first', 'utf8'),
    filename: 'ada-lovelace.pdf',
  })

  await localAppData.metadata.put({
    id: 'tailored-application-001',
    scope: 'tailored-applications',
    value: {
      originalCvId: firstImport.id,
      status: 'ready',
    },
  })

  const secondImport = await originalCvService.importOriginalCv({
    content: Buffer.from('%PDF-1.7 second', 'utf8'),
    filename: 'ada-lovelace-revised.pdf',
  })

  expect(secondImport.id).toBe('original-cv-002')
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: secondImport,
    snapshotCount: 2,
  })
  await expect(
    localAppData.metadata.get<{
      originalCvId: string
      status: string
    }>({
      id: 'tailored-application-001',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual({
    originalCvId: 'original-cv-001',
    status: 'ready',
  })
  await expect(
    localAppData.metadata.get<{
      headline: string
      isActive: boolean
    }>({
      id: 'original-cv-001',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      headline: 'Principal Product Designer',
      isActive: false,
    }),
  )
  await expect(
    localAppData.metadata.get<{
      headline: string
      isActive: boolean
    }>({
      id: 'original-cv-002',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      headline: 'Staff Product Designer',
      isActive: true,
    }),
  )

  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-001',
      name: 'source.pdf',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(Buffer.from('%PDF-1.7 first', 'utf8'))
  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-002',
      name: 'source.pdf',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(Buffer.from('%PDF-1.7 second', 'utf8'))

  await localAppData.close()

  const databaseBytes = await readFile(paths.databasePath)

  expect(databaseBytes.includes(Buffer.from('Ada Lovelace', 'utf8'))).toBe(false)
  expect(databaseBytes.includes(Buffer.from('Staff Product Designer', 'utf8'))).toBe(false)
})

test('rejects a replacement with weak normalization output and keeps the previous original CV snapshot active', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const pdfExtractor = vi
    .fn()
    .mockResolvedValueOnce({
      pageCount: 1,
      text: [
        'Ada Lovelace',
        'Principal Product Designer',
        '',
        'Summary',
        'Design leader focused on complex workflow products for technical users.',
        '',
        'Experience',
        'Principal Product Designer | Analytical Engines Ltd',
        'Led product design for AI-assisted desktop tooling.',
        '',
        'Skills',
        'Product strategy, UX research, prototyping',
      ].join('\n'),
    })
    .mockResolvedValueOnce({
      pageCount: 1,
      text: [
        'Ada Lovelace',
        'Profile',
        'Product design leader for technical workflow tooling and regulated content systems.',
        'Career Highlights',
        'Analytical Engines Ltd',
        'Led product design for AI-assisted desktop tooling across import and export flows.',
      ].join('\n'),
    })
  const normalizationService = createNormalizationServiceMock(
    vi
      .fn()
      .mockImplementationOnce((input: OriginalCvNormalizationInput) => {
        return Promise.resolve(normalizeExtractedTextForTest(input.extractedText))
      })
      .mockResolvedValueOnce({
        normalizedCv: {
          contact: createNormalizedContact(),
          experience: [],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design'],
          summary: 'Design leader',
        },
        writingStyle: {
          averageSentenceLength: 12,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: pdfExtractor,
    generateId: vi
      .fn()
      .mockReturnValueOnce('original-cv-001')
      .mockReturnValueOnce('original-cv-002'),
    getCurrentTimestamp: vi
      .fn()
      .mockReturnValueOnce('2026-04-08T14:30:00.000Z')
      .mockReturnValueOnce('2026-04-08T14:45:00.000Z'),
    localAppData,
    normalizationService,
  })

  await originalCvService.importOriginalCv({
    content: Buffer.from('%PDF-1.7 first', 'utf8'),
    filename: 'ada-lovelace.pdf',
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 broken', 'utf8'),
      filename: 'ada-lovelace-broken.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'weak_normalization',
      message: "We couldn't make sense of this CV. Try a clearer PDF or DOCX.",
    }),
  )

  const workspaceState = await originalCvService.getWorkspaceState()

  expect(workspaceState.snapshotCount).toBe(1)
  expect(workspaceState.activeOriginalCv).not.toBeNull()
  expect(workspaceState.activeOriginalCv?.id).toBe('original-cv-001')
  expect(workspaceState.activeOriginalCv?.originalFilename).toBe('ada-lovelace.pdf')
  expect(workspaceState.activeOriginalCv?.snapshotCount).toBe(1)
  await expect(localAppData.metadata.list('original-cvs')).resolves.toHaveLength(1)
  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-002',
      name: 'source.pdf',
      scope: 'original-cvs',
    }),
  ).resolves.toBeNull()

  expect(normalizationService.normalizeOriginalCv).toHaveBeenCalledTimes(2)

  await localAppData.close()
})

test('rejects unreadable extracted original CV content before normalization starts and leaves encrypted storage unchanged', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock()
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: '%%%% 12345 ###',
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 broken', 'utf8'),
      filename: 'broken.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'unreadable_extraction',
      message: "We couldn't read enough from this CV. Use a text-based PDF or DOCX.",
    }),
  )
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: null,
    snapshotCount: 0,
  })
  await expect(localAppData.metadata.list('original-cvs')).resolves.toEqual([])
  expect(normalizationService.normalizeOriginalCv).not.toHaveBeenCalled()

  await localAppData.close()
})

test('rejects invalid normalization output and leaves encrypted storage unchanged', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn(() => {
      return Promise.reject(
        new OriginalCvNormalizationError({
          code: 'invalid_normalization',
          message: 'Malformed normalization output.',
        }),
      )
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Profile',
          'Product design leader for technical workflow tooling and regulated content systems.',
          'Career Highlights',
          'Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          'Core Skills',
          'Workflow design, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 malformed', 'utf8'),
      filename: 'malformed.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'invalid_normalization',
      message: "We couldn't make sense of this CV. Try a clearer PDF or DOCX.",
    }),
  )
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: null,
    snapshotCount: 0,
  })
  await expect(localAppData.metadata.list('original-cvs')).resolves.toEqual([])

  await localAppData.close()
})

test('maps a stalled normalization run through the import rejection path and keeps the current snapshot active', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-original-cv-import-timeout-runs-'),
  )

  temporaryDirectories.push(runWorkspaceRootPath)

  const pdfExtractor = vi
    .fn()
    .mockResolvedValueOnce({
      pageCount: 1,
      text: [
        'Ada Lovelace',
        'Principal Product Designer',
        '',
        'Summary',
        'Design leader focused on complex workflow products for technical users.',
        '',
        'Experience',
        'Principal Product Designer | Analytical Engines Ltd',
        'Led product design for AI-assisted desktop tooling.',
        '',
        'Skills',
        'Product strategy, UX research, prototyping',
      ].join('\n'),
    })
    .mockResolvedValueOnce({
      pageCount: 1,
      text: [
        'Ada Lovelace',
        'Staff Product Designer',
        '',
        'Summary',
        'Product designer adapting CVs for desktop AI tooling.',
        '',
        'Experience',
        'Staff Product Designer | Analytical Engines Ltd',
        'Refined import and adaptation workflows for complex authoring tools.',
        '',
        'Skills',
        'Design systems, desktop UX, content strategy',
      ].join('\n'),
    })
  const normalizationWorker = {
    runNormalization: vi
      .fn()
      .mockResolvedValueOnce(
        normalizeExtractedTextForTest(
          [
            'Ada Lovelace',
            'Principal Product Designer',
            '',
            'Summary',
            'Design leader focused on complex workflow products for technical users.',
            '',
            'Experience',
            'Principal Product Designer | Analytical Engines Ltd',
            'Led product design for AI-assisted desktop tooling.',
            '',
            'Skills',
            'Product strategy, UX research, prototyping',
          ].join('\n'),
        ),
      )
      .mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
        return await new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('Original CV normalization cancelled.'))
            },
            {
              once: true,
            },
          )
        })
      }),
  }
  const normalizationService = createOriginalCvNormalizationService({
    generateId: vi
      .fn()
      .mockReturnValueOnce('normalization-run-001')
      .mockReturnValueOnce('normalization-run-002'),
    runWorkspaceRootPath,
    timeoutMs: 5,
    worker: normalizationWorker,
  })
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: pdfExtractor,
    generateId: vi
      .fn()
      .mockReturnValueOnce('original-cv-001')
      .mockReturnValueOnce('original-cv-002'),
    getCurrentTimestamp: vi
      .fn()
      .mockReturnValueOnce('2026-04-08T14:30:00.000Z')
      .mockReturnValueOnce('2026-04-08T14:45:00.000Z'),
    localAppData,
    normalizationService,
  })

  await originalCvService.importOriginalCv({
    content: Buffer.from('%PDF-1.7 first', 'utf8'),
    filename: 'ada-lovelace.pdf',
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 stalled', 'utf8'),
      filename: 'ada-lovelace-stalled.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'invalid_normalization',
      message: 'Adding this CV took too long. Try again.',
    }),
  )

  const workspaceState = await originalCvService.getWorkspaceState()

  expect(workspaceState.snapshotCount).toBe(1)
  expect(workspaceState.activeOriginalCv).not.toBeNull()
  expect(workspaceState.activeOriginalCv?.id).toBe('original-cv-001')
  expect(workspaceState.activeOriginalCv?.originalFilename).toBe('ada-lovelace.pdf')
  expect(workspaceState.activeOriginalCv?.snapshotCount).toBe(1)
  await expect(localAppData.metadata.list('original-cvs')).resolves.toHaveLength(1)
  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-002',
      name: 'source.pdf',
      scope: 'original-cvs',
    }),
  ).resolves.toBeNull()
  await expect(readFile(paths.databasePath)).resolves.not.toContain('ada-lovelace-stalled.pdf')
  await expect(readFile(paths.databasePath)).resolves.not.toContain('Staff Product Designer')

  await localAppData.close()
})

test('rejects normalization that invents unsupported identity or skill content and leaves encrypted storage unchanged', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            email: '',
            location: '',
            phone: '',
            professionalLink: '',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Led product design for AI-assisted desktop tooling across import and export flows.',
            }),
          ],
          fullName: 'Ada Byron Lovelace',
          headline: 'Staff Product Designer',
          skills: ['Product strategy', 'UX research', 'Revenue operations'],
          summary:
            'Design leader shaping truthful workflow products for technical users and regulated content teams.',
        },
        writingStyle: {
          averageSentenceLength: 14,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          '',
          'Profile',
          'Product design leader for technical workflow tooling and regulated content systems.',
          '',
          'Career Highlights',
          'Principal Product Designer | Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          '',
          'Core Skills',
          'Product strategy, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 invented', 'utf8'),
      filename: 'invented.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'weak_normalization',
      message: "We couldn't make sense of this CV. Try a clearer PDF or DOCX.",
    }),
  )
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: null,
    snapshotCount: 0,
  })
  await expect(localAppData.metadata.list('original-cvs')).resolves.toEqual([])
  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-001',
      name: 'normalized.json',
      scope: 'original-cvs',
    }),
  ).resolves.toBeNull()

  await localAppData.close()
})

test('rejects a recovered skill that is not supported by the experience evidence and leaves encrypted storage unchanged', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            email: '',
            location: '',
            phone: '',
            professionalLink: '',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Designed workflow systems for AI-assisted desktop tooling and ran UX research across import and export journeys.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Revenue operations'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          '',
          'Summary',
          'Design leader focused on complex workflow products for technical users.',
          '',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Designed workflow systems for AI-assisted desktop tooling and ran UX research across import and export journeys.',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 invented-skill', 'utf8'),
      filename: 'invented-skill.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'weak_normalization',
      message: "We couldn't make sense of this CV. Try a clearer PDF or DOCX.",
    }),
  )
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: null,
    snapshotCount: 0,
  })
  await expect(localAppData.metadata.list('original-cvs')).resolves.toEqual([])
  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-001',
      name: 'normalized.json',
      scope: 'original-cvs',
    }),
  ).resolves.toBeNull()

  await localAppData.close()
})

test('rejects weak normalization output and leaves encrypted storage unchanged', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            email: '',
            location: '',
            phone: '',
            professionalLink: '',
          }),
          experience: [],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design'],
          summary: 'Design leader',
        },
        writingStyle: {
          averageSentenceLength: 12,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Profile',
          'Product design leader for technical workflow tooling and regulated content systems.',
          'Career Highlights',
          'Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          'Core Skills',
          'Workflow design, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 weak', 'utf8'),
      filename: 'weak.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'weak_normalization',
      message: "We couldn't make sense of this CV. Try a clearer PDF or DOCX.",
    }),
  )
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: null,
    snapshotCount: 0,
  })
  await expect(localAppData.metadata.list('original-cvs')).resolves.toEqual([])

  await localAppData.close()
})

test('imports a substantive original CV when normalization leaves the summary blank', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            email: '',
            location: '',
            phone: '',
            professionalLink: '',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Led product design for AI-assisted desktop tooling across import and export flows.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Content systems'],
          summary: '',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          '',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          '',
          'Skills',
          'Workflow design, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 no-summary', 'utf8'),
      filename: 'no-summary.pdf',
    }),
  ).resolves.toEqual({
    fileType: 'pdf',
    headline: 'Principal Product Designer',
    id: 'original-cv-001',
    importedAt: '2026-04-08T14:30:00.000Z',
    originalFilename: 'no-summary.pdf',
    pageCount: 1,
    snapshotCount: 1,
    summary: '',
    writingStyle: {
      averageSentenceLength: 13,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'formal',
    },
  })

  await localAppData.close()
})

test('accepts AI-extracted contact values when they differ only by URL formatting from the extracted CV text', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            professionalLink: 'linkedin.com/in/ada-lovelace',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Led product design for AI-assisted desktop tooling across import and export flows.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Content systems'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          'London, United Kingdom',
          '+44 7700 900123',
          'ada@lovelace.dev',
          'https://www.linkedin.com/in/ada-lovelace',
          'Summary',
          'Design leader focused on complex workflow products for technical users.',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          'Skills',
          'Workflow design, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-005'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T16:00:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 contact-formatting', 'utf8'),
      filename: 'ada-lovelace-contact-formatting.pdf',
    }),
  ).resolves.toMatchObject({
    headline: 'Principal Product Designer',
    id: 'original-cv-005',
  })

  await localAppData.close()
})

test('prefers a portfolio link over LinkedIn and GitHub when multiple grounded professional links are present', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            professionalLink: 'linkedin.com/in/ada-lovelace',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Led product design for AI-assisted desktop tooling across import and export flows.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Content systems'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          'London, United Kingdom',
          '+44 7700 900123',
          'ada@lovelace.dev',
          'https://www.linkedin.com/in/ada-lovelace',
          'https://github.com/ada-lovelace',
          'https://ada-lovelace.dev',
          'Summary',
          'Design leader focused on complex workflow products for technical users.',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          'Skills',
          'Workflow design, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-005a'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T16:05:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 contact-priority', 'utf8'),
      filename: 'ada-lovelace-contact-priority.pdf',
    }),
  ).resolves.toMatchObject({
    headline: 'Principal Product Designer',
    id: 'original-cv-005a',
  })

  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-005a',
      name: 'normalized.json',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(
    Buffer.from(
      JSON.stringify({
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: 'https://ada-lovelace.dev',
        },
        experience: [
          createNormalizedExperienceEntry({
            summary:
              'Led product design for AI-assisted desktop tooling across import and export flows.',
          }),
        ],
        fullName: 'Ada Lovelace',
        headline: 'Principal Product Designer',
        skills: ['Workflow design', 'UX research', 'Content systems'],
        summary: 'Design leader focused on complex workflow products for technical users.',
      }),
      'utf8',
    ),
  )

  await localAppData.close()
})

test('blanks ungrounded AI-extracted contact fields instead of rejecting the original CV import', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            location: 'Stockholm, Sweden',
            phone: '+44 20 7000 0000',
            professionalLink: 'linkedin.com/in/ada-lovelace',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Led product design for AI-assisted desktop tooling across import and export flows.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Content systems'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          'London, United Kingdom',
          '+44 7700 900123',
          'ada@lovelace.dev',
          'Summary',
          'Design leader focused on complex workflow products for technical users.',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          'Skills',
          'Workflow design, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-006'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T16:30:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 sanitize-contact', 'utf8'),
      filename: 'ada-lovelace-sanitize-contact.pdf',
    }),
  ).resolves.toMatchObject({
    headline: 'Principal Product Designer',
    id: 'original-cv-006',
  })

  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-006',
      name: 'normalized.json',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(
    Buffer.from(
      JSON.stringify({
        contact: {
          email: 'ada@lovelace.dev',
          location: '',
          phone: '',
          professionalLink: '',
        },
        experience: [
          createNormalizedExperienceEntry({
            summary:
              'Led product design for AI-assisted desktop tooling across import and export flows.',
          }),
        ],
        fullName: 'Ada Lovelace',
        headline: 'Principal Product Designer',
        skills: ['Workflow design', 'UX research', 'Content systems'],
        summary: 'Design leader focused on complex workflow products for technical users.',
      }),
      'utf8',
    ),
  )

  await localAppData.close()
})

test('does not preserve a professional link that is only implied by an email address substring', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            professionalLink: 'ada-lovelace.dev',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Led product design for AI-assisted desktop tooling across import and export flows.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Content systems'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          'London, United Kingdom',
          '+44 7700 900123',
          'ada@lovelace.dev',
          'Summary',
          'Design leader focused on complex workflow products for technical users.',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          'Skills',
          'Workflow design, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-006b'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T16:45:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 sanitize-link-collision', 'utf8'),
      filename: 'ada-lovelace-link-collision.pdf',
    }),
  ).resolves.toMatchObject({
    headline: 'Principal Product Designer',
    id: 'original-cv-006b',
  })

  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-006b',
      name: 'normalized.json',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(
    Buffer.from(
      JSON.stringify({
        contact: {
          email: 'ada@lovelace.dev',
          location: 'London, United Kingdom',
          phone: '+44 7700 900123',
          professionalLink: '',
        },
        experience: [
          createNormalizedExperienceEntry({
            summary:
              'Led product design for AI-assisted desktop tooling across import and export flows.',
          }),
        ],
        fullName: 'Ada Lovelace',
        headline: 'Principal Product Designer',
        skills: ['Workflow design', 'UX research', 'Content systems'],
        summary: 'Design leader focused on complex workflow products for technical users.',
      }),
      'utf8',
    ),
  )

  await localAppData.close()
})

test('preserves a location in "location, country" format when the country is inferred from a grounded source location', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = createNormalizationServiceMock(
    vi.fn((): Promise<OriginalCvNormalizationResult> => {
      return Promise.resolve({
        normalizedCv: {
          contact: createNormalizedContact({
            location: 'Whitley Bay, United Kingdom',
            phone: '',
            professionalLink: '',
          }),
          experience: [
            createNormalizedExperienceEntry({
              summary:
                'Led product design for AI-assisted desktop tooling across import and export flows.',
            }),
          ],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Workflow design', 'UX research', 'Content systems'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 13,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      })
    }),
  )
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Principal Product Designer',
          '45 Hazeldene',
          'Whitley Bay',
          'NE25 9AL',
          'ada@lovelace.dev',
          'Summary',
          'Design leader focused on complex workflow products for technical users.',
          'Experience',
          'Principal Product Designer | Analytical Engines Ltd',
          'Led product design for AI-assisted desktop tooling across import and export flows.',
          'Skills',
          'Workflow design, UX research, content systems',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-007'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T17:00:00.000Z'),
    localAppData,
    normalizationService,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 inferred-country-location', 'utf8'),
      filename: 'ada-lovelace-location-country.pdf',
    }),
  ).resolves.toMatchObject({
    headline: 'Principal Product Designer',
    id: 'original-cv-007',
  })

  await expect(
    localAppData.artifacts.read({
      id: 'original-cv-007',
      name: 'normalized.json',
      scope: 'original-cvs',
    }),
  ).resolves.toEqual(
    Buffer.from(
      JSON.stringify({
        contact: {
          email: 'ada@lovelace.dev',
          location: 'Whitley Bay, United Kingdom',
          phone: '',
          professionalLink: '',
        },
        experience: [
          createNormalizedExperienceEntry({
            summary:
              'Led product design for AI-assisted desktop tooling across import and export flows.',
          }),
        ],
        fullName: 'Ada Lovelace',
        headline: 'Principal Product Designer',
        skills: ['Workflow design', 'UX research', 'Content systems'],
        summary: 'Design leader focused on complex workflow products for technical users.',
      }),
      'utf8',
    ),
  )

  await localAppData.close()
})

test('rejects a non-English original CV before it becomes the active snapshot', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const originalCvService = createOriginalCvService({
    extractTextFromDocx: vi.fn(),
    extractTextFromPdf: vi.fn(() => {
      return Promise.resolve({
        pageCount: 1,
        text: [
          'Ada Lovelace',
          'Diseñadora principal de producto',
          '',
          'Resumen',
          'Diseña productos para usuarios técnicos con experiencia en flujos de trabajo complejos.',
          '',
          'Experiencia',
          'Diseñadora principal de producto | Analytical Engines Ltd',
          'Dirigió la creación de herramientas de escritorio para equipos técnicos.',
          '',
          'Habilidades',
          'Estrategia de producto, investigación UX, prototipado, comunicación',
        ].join('\n'),
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
    normalizationService: createNormalizationServiceMock(),
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 spanish', 'utf8'),
      filename: 'ada-lovelace-es.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'unsupported_language',
      message:
        'CV Maxxing v1 supports British English only. Use an English original CV to continue.',
    }),
  )
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: null,
    snapshotCount: 0,
  })
  await expect(localAppData.metadata.list('original-cvs')).resolves.toEqual([])

  await localAppData.close()
})

test('rejects unsupported original CV file types before extraction starts', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const extractTextFromPdf = vi.fn()
  const extractTextFromDocx = vi.fn()
  const originalCvService = createOriginalCvService({
    extractTextFromDocx,
    extractTextFromPdf,
    localAppData,
    normalizationService: createNormalizationServiceMock(),
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('plain text', 'utf8'),
      filename: 'resume.txt',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'unsupported_file_type',
      message: 'Original CV import supports PDF and DOCX files only.',
    }),
  )

  expect(extractTextFromPdf).not.toHaveBeenCalled()
  expect(extractTextFromDocx).not.toHaveBeenCalled()

  await localAppData.close()
})
