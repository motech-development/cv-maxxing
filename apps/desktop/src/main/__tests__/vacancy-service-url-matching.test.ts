import { expect, test, vi } from 'vitest'

import { createVacancyService } from '../vacancy-service.js'
import type {
  JsonValue,
  LocalAppDataStore,
  MetadataRecord,
  MetadataSelector,
} from '../local-app-data-service.js'
import type {
  VacancyNormalizationInput,
  VacancyNormalizationService,
} from '../vacancy-normalization-service.js'

function createRecordKey({ id, scope }: { id: string; scope: string }): string {
  return `${scope}:${id}`
}

function createLocalAppDataDouble(): Pick<LocalAppDataStore, 'artifacts' | 'metadata'> {
  const metadataRecords = new Map<string, JsonValue>()
  const metadataGet: LocalAppDataStore['metadata']['get'] = <TValue extends JsonValue = JsonValue>(
    selector: MetadataSelector,
  ) => {
    const value = metadataRecords.get(createRecordKey(selector))

    return Promise.resolve(value === undefined ? null : (value as TValue))
  }
  const metadataList: LocalAppDataStore['metadata']['list'] = <
    TValue extends JsonValue = JsonValue,
  >(): Promise<MetadataRecord<TValue>[]> => {
    return Promise.resolve([])
  }
  const metadataDelete: LocalAppDataStore['metadata']['delete'] = (selector) => {
    metadataRecords.delete(createRecordKey(selector))

    return Promise.resolve()
  }
  const metadataPut: LocalAppDataStore['metadata']['put'] = ({ id, scope, value }) => {
    metadataRecords.set(createRecordKey({ id, scope }), value)

    return Promise.resolve()
  }

  return {
    artifacts: {
      delete: vi.fn(() => Promise.resolve()),
      list: vi.fn(() => Promise.resolve([])),
      read: vi.fn(() => Promise.resolve(null)),
      write: vi.fn(() => Promise.resolve()),
    },
    metadata: {
      delete: metadataDelete,
      get: metadataGet,
      list: metadataList,
      put: metadataPut,
    },
  }
}

function createReadyNormalizationService(
  calls: VacancyNormalizationInput[],
): VacancyNormalizationService {
  return {
    normalizeVacancy: vi.fn((input: VacancyNormalizationInput) => {
      calls.push(input)

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
  }
}

test('accepts browser-captured vacancy pages when the resolved URL preserves submitted query parameters and appends browser state', async () => {
  const localAppData = createLocalAppDataDouble()
  const normalizationCalls: VacancyNormalizationInput[] = []
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage: vi.fn(() => {
      return Promise.resolve({
        html: '<main><h1>Senior Product Designer</h1></main>',
        pageTitle: 'Senior Product Designer at Example Labs',
        resolvedUrl:
          'https://careers.example.com/jobs/123?jobId=123&session=managed-browser#details',
      })
    }),
    generateId: vi.fn(() => 'vacancy-canonical-query'),
    getCurrentTimestamp: vi.fn(() => '2026-05-15T20:10:00.000Z'),
    localAppData,
    normalizationService: createReadyNormalizationService(normalizationCalls),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://careers.example.com/jobs/123/?jobId=123',
  })

  expect(result.kind).toBe('ingested')
  expect(result.vacancy.resolvedUrl).toBe(
    'https://careers.example.com/jobs/123?jobId=123&session=managed-browser#details',
  )
  expect(normalizationCalls).toHaveLength(1)
  expect(normalizationCalls[0]?.resolvedUrl).toBe(
    'https://careers.example.com/jobs/123?jobId=123&session=managed-browser#details',
  )
})

test('rejects browser-captured vacancy pages when the resolved URL changes submitted query parameters', async () => {
  const localAppData = createLocalAppDataDouble()
  const normalizationCalls: VacancyNormalizationInput[] = []
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage: vi.fn(() => {
      return Promise.resolve({
        html: '<main><h1>Different Senior Product Designer</h1></main>',
        pageTitle: 'Different Senior Product Designer at Example Labs',
        resolvedUrl: 'https://careers.example.com/jobs/123?jobId=456',
      })
    }),
    localAppData,
    normalizationService: createReadyNormalizationService(normalizationCalls),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://careers.example.com/jobs/123?jobId=123',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toBe(
    'This job page may need more access. Open the job page or paste the job description instead.',
  )
  expect(normalizationCalls).toHaveLength(0)
})
