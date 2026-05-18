import { expect, test, vi } from 'vitest';
import type {
  JsonValue,
  LocalAppDataStore,
  MetadataRecord,
  MetadataSelector,
} from '../local-app-data-service.js';
import { VacancyNormalizationError } from '../vacancy-normalization-error.js';
import type {
  VacancyNormalizationInput,
  VacancyNormalizationService,
} from '../vacancy-normalization-service.js';
import { createVacancyService } from '../vacancy-service.js';

type TestLocalAppData = Pick<LocalAppDataStore, 'artifacts' | 'metadata'>;

function createLocalAppDataDouble(): TestLocalAppData {
  const metadataRecords = new Map<string, JsonValue>();
  const artifactWrite = vi.fn<LocalAppDataStore['artifacts']['write']>(() => Promise.resolve());
  const metadataGet: LocalAppDataStore['metadata']['get'] = <TValue extends JsonValue = JsonValue>(
    selector: MetadataSelector,
  ) => {
    const value = metadataRecords.get(createRecordKey(selector));

    return Promise.resolve(value === undefined ? null : (value as TValue));
  };
  const metadataDelete: LocalAppDataStore['metadata']['delete'] = (selector) => {
    metadataRecords.delete(createRecordKey(selector));

    return Promise.resolve();
  };
  const metadataList: LocalAppDataStore['metadata']['list'] = <
    TValue extends JsonValue = JsonValue,
  >(): Promise<MetadataRecord<TValue>[]> => {
    return Promise.resolve([]);
  };
  const metadataPut: LocalAppDataStore['metadata']['put'] = ({ id, scope, value }) => {
    metadataRecords.set(createRecordKey({ id, scope }), value);

    return Promise.resolve();
  };

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
  };
}

function createRecordKey({ id, scope }: { id: string; scope: string }) {
  return `${scope}:${id}`;
}

function rejectUnexpectedLocalAppDataAccess(): Promise<never> {
  return Promise.reject(new Error('Expected URL validation to fail before local app data access.'));
}

function rejectUnexpectedMetadataGet<
  TValue extends JsonValue = JsonValue,
>(): Promise<TValue | null> {
  return rejectUnexpectedLocalAppDataAccess();
}

function createRejectingLocalAppDataDouble(): TestLocalAppData {
  return {
    artifacts: {
      delete: rejectUnexpectedLocalAppDataAccess,
      list: rejectUnexpectedLocalAppDataAccess,
      read: rejectUnexpectedLocalAppDataAccess,
      write: rejectUnexpectedLocalAppDataAccess,
    },
    metadata: {
      delete: rejectUnexpectedLocalAppDataAccess,
      get: rejectUnexpectedMetadataGet,
      list: rejectUnexpectedLocalAppDataAccess,
      put: rejectUnexpectedLocalAppDataAccess,
    },
  };
}

test('keeps pasted vacancy intake editable when AI finds no job content', async () => {
  const localAppData = createLocalAppDataDouble();
  const normalizationService = {
    normalizeVacancy: vi.fn(() => {
      return Promise.reject(
        new VacancyNormalizationError({
          code: 'no_job_content',
          message: 'Vacancy normalization found no job content to persist.',
        }),
      );
    }),
  } satisfies VacancyNormalizationService;
  const vacancyService = createVacancyService({
    generateId: vi.fn(() => 'vacancy-no-job-content-pasted'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:39:00.000Z'),
    localAppData,
    normalizationService,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  });
  const text = 'We are hiring soon. Details to follow.';

  const result = await vacancyService.ingestPastedVacancy({
    text,
    url: 'https://jobs.example.com/coming-soon',
  });

  expect(result.kind).toBe('incomplete');
  expect(result.vacancy.canGenerate).toBe(false);
  expect(result.vacancy.blockingReason).toBe(
    'Add the full job responsibilities or requirements before tailoring your CV.',
  );
  expect(result.workspaceState).toEqual({
    draft: {
      text,
      url: 'https://jobs.example.com/coming-soon',
    },
    reviewState: 'editable',
    vacancy: null,
  });
  expect(normalizationService.normalizeVacancy).toHaveBeenCalledTimes(1);
  expect(localAppData.artifacts.write).not.toHaveBeenCalled();
  await expect(vacancyService.getWorkspaceState()).resolves.toEqual(result.workspaceState);
  await expect(
    localAppData.metadata.get({
      id: 'vacancy-no-job-content-pasted',
      scope: 'vacancies',
    }),
  ).resolves.toBeNull();
});

test('rejects non-web vacancy URLs before touching persistence or browser adapters', async () => {
  const captureVacancyBrowserSessionPage = vi.fn(() => Promise.resolve(null));
  const openVacancyBrowserSession = vi.fn(() => Promise.resolve(null));
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage,
    localAppData: createRejectingLocalAppDataDouble(),
    normalizationService: {
      normalizeVacancy: vi.fn(() => {
        return Promise.reject(new Error('Expected URL validation before AI normalization.'));
      }),
    },
    openVacancyBrowserSession,
  });

  await expect(
    vacancyService.ingestVacancyUrl({
      url: 'file:///tmp/job.html',
    }),
  ).rejects.toThrow('A vacancy URL is required.');
  expect(captureVacancyBrowserSessionPage).not.toHaveBeenCalled();
  expect(openVacancyBrowserSession).not.toHaveBeenCalled();
});

