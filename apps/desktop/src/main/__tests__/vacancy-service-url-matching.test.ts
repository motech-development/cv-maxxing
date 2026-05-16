import { expect, test, vi } from 'vitest'

import { VacancyNormalizationError } from '../vacancy-normalization-error.js'
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

test('accepts browser-captured vacancy pages when only the URL hash changes', async () => {
  const localAppData = createLocalAppDataDouble()
  const normalizationCalls: VacancyNormalizationInput[] = []
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage: vi.fn(() => {
      return Promise.resolve({
        html: [
          '<main>',
          '<h1>Senior Product Designer</h1>',
          '<p>Lead browser-mediated intake for desktop workflows.</p>',
          '</main>',
        ].join(''),
        pageTitle: 'Senior Product Designer at Example Labs',
        resolvedUrl: 'https://careers.example.com/jobs/123?jobId=123#details',
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
  expect(result.vacancy.resolvedUrl).toBe('https://careers.example.com/jobs/123?jobId=123#details')
  expect(normalizationCalls).toHaveLength(1)
  expect(normalizationCalls[0]?.resolvedUrl).toBe(
    'https://careers.example.com/jobs/123?jobId=123#details',
  )
})

test('waits for rendered vacancy evidence before accepting a browser-captured URL match', async () => {
  const localAppData = createLocalAppDataDouble()
  const normalizationCalls: VacancyNormalizationInput[] = []
  const captureVacancyBrowserSessionPage = vi.fn(
    ({
      shouldCapturePage,
    }: {
      shouldCapturePage: (snapshot: {
        html: string
        pageTitle: string | null
        resolvedUrl: string
      }) => boolean
    }) => {
      const loadingSnapshot = {
        html: '<main><h1>Loading job details</h1></main>',
        pageTitle: 'Example Labs Careers',
        resolvedUrl: 'https://careers.example.com/jobs/123',
      }
      const renderedSnapshot = {
        html: [
          '<main>',
          '<h1>Senior Product Designer</h1>',
          '<p>Lead browser-mediated intake for desktop workflows.</p>',
          '</main>',
        ].join(''),
        pageTitle: 'Senior Product Designer at Example Labs',
        resolvedUrl: 'https://careers.example.com/jobs/123',
      }

      expect(shouldCapturePage(loadingSnapshot)).toBe(false)
      expect(shouldCapturePage(renderedSnapshot)).toBe(true)

      return Promise.resolve(renderedSnapshot)
    },
  )
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage,
    generateId: vi.fn(() => 'vacancy-rendered-evidence'),
    getCurrentTimestamp: vi.fn(() => '2026-05-15T20:20:00.000Z'),
    localAppData,
    normalizationService: createReadyNormalizationService(normalizationCalls),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://careers.example.com/jobs/123',
  })

  expect(result.kind).toBe('ingested')
  expect(captureVacancyBrowserSessionPage).toHaveBeenCalledTimes(1)
  expect(normalizationCalls).toHaveLength(1)
})

test('accepts terminal rendered blockers so normalization can reject non-vacancy pages', async () => {
  const localAppData = createLocalAppDataDouble()
  const normalizationCalls: VacancyNormalizationInput[] = []
  const semanticRejection = new VacancyNormalizationError({
    code: 'semantic_rejection',
    message: 'Vacancy normalization produced semantically invalid vacancy content.',
  })
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage: vi.fn(() => {
      return Promise.resolve({
        html: '<main><h1>Accept cookies to continue</h1></main>',
        pageTitle: 'Cookie settings',
        resolvedUrl: 'https://careers.example.com/jobs/123',
      })
    }),
    localAppData,
    normalizationService: {
      normalizeVacancy: vi.fn((input: VacancyNormalizationInput) => {
        normalizationCalls.push(input)

        return Promise.reject(semanticRejection)
      }),
    },
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  await expect(
    vacancyService.ingestVacancyUrl({
      url: 'https://careers.example.com/jobs/123',
    }),
  ).rejects.toBe(semanticRejection)
  expect(normalizationCalls).toHaveLength(1)
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

test('applies generic URL matching to LinkedIn URLs without accepting provider-specific identifier redirects', async () => {
  const localAppData = createLocalAppDataDouble()
  const normalizationCalls: VacancyNormalizationInput[] = []
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage: vi.fn(() => {
      return Promise.resolve({
        html: '<main><h1>Senior Product Designer</h1><p>Lead browser-mediated intake.</p></main>',
        pageTitle: 'Senior Product Designer',
        resolvedUrl: 'https://www.linkedin.com/jobs/collections/recommended?currentJobId=123456',
      })
    }),
    localAppData,
    normalizationService: createReadyNormalizationService(normalizationCalls),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://www.linkedin.com/jobs/view/123456',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(normalizationCalls).toHaveLength(0)
})

test('applies generic URL matching to Indeed URLs without accepting provider-specific job-key redirects', async () => {
  const localAppData = createLocalAppDataDouble()
  const normalizationCalls: VacancyNormalizationInput[] = []
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage: vi.fn(() => {
      return Promise.resolve({
        html: '<main><h1>Staff Product Designer</h1><p>Own vacancy review workflows.</p></main>',
        pageTitle: 'Staff Product Designer',
        resolvedUrl: 'https://www.indeed.com/jobs?q=designer&jk=abc123',
      })
    }),
    localAppData,
    normalizationService: createReadyNormalizationService(normalizationCalls),
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://www.indeed.com/viewjob?jk=abc123',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(normalizationCalls).toHaveLength(0)
})
