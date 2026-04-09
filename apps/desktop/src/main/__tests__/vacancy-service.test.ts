import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js'
import { createVacancyService } from '../vacancy-service.js'
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
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-vacancy-service-'))

  temporaryDirectories.push(rootDirectoryPath)

  return createLocalAppDataPaths(rootDirectoryPath)
}

function createKeychainBoundary(secret = Buffer.alloc(32, 7)): KeychainBoundary {
  return {
    clearAppDataKey: vi.fn(() => Promise.resolve()),
    getOrCreateAppDataKey: vi.fn(() => Promise.resolve(secret)),
  }
}

test('ingests pasted vacancy text into a ready preview and persists encrypted vacancy artifacts', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-001'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:00:00.000Z'),
    localAppData,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve()),
  })

  const result = await vacancyService.ingestPastedVacancy({
    text: [
      'Senior Product Designer',
      'Example Labs',
      'London, United Kingdom',
      '',
      'Responsibilities',
      '- Lead product design for AI-assisted desktop workflows.',
      '- Partner with engineering and research teams.',
      '',
      'Requirements',
      '- Experience shipping workflow products.',
      '- Strong written communication.',
    ].join('\n'),
    url: 'https://jobs.example.com/senior-product-designer',
  })

  expect(result.kind).toBe('ingested')
  expect(result.vacancy.id).toBe('vacancy-001')
  expect(result.vacancy.source).toBe('generic')
  expect(result.vacancy.inputType).toBe('pasted_text')
  expect(result.vacancy.title).toBe('Senior Product Designer')
  expect(result.vacancy.employer).toBe('Example Labs')
  expect(result.vacancy.location).toBe('London, United Kingdom')
  expect(result.vacancy.canGenerate).toBe(true)
  expect(result.vacancy.blockingReason).toBeNull()
  expect(result.vacancy.requirements).toContain('Experience shipping workflow products.')
  expect(result.vacancy.responsibilities).toContain(
    'Lead product design for AI-assisted desktop workflows.',
  )

  await expect(
    localAppData.metadata.get<{
      originalUrl: string | null
      source: string
      title: string | null
    }>({
      id: 'vacancy-001',
      scope: 'vacancies',
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      originalUrl: 'https://jobs.example.com/senior-product-designer',
      source: 'generic',
      title: 'Senior Product Designer',
    }),
  )
  await expect(
    localAppData.artifacts.read({
      id: 'vacancy-001',
      name: 'extracted.txt',
      scope: 'vacancies',
    }),
  ).resolves.toEqual(
    Buffer.from(
      [
        'Senior Product Designer',
        'Example Labs',
        'London, United Kingdom',
        '',
        'Responsibilities',
        '- Lead product design for AI-assisted desktop workflows.',
        '- Partner with engineering and research teams.',
        '',
        'Requirements',
        '- Experience shipping workflow products.',
        '- Strong written communication.',
      ].join('\n'),
      'utf8',
    ),
  )
  const normalizedArtifact = await localAppData.artifacts.read({
    id: 'vacancy-001',
    name: 'normalized.json',
    scope: 'vacancies',
  })

  expect(normalizedArtifact?.toString('utf8')).toContain('"title":"Senior Product Designer"')
  expect(normalizedArtifact?.toString('utf8')).toContain('"employer":"Example Labs"')

  await localAppData.close()
})

test('classifies a Greenhouse vacancy URL, fetches it deterministically, and persists the sanitized snapshot', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    fetchVacancyPage: vi.fn(() => {
      return Promise.resolve({
        html: [
          '<html>',
          '<head><title>Senior Product Designer at Example Labs - Greenhouse</title></head>',
          '<body>',
          '<main>',
          '<h1>Senior Product Designer</h1>',
          '<p>Example Labs</p>',
          '<p>London, United Kingdom</p>',
          '<section><h2>Responsibilities</h2><ul><li>Lead product design for desktop workflows.</li><li>Partner with engineering and research.</li></ul></section>',
          '<section><h2>Requirements</h2><ul><li>Experience shipping workflow software.</li><li>Excellent written communication.</li></ul></section>',
          '</main>',
          '</body>',
          '</html>',
        ].join(''),
        pageTitle: 'Senior Product Designer at Example Labs - Greenhouse',
        resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123',
      })
    }),
    generateId: vi.fn(() => 'vacancy-002'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:10:00.000Z'),
    localAppData,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve()),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://boards.greenhouse.io/example/jobs/123',
  })

  expect(result.kind).toBe('ingested')
  expect(result.vacancy.source).toBe('greenhouse')
  expect(result.vacancy.inputType).toBe('url')
  expect(result.vacancy.title).toBe('Senior Product Designer')
  expect(result.vacancy.employer).toBe('Example Labs')
  expect(result.vacancy.location).toBe('London, United Kingdom')
  expect(result.vacancy.canGenerate).toBe(true)

  const snapshotArtifact = await localAppData.artifacts.read({
    id: 'vacancy-002',
    name: 'snapshot.html',
    scope: 'vacancies',
  })

  expect(snapshotArtifact?.toString('utf8')).toContain('<h1>Senior Product Designer</h1>')
  expect(snapshotArtifact?.toString('utf8')).not.toContain('localStorage')

  await localAppData.close()
})

