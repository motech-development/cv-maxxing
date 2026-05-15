import { expect, test, vi } from 'vitest'

import { VacancyNormalizationError } from '../vacancy-normalization-error.js'
import { createVacancyService } from '../vacancy-service.js'
import type {
  JsonValue,
  LocalAppDataStore,
  MetadataRecord,
  MetadataSelector,
} from '../local-app-data-service.js'
import type { VacancyNormalizationService } from '../vacancy-normalization-service.js'

type TestLocalAppData = Pick<LocalAppDataStore, 'artifacts' | 'metadata'>

function createLocalAppDataDouble(): TestLocalAppData {
  const metadataRecords = new Map<string, JsonValue>()
  const artifactWrite = vi.fn<LocalAppDataStore['artifacts']['write']>(() => Promise.resolve())
  const metadataGet: LocalAppDataStore['metadata']['get'] = <TValue extends JsonValue = JsonValue>(
    selector: MetadataSelector,
  ) => {
    const value = metadataRecords.get(createRecordKey(selector))

    return Promise.resolve(value === undefined ? null : (value as TValue))
  }
  const metadataDelete: LocalAppDataStore['metadata']['delete'] = (selector) => {
    metadataRecords.delete(createRecordKey(selector))

    return Promise.resolve()
  }
  const metadataList: LocalAppDataStore['metadata']['list'] = <
    TValue extends JsonValue = JsonValue,
  >(): Promise<MetadataRecord<TValue>[]> => {
    return Promise.resolve([])
  }
  const metadataPut: LocalAppDataStore['metadata']['put'] = ({ id, scope, value }) => {
    metadataRecords.set(createRecordKey({ id, scope }), value)

    return Promise.resolve()
  }

  return {
    artifacts: {
      delete: () => Promise.resolve(),
      list: () => Promise.resolve([]),
      read: () => Promise.resolve(null),
      write: artifactWrite,
    },
    metadata: {
      delete: metadataDelete,
      get: metadataGet,
      list: metadataList,
      put: metadataPut,
    },
  }
}

function createRecordKey({ id, scope }: { id: string; scope: string }): string {
  return `${scope}:${id}`
}

test('keeps pasted vacancy intake editable when AI finds no job content', async () => {
  const localAppData = createLocalAppDataDouble()
  const normalizationService = {
    normalizeVacancy: vi.fn(() => {
      return Promise.reject(
        new VacancyNormalizationError({
          code: 'no_job_content',
          message: 'Vacancy normalization found no job content to persist.',
        }),
      )
    }),
  } satisfies VacancyNormalizationService
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-no-job-content-pasted'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:39:00.000Z'),
    localAppData,
    normalizationService,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  })
  const text = 'We are hiring soon. Details to follow.'

  const result = await vacancyService.ingestPastedVacancy({
    text,
    url: 'https://jobs.example.com/coming-soon',
  })

  expect(result.kind).toBe('incomplete')
  expect(result.vacancy.canGenerate).toBe(false)
  expect(result.vacancy.blockingReason).toBe(
    'Add the full job responsibilities or requirements before tailoring your CV.',
  )
  expect(result.workspaceState).toEqual({
    draft: {
      text,
      url: 'https://jobs.example.com/coming-soon',
    },
    reviewState: 'editable',
    vacancy: null,
  })
  expect(normalizationService.normalizeVacancy).toHaveBeenCalledTimes(1)
  expect(localAppData.artifacts.write).not.toHaveBeenCalled()
  await expect(vacancyService.getWorkspaceState()).resolves.toEqual(result.workspaceState)
  await expect(
    localAppData.metadata.get({
      id: 'vacancy-no-job-content-pasted',
      scope: 'vacancies',
    }),
  ).resolves.toBeNull()
})
