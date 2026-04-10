import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js'
import { createVacancyService } from '../vacancy-service.js'
import type { KeychainBoundary, LocalAppDataPaths } from '../local-app-data-service.js'
import type {
  VacancyNormalizationInput,
  VacancyNormalizationService,
} from '../vacancy-normalization-service.js'

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

function createVacancyNormalizationServiceDouble(): VacancyNormalizationService {
  return {
    normalizeVacancy: vi.fn(() => {
      return Promise.resolve({
        bodyText:
          'Lead product design for desktop workflows. Partner with engineering and research.',
        employer: 'Example Labs',
        location: 'London, United Kingdom',
        requirements: ['Experience shipping workflow software.'],
        responsibilities: ['Lead product design for desktop workflows.'],
        title: 'Senior Product Designer',
      })
    }),
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
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
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
  const normalizationCalls: VacancyNormalizationInput[] = []

  const normalizationService = {
    normalizeVacancy: vi.fn((input: VacancyNormalizationInput) => {
      normalizationCalls.push(input)

      return Promise.resolve({
        bodyText:
          'Lead product design for desktop workflows. Partner with engineering and research.',
        employer: 'Example Labs',
        location: 'London, United Kingdom',
        requirements: ['Experience shipping workflow software.'],
        responsibilities: ['Lead product design for desktop workflows.'],
        title: 'Senior Product Designer',
      })
    }),
  } satisfies VacancyNormalizationService
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
    normalizationService,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
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
  const normalizationCall = normalizationCalls[0]

  expect(normalizationCall).toBeDefined()

  if (normalizationCall === undefined) {
    throw new Error('Expected vacancy normalization input to be captured.')
  }

  expect(normalizationCall.html).toContain('<h1>Senior Product Designer</h1>')
  expect(normalizationCall.originalUrl).toBe('https://boards.greenhouse.io/example/jobs/123')
  expect(normalizationCall.pageTitle).toBe('Senior Product Designer at Example Labs - Greenhouse')
  expect(normalizationCall.resolvedUrl).toBe('https://boards.greenhouse.io/example/jobs/123')
  expect(normalizationCall.source).toBe('greenhouse')

  const extractedArtifact = await localAppData.artifacts.read({
    id: 'vacancy-002',
    name: 'extracted.txt',
    scope: 'vacancies',
  })
  const snapshotArtifact = await localAppData.artifacts.read({
    id: 'vacancy-002',
    name: 'snapshot.html',
    scope: 'vacancies',
  })
  const normalizedArtifact = await localAppData.artifacts.read({
    id: 'vacancy-002',
    name: 'normalized.json',
    scope: 'vacancies',
  })

  expect(extractedArtifact?.toString('utf8')).toBe(
    'Lead product design for desktop workflows. Partner with engineering and research.',
  )
  expect(normalizedArtifact?.toString('utf8')).toBe(
    JSON.stringify({
      bodyText: 'Lead product design for desktop workflows. Partner with engineering and research.',
      employer: 'Example Labs',
      location: 'London, United Kingdom',
      requirements: ['Experience shipping workflow software.'],
      responsibilities: ['Lead product design for desktop workflows.'],
      title: 'Senior Product Designer',
    }),
  )
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
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
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

test('ingests a browser-assisted LinkedIn vacancy into a ready preview and persists a sanitized snapshot', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-006'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:18:00.000Z'),
    localAppData,
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession: vi.fn(() => {
      return Promise.resolve({
        html: [
          '<html>',
          '<head>',
          '<script>localStorage.setItem("sessionToken", "top-secret-token")</script>',
          '</head>',
          '<body>',
          '<main>',
          '<h1>Senior Product Designer</h1>',
          '<p>Example Labs</p>',
          '<p>London, United Kingdom</p>',
          '<section><h2>Responsibilities</h2><ul><li>Lead product design for authenticated desktop workflows.</li><li>Partner with engineering and research.</li></ul></section>',
          '<section><h2>Requirements</h2><ul><li>Experience shipping workflow software.</li><li>Excellent written communication.</li></ul></section>',
          '<input type="hidden" name="sessionToken" value="top-secret-token" />',
          '</main>',
          '</body>',
          '</html>',
        ].join(''),
        pageTitle: 'Senior Product Designer | LinkedIn',
        resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
      })
    }),
  })

  await vacancyService.ingestVacancyUrl({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  const result = await vacancyService.openBrowserSession({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  expect(result.kind).toBe('ingested')
  expect(result.vacancy.id).toBe('vacancy-006')
  expect(result.vacancy.source).toBe('linkedin')
  expect(result.vacancy.canGenerate).toBe(true)
  expect(result.vacancy.title).toBe('Senior Product Designer')
  expect(result.workspaceState.draft).toEqual({
    text: '',
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  const snapshotArtifact = await localAppData.artifacts.read({
    id: 'vacancy-006',
    name: 'snapshot.html',
    scope: 'vacancies',
  })

  expect(snapshotArtifact?.toString('utf8')).toContain('Senior Product Designer')
  expect(snapshotArtifact?.toString('utf8')).not.toContain('localStorage')
  expect(snapshotArtifact?.toString('utf8')).not.toContain('sessionToken')
  expect(snapshotArtifact?.toString('utf8')).not.toContain('top-secret-token')

  await localAppData.close()
})

test('keeps the internal browser session blocked when LinkedIn redirects away from the requested vacancy after sign-in', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const openVacancyBrowserSession = vi.fn(
    ({
      shouldCapturePage,
    }: {
      shouldCapturePage: (snapshot: {
        html: string
        pageTitle: string | null
        resolvedUrl: string
      }) => boolean
    }) => {
      const redirectedSnapshot = {
        html: [
          '<html>',
          '<body>',
          '<main>',
          '<h1>LinkedIn Feed</h1>',
          '<p>Welcome back.</p>',
          '<section><h2>Responsibilities</h2><ul><li>Catch up on product design posts from your network.</li><li>Review updates from people you follow.</li></ul></section>',
          '<section><h2>Requirements</h2><ul><li>Stay signed in to continue browsing LinkedIn.</li><li>Explore more jobs after authentication.</li></ul></section>',
          '</main>',
          '</body>',
          '</html>',
        ].join(''),
        pageTitle: 'Feed | LinkedIn',
        resolvedUrl: 'https://www.linkedin.com/feed/',
      }

      expect(shouldCapturePage(redirectedSnapshot)).toBe(false)

      return Promise.resolve(null)
    },
  )
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-006b'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:18:30.000Z'),
    localAppData,
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession,
  })

  await vacancyService.ingestVacancyUrl({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  const result = await vacancyService.openBrowserSession({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toContain('Close the internal browser session')
  expect(result.workspaceState.draft).toEqual({
    text: '',
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  await localAppData.close()
})

test('does not persist a browser snapshot when the session closes on a different LinkedIn page than the requested vacancy', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-006c'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:18:45.000Z'),
    localAppData,
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession: vi.fn(() => {
      return Promise.resolve({
        html: [
          '<html>',
          '<body>',
          '<main>',
          '<h1>LinkedIn Feed</h1>',
          '<p>Welcome back.</p>',
          '<section><h2>Responsibilities</h2><ul><li>Catch up on product design posts from your network.</li><li>Review updates from people you follow.</li></ul></section>',
          '<section><h2>Requirements</h2><ul><li>Stay signed in to continue browsing LinkedIn.</li><li>Explore more jobs after authentication.</li></ul></section>',
          '</main>',
          '</body>',
          '</html>',
        ].join(''),
        pageTitle: 'Feed | LinkedIn',
        resolvedUrl: 'https://www.linkedin.com/feed/',
      })
    }),
  })

  await vacancyService.ingestVacancyUrl({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  const result = await vacancyService.openBrowserSession({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.workspaceState.vacancy).toBeNull()
  await expect(
    localAppData.metadata.get({
      id: 'vacancy-006c',
      scope: 'vacancies',
    }),
  ).resolves.toBeNull()

  await localAppData.close()
})

test('returns an incomplete browser-assisted preview, preserves the vacancy draft, and keeps adaptation blocked when the authenticated page is still incomplete', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-007'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:19:00.000Z'),
    localAppData,
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession: vi.fn(() => {
      return Promise.resolve({
        html: [
          '<html>',
          '<body>',
          '<main>',
          '<h1>Sign in to view this job</h1>',
          '<p>Join LinkedIn or sign in to continue.</p>',
          '</main>',
          '</body>',
          '</html>',
        ].join(''),
        pageTitle: 'Sign in to view this job | LinkedIn',
        resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
      })
    }),
  })

  await vacancyService.ingestVacancyUrl({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  const result = await vacancyService.openBrowserSession({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.source).toBe('linkedin')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toContain('sign-in wall')
  expect(result.workspaceState.draft).toEqual({
    text: '',
    url: 'https://www.linkedin.com/jobs/view/123456',
  })
  expect(result.workspaceState.vacancy).toEqual(
    expect.objectContaining({
      id: 'vacancy-007',
      status: 'incomplete',
      title: 'Sign in to view this job | LinkedIn',
    }),
  )

  await localAppData.close()
})

test('derives generic URL review readiness from the normalized vacancy object and keeps the external workspace contract intact', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = {
    normalizeVacancy: vi.fn(() => {
      return Promise.resolve({
        bodyText:
          'Design the workflow surface for authenticated job-vacancy review. Partner with engineering to ship desktop product improvements and document system behaviour for operators across desktop import, preview, and export flows without dropping factual vacancy detail.',
        employer: null,
        location: null,
        requirements: [],
        responsibilities: [],
        title: 'Senior Product Designer',
      })
    }),
  } satisfies VacancyNormalizationService
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
    normalizationService,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://careers.example.com/product-designer',
  })

  expect(result.kind).toBe('ingested')
  expect(result.vacancy.source).toBe('generic')
  expect(result.vacancy.canGenerate).toBe(true)
  expect(result.vacancy.blockingReason).toBeNull()
  expect(result.vacancy.title).toBe('Senior Product Designer')
  expect(result.vacancy.textPreview).toContain('Design the workflow surface')
  await expect(vacancyService.getWorkspaceState()).resolves.toEqual({
    draft: {
      text: '',
      url: 'https://careers.example.com/product-designer',
    },
    vacancy: {
      blockingReason: null,
      canGenerate: true,
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
      status: 'ready',
      textPreview:
        'Design the workflow surface for authenticated job-vacancy review. Partner with engineering to ship desktop product improvements and document system behaviour for operators across desktop import, preview, and export flows without dropping factual vacancy detail.',
      title: 'Senior Product Designer',
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
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
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

test('blocks a non-English pasted vacancy while preserving the entered draft', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-008'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:40:00.000Z'),
    localAppData,
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const text = [
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
  ].join('\n')

  const result = await vacancyService.ingestPastedVacancy({
    text,
    url: 'https://jobs.example.com/platform-engineer-es',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toBe(
    'CV Maxxing v1 supports British English only. Review an English job vacancy before adapting this CV.',
  )
  const workspaceState = await vacancyService.getWorkspaceState()

  expect(workspaceState.draft).toEqual({
    text,
    url: 'https://jobs.example.com/platform-engineer-es',
  })
  expect(workspaceState.vacancy).toMatchObject({
    blockingReason:
      'CV Maxxing v1 supports British English only. Review an English job vacancy before adapting this CV.',
    canGenerate: false,
    id: 'vacancy-008',
    originalUrl: 'https://jobs.example.com/platform-engineer-es',
    status: 'incomplete',
  })

  await localAppData.close()
})

test('blocks a non-English fetched vacancy page while preserving the entered URL', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const normalizationService = {
    normalizeVacancy: vi.fn(() => {
      return Promise.resolve({
        bodyText:
          'Ingeniero de plataforma Diseñar productos para usuarios técnicos. Colaborar con ingeniería e investigación.',
        employer: 'Example Labs',
        location: 'Madrid, España',
        requirements: ['Experiencia enviando software de flujo de trabajo.'],
        responsibilities: ['Diseñar productos para usuarios técnicos.'],
        title: 'Ingeniero de plataforma',
      })
    }),
  } satisfies VacancyNormalizationService
  const vacancyService = createVacancyService({
    fetchVacancyPage: vi.fn(() => {
      return Promise.resolve({
        html: [
          '<html>',
          '<head><title>Ingeniero de plataforma en Example Labs</title></head>',
          '<body>',
          '<main>',
          '<h1>Ingeniero de plataforma</h1>',
          '<p>Example Labs</p>',
          '<p>Madrid, España</p>',
          '<section><h2>Responsabilidades</h2><ul><li>Diseñar productos para usuarios técnicos.</li><li>Colaborar con ingeniería e investigación.</li></ul></section>',
          '<section><h2>Requisitos</h2><ul><li>Experiencia enviando software de flujo de trabajo.</li><li>Comunicación escrita sólida.</li></ul></section>',
          '</main>',
          '</body>',
          '</html>',
        ].join(''),
        pageTitle: 'Ingeniero de plataforma en Example Labs',
        resolvedUrl: 'https://careers.example.com/platform-engineer-es',
      })
    }),
    generateId: vi.fn(() => 'vacancy-009'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:45:00.000Z'),
    localAppData,
    normalizationService,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://careers.example.com/platform-engineer-es',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toBe(
    'CV Maxxing v1 supports British English only. Review an English job vacancy before adapting this CV.',
  )
  const workspaceState = await vacancyService.getWorkspaceState()

  expect(workspaceState.draft).toEqual({
    text: '',
    url: 'https://careers.example.com/platform-engineer-es',
  })
  expect(workspaceState.vacancy).toMatchObject({
    blockingReason:
      'CV Maxxing v1 supports British English only. Review an English job vacancy before adapting this CV.',
    canGenerate: false,
    id: 'vacancy-009',
    resolvedUrl: 'https://careers.example.com/platform-engineer-es',
    status: 'incomplete',
  })

  await localAppData.close()
})

test('blocks a non-English browser-captured vacancy while preserving the entered URL', async () => {
  const paths = await createTestPaths()
  const localAppData = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-010'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:50:00.000Z'),
    localAppData,
    normalizationService: createVacancyNormalizationServiceDouble(),
    openVacancyBrowserSession: vi.fn(() => {
      return Promise.resolve({
        html: [
          '<html>',
          '<body>',
          '<main>',
          '<h1>Ingeniero de plataforma</h1>',
          '<p>Example Labs</p>',
          '<p>Madrid, España</p>',
          '<section><h2>Responsabilidades</h2><ul><li>Diseñar productos para usuarios técnicos.</li><li>Colaborar con ingeniería e investigación.</li></ul></section>',
          '<section><h2>Requisitos</h2><ul><li>Experiencia enviando software de flujo de trabajo.</li><li>Comunicación escrita sólida.</li></ul></section>',
          '</main>',
          '</body>',
          '</html>',
        ].join(''),
        pageTitle: 'Ingeniero de plataforma | LinkedIn',
        resolvedUrl: 'https://www.linkedin.com/jobs/view/654321',
      })
    }),
  })

  await vacancyService.ingestVacancyUrl({
    url: 'https://www.linkedin.com/jobs/view/654321',
  })

  const result = await vacancyService.openBrowserSession({
    url: 'https://www.linkedin.com/jobs/view/654321',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toBe(
    'CV Maxxing v1 supports British English only. Review an English job vacancy before adapting this CV.',
  )
  expect(result.workspaceState.draft).toEqual({
    text: '',
    url: 'https://www.linkedin.com/jobs/view/654321',
  })

  await localAppData.close()
})
