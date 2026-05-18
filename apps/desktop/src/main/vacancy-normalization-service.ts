import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { VacancyInputType, VacancySource } from '../shared/vacancy.js';
import type { VacancyBrowserReadingActionRequest } from './vacancy-browser-actions.js';
import { VacancyNormalizationError } from './vacancy-normalization-error.js';
import { VACANCY_NORMALIZATION_EXAMPLES } from './vacancy-normalization-examples.js';
import type { VacancyNormalizationWorker } from './vacancy-normalization-worker.js';
import { prepareVacancyNormalizationArtifacts } from './vacancy-page-content.js';

export interface NormalizedVacancy {
  bodyText: string;
  employer: string | null;
  location: string | null;
  requirements: string[];
  responsibilities: string[];
  title: string | null;
}

export interface VacancyNormalizationInput {
  html: string;
  inputType: VacancyInputType;
  originalUrl: string | null;
  pageTitle: string | null;
  resolvedUrl: string | null;
  source: VacancySource;
}

export type VacancyNormalizationWorkerResult =
  | {
      kind: 'no_job_content';
    }
  | {
      kind: 'page_interaction_requested';
      readingActions: VacancyBrowserReadingActionRequest[];
    }
  | {
      kind: 'success';
      normalizedVacancy: NormalizedVacancy;
    };

export interface VacancyNormalizationService {
  normalizeVacancy: (input: VacancyNormalizationInput) => Promise<NormalizedVacancy>;
}

interface VacancyNormalizationServiceInput {
  generateId?: () => string;
  runWorkspaceRootPath: string;
  timeoutMs?: number;
  worker?: VacancyNormalizationWorker;
}

const DEFAULT_VACANCY_NORMALIZATION_TIMEOUT_MS = 120_000;
const VACANCY_NORMALIZATION_TIMEOUT_REASON = Symbol('vacancy-normalization-timeout');

const missingVacancyNormalizationWorker: VacancyNormalizationWorker = {
  runNormalization: () => {
    return Promise.reject(new Error('No vacancy-normalization worker is configured.'));
  },
};

export function createVacancyNormalizationService({
  generateId = randomUUID,
  runWorkspaceRootPath,
  timeoutMs = DEFAULT_VACANCY_NORMALIZATION_TIMEOUT_MS,
  worker = missingVacancyNormalizationWorker,
}: VacancyNormalizationServiceInput): VacancyNormalizationService {
  const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs);

  return {
    normalizeVacancy: async (input): Promise<NormalizedVacancy> => {
      const runDirectoryPath = path.join(runWorkspaceRootPath, generateId());
      const abortController = new AbortController();

      await writeRunWorkspaceInput({
        input,
        runDirectoryPath,
      });

      const timeoutId = setTimeout(() => {
        abortController.abort(VACANCY_NORMALIZATION_TIMEOUT_REASON);
      }, resolvedTimeoutMs);

      try {
        const workerResult = await worker.runNormalization({
          runDirectoryPath,
          signal: abortController.signal,
        });

        if (workerResult.kind === 'no_job_content') {
          throw new VacancyNormalizationError({
            code: 'no_job_content',
            message: 'Vacancy normalization found no job content to persist.',
          });
        }

        if (workerResult.kind === 'page_interaction_requested') {
          throw new VacancyNormalizationError({
            code: 'page_interaction_requested',
            message: 'Vacancy normalization requested more same-page evidence.',
            readingActions: workerResult.readingActions,
          });
        }

        return sanitizeNormalizedVacancy(workerResult.normalizedVacancy);
      } catch (error) {
        if (abortController.signal.reason === VACANCY_NORMALIZATION_TIMEOUT_REASON) {
          throw new VacancyNormalizationError({
            code: 'timeout',
            message: 'Vacancy normalization timed out.',
          });
        }

        if (error instanceof VacancyNormalizationError) {
          throw error;
        }

        if (isCancellationError(error)) {
          throw new VacancyNormalizationError({
            code: 'cancelled',
            message: 'Vacancy normalization was cancelled.',
          });
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
        await rm(runDirectoryPath, {
          force: true,
          recursive: true,
        });
      }
    },
  };
}