test('treats lookalike provider hostnames as normal browser-mediated vacancy URLs', async () => {
  const localAppData = createLocalAppDataDouble();
  const normalizationCalls: VacancyNormalizationInput[] = [];
  const captureVacancyBrowserSessionPage = vi.fn(() =>
    Promise.resolve({
      html: '<main><h1>Senior Product Designer</h1><p>Lead design systems and product workflows.</p></main>',
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://jobs.example.com/jobs/view/123456',
    }),
  );
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage,
    generateId: vi.fn(() => 'vacancy-lookalike-host'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:45:00.000Z'),
    localAppData,
    normalizationService: {
      normalizeVacancy: vi.fn((input: VacancyNormalizationInput) => {
        normalizationCalls.push(input);

        return Promise.resolve({
          bodyText:
            'Lead design systems and product workflows for desktop product surfaces with engineering partners.',
          employer: 'Example Labs',
          location: 'London, United Kingdom',
          requirements: ['Experience shipping product design systems.'],
          responsibilities: ['Lead design systems and product workflows.'],
          title: 'Senior Product Designer',
        });
      }),
    },
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  });

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://jobs.example.com/jobs/view/123456',
  });

  expect(result.kind).toBe('ingested');
  expect(result.vacancy.source).toBe('jobs.example.com');
  expect(captureVacancyBrowserSessionPage).toHaveBeenCalledTimes(1);
  expect(normalizationCalls[0]?.source).toBe('jobs.example.com');
});

test('does not accept off-target browser captures as job pages', async () => {
  const localAppData = createLocalAppDataDouble();
  const normalizationService = {
    normalizeVacancy: vi.fn(() => {
      return Promise.resolve({
        bodyText:
          'Lead design systems and product workflows for desktop product surfaces with engineering partners.',
        employer: 'Example Labs',
        location: 'London, United Kingdom',
        requirements: ['Experience shipping product design systems.'],
        responsibilities: ['Lead design systems and product workflows.'],
        title: 'Senior Product Designer',
      });
    }),
  } satisfies VacancyNormalizationService;
  const vacancyService = createVacancyService({
    captureVacancyBrowserSessionPage: vi.fn(() => {
      return Promise.resolve({
        html: '<main><h1>Account feed</h1></main>',
        pageTitle: 'Account feed',
        resolvedUrl: 'https://jobs.example.com/feed/',
      });
    }),
    generateId: vi.fn(() => 'vacancy-authenticated-feed'),
    getCurrentTimestamp: vi.fn(() => '2026-04-08T21:50:00.000Z'),
    localAppData,
    normalizationService,
    openVacancyBrowserSession: vi.fn(() => Promise.resolve(null)),
  });

  const result = await vacancyService.ingestVacancyUrl({
    url: 'https://jobs.example.com/feed/',
  });

  expect(result.kind).toBe('incomplete');
  expect(result.vacancy.source).toBe('jobs.example.com');
  expect(result.vacancy.blockingReason).toBe(
    'This job page may need more access. Open the job page or paste the job description instead.',
  );
  expect(normalizationService.normalizeVacancy).not.toHaveBeenCalled();
});
