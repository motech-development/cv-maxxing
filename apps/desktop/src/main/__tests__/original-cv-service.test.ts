import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js'
import { OriginalCvImportError, createOriginalCvService } from '../original-cv-service.js'
import type { KeychainBoundary, LocalAppDataPaths } from '../local-app-data-service.js'

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

test('imports the first original CV snapshot and persists encrypted source, text, normalized JSON, and writing style artifacts', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
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
  expect(importedCv.writingStyle.clicheDetections).toEqual([])
  expect(importedCv.writingStyle.firstPersonUsage).toBe('absent')

  expect(importedCv.writingStyle.averageSentenceLength).toBeGreaterThan(0)

  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: importedCv,
    snapshotCount: 1,
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

  expect(styleArtifact?.toString('utf8')).toContain('"firstPersonUsage":"absent"')

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

test('rejects an unreadable replacement and keeps the previous original CV snapshot active', async () => {
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
      text: '%%%% 12345 ###',
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
      code: 'weak_extraction',
      message: 'This original CV could not be read reliably. Use a text-based PDF or DOCX.',
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

  await localAppData.close()
})

test('rejects weakly extracted original CV content and leaves encrypted storage unchanged', async () => {
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
        text: '%%%% 12345 ###',
      })
    }),
    generateId: vi.fn(() => 'original-cv-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T14:30:00.000Z'),
    localAppData,
  })

  await expect(
    originalCvService.importOriginalCv({
      content: Buffer.from('%PDF-1.7 broken', 'utf8'),
      filename: 'broken.pdf',
    }),
  ).rejects.toEqual(
    new OriginalCvImportError({
      code: 'weak_extraction',
      message: 'This original CV could not be read reliably. Use a text-based PDF or DOCX.',
    }),
  )
  await expect(originalCvService.getWorkspaceState()).resolves.toEqual({
    activeOriginalCv: null,
    snapshotCount: 0,
  })
  await expect(localAppData.metadata.list('original-cvs')).resolves.toEqual([])

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