async function writeRunWorkspaceInput({
  input,
  runDirectoryPath,
}: {
  input: VacancyNormalizationInput;
  runDirectoryPath: string;
}): Promise<void> {
  const normalizationArtifacts = prepareVacancyNormalizationArtifacts({
    html: input.html,
  });
  const inputDirectoryPath = path.join(runDirectoryPath, 'input');
  const taskJson = JSON.stringify({
    constraints: {
      ignoreChromeAndBoilerplate: true,
      keepMissingFieldsEmpty: true,
      outputLanguage: 'British English',
      preservePageOrder: true,
      preserveSourceMeaning: true,
    },
    examplesPath: 'input/examples.json',
    outputContract: {
      normalizedArtifactName: 'normalized.json',
    },
    vacancyPage: {
      extractedTextPath: 'input/page.txt',
      inputType: input.inputType,
      originalUrl: input.originalUrl,
      pageTitle: input.pageTitle,
      resolvedUrl: input.resolvedUrl,
      sanitizedHtmlPath: 'input/page.html',
      source: input.source,
    },
  });

  await mkdir(inputDirectoryPath, {
    recursive: true,
  });
  await Promise.all([
    writeFile(
      path.join(inputDirectoryPath, 'examples.json'),
      JSON.stringify(VACANCY_NORMALIZATION_EXAMPLES),
      'utf8',
    ),
    writeFile(
      path.join(inputDirectoryPath, 'page.html'),
      normalizationArtifacts.sanitizedHtml,
      'utf8',
    ),
    writeFile(
      path.join(inputDirectoryPath, 'page.txt'),
      normalizationArtifacts.extractedText,
      'utf8',
    ),
    writeFile(path.join(inputDirectoryPath, 'task.json'), taskJson, 'utf8'),
  ]);
}

function resolveTimeoutMs(timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_VACANCY_NORMALIZATION_TIMEOUT_MS;
  }

  return Math.trunc(timeoutMs);
}

function sanitizeNormalizedVacancy(normalizedVacancy: NormalizedVacancy): NormalizedVacancy {
  const bodyText = normalizeBodyText(normalizedVacancy.bodyText);
  const employer = normalizeNullableText(normalizedVacancy.employer);
  const location = normalizeNullableText(normalizedVacancy.location);
  const requirements = normalizeList(normalizedVacancy.requirements);
  const responsibilities = normalizeList(normalizedVacancy.responsibilities);
  const title = normalizeNullableText(normalizedVacancy.title);
  const semanticText = [title, employer, location, bodyText, ...requirements, ...responsibilities]
    .filter((value): value is string => {
      return value !== null;
    })
    .join(' ');

  if (looksLikeSemanticJunk(semanticText)) {
    throw new VacancyNormalizationError({
      code: 'semantic_rejection',
      message: 'Vacancy normalization produced semantically invalid vacancy content.',
    });
  }

  return {
    bodyText,
    employer,
    location,
    requirements,
    responsibilities,
    title,
  };
}

function normalizeBodyText(value: string) {
  return value.replaceAll(/\s+/g, ' ').trim();
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalizedValue = value.replaceAll(/\s+/g, ' ').trim();

  return normalizedValue === '' ? null : normalizedValue;
}

function normalizeList(values: string[]): string[] {
  const normalizedValues = values
    .map((value) => {
      return value.replaceAll(/\s+/g, ' ').trim();
    })
    .filter((value) => {
      return value !== '';
    });

  return [...new Set(normalizedValues)];
}

function looksLikeSemanticJunk(value: string) {
  const normalizedValue = value.toLowerCase();

  if (
    normalizedValue.includes('cookie') &&
    (normalizedValue.includes('accept') || normalizedValue.includes('consent'))
  ) {
    return true;
  }

  if (normalizedValue.includes('sign in') || normalizedValue.includes('log in')) {
    return true;
  }

  if (
    normalizedValue.includes('feed') &&
    (normalizedValue.includes('welcome back') || normalizedValue.includes('people you follow'))
  ) {
    return true;
  }

  return false;
}

function isCancellationError(error: unknown) {
  return error instanceof Error && error.message === 'Vacancy normalization cancelled.';
}