test('preserves a LinkedIn vacancy URL and blocks generation until the browser-assisted fallback is used', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const fetchVacancyPage = vi.fn()
  const vacancyService = createVacancyService({
    fetchVacancyPage,
    generateId: vi.fn(() => 'vacancy-003'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:15:00.000Z'),
    localAppData,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve()),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.source).toBe('linkedin')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toContain('Open the internal browser session')
  expect(fetchVacancyPage).not.toHaveBeenCalled()
  await expect(vacancyService.getWorkspaceState()).resolves.toEqual({
    draft: {
      text: '',
      url: 'https://www.linkedin.com/jobs/view/123456',
    },
    vacancy: null,
  })

  await localAppData.close()
})

test('blocks a generic vacancy preview when the fetched page only contains a cookie banner and preserves the entered URL', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    fetchVacancyPage: vi.fn(() => {
      return Promise.resolve({
        html: [
          '<html>',
          '<body>',
          '<main>',
          '<div>Accept cookies to continue</div>',
          '<button>Accept all cookies</button>',
          '</main>',
          '</body>',
          '</html>',
        ].join(''),
        pageTitle: 'Cookie banner',
        resolvedUrl: 'https://careers.example.com/product-designer',
      })
    }),
    generateId: vi.fn(() => 'vacancy-004'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:20:00.000Z'),
    localAppData,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve()),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://careers.example.com/product-designer',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.source).toBe('generic')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toContain('cookie banner')
  await expect(vacancyService.getWorkspaceState()).resolves.toEqual({
    draft: {
      text: '',
      url: 'https://careers.example.com/product-designer',
    },
    vacancy: {
      blockingReason:
        'This vacancy page looks incomplete because it only exposed a cookie banner or placeholder content.',
      canGenerate: false,
      employer: null,
      fetchedAt: '2026-04-08T21:20:00.000Z',
      id: 'vacancy-004',
      inputType: 'url',
      location: null,
      originalUrl: 'https://careers.example.com/product-designer',
      requirements: [],
      resolvedUrl: 'https://careers.example.com/product-designer',
      responsibilities: [],
      source: 'generic',
      status: 'incomplete',
      textPreview: 'Accept cookies to continue Accept all cookies',
      title: 'Cookie banner',
    },
  })

  await localAppData.close()
})

test('clears the persisted vacancy workspace draft without deleting the stored vacancy snapshot', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-005'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:30:00.000Z'),
    localAppData,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve()),
  })

  await vacancyService.ingestPastedVacancy({
    text: [
      'Senior Product Designer',
      'Example Labs',
      'London, United Kingdom',
      '',
      'Responsibilities',
      '- Lead product design for AI-assisted desktop workflows.',
      '- Partner with engineering and research teams.',
      '',
      'Requirements',
      '- Experience shipping workflow products.',
      '- Strong written communication.',
    ].join('\n'),
    url: 'https://jobs.example.com/senior-product-designer',
  })
  await vacancyService.resetWorkspaceState()

  await expect(vacancyService.getWorkspaceState()).resolves.toEqual({
    draft: {
      text: '',
      url: '',
    },
    vacancy: null,
  })
  await expect(
    localAppData.metadata.get<{
      title: string | null
    }>({
      id: 'vacancy-005',
      scope: 'vacancies',
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      title: 'Senior Product Designer',
    }),
  )

  await localAppData.close()
})
