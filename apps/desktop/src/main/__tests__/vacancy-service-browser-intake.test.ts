import { expect, test, vi } from 'vitest'

import { createVacancyService } from '../vacancy-service.js'
import type {
  JsonValue,
  LocalAppDataStore,
  MetadataRecord,
  MetadataSelector,
} from '../local-app-data-service.js'
import type { VacancyBrowserPageSnapshot } from '../vacancy-browser-session-service.js'
import type {
  VacancyNormalizationInput,
  VacancyNormalizationService,
} from '../vacancy-normalization-service.js'

type TestLocalAppData = Pick<LocalAppDataStore, 'artifacts' | 'metadata'>

interface MemoryArtifactSelector {
  id: string
  name: string
  scope: string
}

interface MemoryArtifactListSelector {
  id: string
  scope: string
}

interface MemoryArtifactWriteInput extends MemoryArtifactSelector {
  content: Buffer
}

function createMemoryLocalAppData(): TestLocalAppData {
  const artifacts = new Map<string, Buffer>()
  const metadata = new Map<string, JsonValue>()

  const localAppData = {
    artifacts: {
      delete: ({ id, name, scope }: MemoryArtifactSelector) => {
        artifacts.delete(createStorageKey({ id, name, scope }))

        return Promise.resolve()
      },
      list: ({ id, scope }: MemoryArtifactListSelector) => {
        const prefix = createStorageKeyPrefix({ id, scope })
        const names = [...artifacts.keys()]
          .filter((key) => {
            return key.startsWith(prefix)
          })
          .map((key) => {
            return key.slice(prefix.length)
          })

        return Promise.resolve(names)
      },
      read: ({ id, name, scope }: MemoryArtifactSelector) => {
        return Promise.resolve(artifacts.get(createStorageKey({ id, name, scope })) ?? null)
      },
      write: ({ content, id, name, scope }: MemoryArtifactWriteInput) => {
        artifacts.set(createStorageKey({ id, name, scope }), content)

        return Promise.resolve()
      },
    },
    metadata: {
      delete: ({ id, scope }: MetadataSelector) => {
        metadata.delete(createStorageKey({ id, scope }))

        return Promise.resolve()
      },
      get: ({ id, scope }: MetadataSelector) => {
        return Promise.resolve(metadata.get(createStorageKey({ id, scope })) ?? null)
      },
      list: (scope: string) => {
        const records = [...metadata.entries()]
          .filter(([key]) => {
            return key.startsWith(`${scope}:`)
          })
          .map(([key, value]) => {
            return {
              id: key.slice(scope.length + 1),
              value,
            } satisfies MetadataRecord
          })

        return Promise.resolve(records)
      },
      put: ({ id, scope, value }: { id: string; scope: string; value: JsonValue }) => {
        metadata.set(createStorageKey({ id, scope }), value)

        return Promise.resolve()
      },
    },
  }

  return localAppData as unknown as TestLocalAppData
}

function createStorageKey({
  id,
  name,
  scope,
}: {
  id: string
  name?: string
  scope: string
}): string {
  return name === undefined ? `${scope}:${id}` : `${scope}:${id}:${name}`
}

function createStorageKeyPrefix({ id, scope }: { id: string; scope: string }): string {
  return `${scope}:${id}:`
}

test('waits for actual rendered vacancy evidence before normalizing a generic careers URL', async () => {
  const localAppData = createMemoryLocalAppData()
  const normalizationCalls: VacancyNormalizationInput[] = []
  const careersShellSnapshot = {
    html: [
      '<html>',
      '<body>',
      '<main>',
      '<h1>Example Labs careers</h1>',
      '<p>Explore teams, benefits, interview guidance, and open positions at Example Labs.</p>',
      '<div id="jobs-board">Preparing available roles.</div>',
      '</main>',
      '</body>',
      '</html>',
    ].join(''),
    pageTitle: 'Example Labs careers',
    resolvedUrl: 'https://careers.example.com/jobs/senior-product-designer',
  } satisfies VacancyBrowserPageSnapshot
  const renderedVacancySnapshot = {
    html: [
      '<html>',
      '<body>',
      '<main>',
      '<article>',
      '<h1>Senior Product Designer</h1>',
      '<p>Example Labs</p>',
      '<p>London, United Kingdom</p>',
      '<section><h2>Responsibilities</h2><ul><li>Lead browser-mediated intake for desktop workflows.</li><li>Partner with engineering and research.</li></ul></section>',
      '<section><h2>Requirements</h2><ul><li>Experience shipping workflow software.</li><li>Excellent written communication.</li></ul></section>',
      '</article>',
      '</main>',
      '</body>',
      '</html>',
    ].join(''),
    pageTitle: 'Senior Product Designer at Example Labs',
    resolvedUrl: 'https://careers.example.com/jobs/senior-product-designer#role',
  } satisfies VacancyBrowserPageSnapshot
  const normalizationService = {
    normalizeVacancy: vi.fn((input: VacancyNormalizationInput) => {
      normalizationCalls.push(input)

      return Promise.resolve({
        bodyText:
          'Lead browser-mediated intake for desktop workflows. Partner with engineering and research.',
        employer: 'Example Labs',
        location: 'London, United Kingdom',
        requirements: ['Experience shipping workflow software.'],
        responsibilities: ['Lead browser-mediated intake for desktop workflows.'],
        title: 'Senior Product Designer',
      })
    }),
  } satisfies VacancyNormalizationService
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage: vi.fn(
      ({
        shouldCapturePage,
      }: {
        shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
      }) => {
        expect(shouldCapturePage(careersShellSnapshot)).toBe(false)
        expect(shouldCapturePage(renderedVacancySnapshot)).toBe(true)

        return Promise.resolve(renderedVacancySnapshot)
      },
    ),
    generateId: vi.fn(() => 'vacancy-rendered-evidence'),
    getCurrentTimestamp: vi.fn(() => '2026-05-15T22:00:00.000Z'),
    localAppData,
    normalizationService,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://careers.example.com/jobs/senior-product-designer',
  })

  expect(result.kind).toBe('ingested')
  expect(result.vacancy.canGenerate).toBe(true)
  expect(result.vacancy.source).toBe('careers.example.com')
  expect(normalizationCalls).toHaveLength(1)
  expect(normalizationCalls[0]?.html).toContain('<h1>Senior Product Designer</h1>')
  await expect(
    localAppData.artifacts.read({
      id: 'vacancy-rendered-evidence',
      name: 'snapshot.html',
      scope: 'vacancies',
    }),
  ).resolves.toEqual(expect.any(Buffer))
})
