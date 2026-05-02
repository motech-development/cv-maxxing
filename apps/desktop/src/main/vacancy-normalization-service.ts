import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { VacancyNormalizationError } from './vacancy-normalization-error.js'
import { VACANCY_NORMALIZATION_EXAMPLES } from './vacancy-normalization-examples.js'
import { prepareVacancyNormalizationArtifacts } from './vacancy-page-content.js'
import type { VacancyNormalizationWorker } from './vacancy-normalization-worker.js'
import type { VacancyBrowserPageReadingInteraction } from './vacancy-browser-session-service.js'

export interface NormalizedVacancy {
  bodyText: string
  employer: string | null
  location: string | null
  requirements: string[]
  responsibilities: string[]
  title: string | null
}

export interface VacancyNormalizationInput {
  html: string
  interactionHistory?: VacancyPageInteractionHistoryEntry[]
  originalUrl: string
  pageTitle: string | null
  resolvedUrl: string
  source: string
}

export interface VacancyNormalizationOptions {
  timeoutMs?: number
}

export interface VacancyPageInteractionHistoryEntry {
  interaction: VacancyBrowserPageReadingInteraction
  result: 'captured' | 'rejected'
}

export type VacancyNormalizationWorkerResult =
  | {
      kind: 'authentication_required'
    }
  | {
      interaction: VacancyBrowserPageReadingInteraction
      kind: 'interaction_requested'
    }
  | {
      kind: 'no_job_content'
    }
  | {
      kind: 'success'
      normalizedVacancy: NormalizedVacancy
    }

export type VacancyPageReviewResult =
  | {
      kind: 'authentication_required'
    }
  | {
      interaction: VacancyBrowserPageReadingInteraction
      kind: 'interaction_requested'
    }
  | {
      kind: 'no_job_content'
    }
  | {
      kind: 'success'
      normalizedVacancy: NormalizedVacancy
    }

export interface VacancyNormalizationService {
  normalizeVacancy: (
    input: VacancyNormalizationInput,
    options?: VacancyNormalizationOptions,
  ) => Promise<NormalizedVacancy>
  reviewVacancyPage?: (
    input: VacancyNormalizationInput,
    options?: VacancyNormalizationOptions,
  ) => Promise<VacancyPageReviewResult>
}

const DEFAULT_VACANCY_NORMALIZATION_TIMEOUT_MS = 120_000
const VACANCY_NORMALIZATION_TIMEOUT_REASON = Symbol('vacancy-normalization-timeout')

const missingVacancyNormalizationWorker: VacancyNormalizationWorker = {
  runNormalization: () => {
    return Promise.reject(new Error('No vacancy-normalization worker is configured.'))
  },
}

export function createVacancyNormalizationService({
  generateId = randomUUID,
  runWorkspaceRootPath,
  timeoutMs = DEFAULT_VACANCY_NORMALIZATION_TIMEOUT_MS,
  worker = missingVacancyNormalizationWorker,
}: {
  generateId?: () => string
  runWorkspaceRootPath: string
  timeoutMs?: number
  worker?: VacancyNormalizationWorker
}): VacancyNormalizationService {
  const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs)

  const reviewVacancyPage = async (
    input: VacancyNormalizationInput,
    options: VacancyNormalizationOptions = {},
  ): Promise<VacancyPageReviewResult> => {
    const runDirectoryPath = path.join(runWorkspaceRootPath, generateId())
    const abortController = new AbortController()

    await writeRunWorkspaceInput({
      input,
      runDirectoryPath,
    })

    const timeoutId = setTimeout(
      () => {
        abortController.abort(VACANCY_NORMALIZATION_TIMEOUT_REASON)
      },
      resolveTimeoutMs(options.timeoutMs ?? resolvedTimeoutMs),
    )

    try {
      const workerResult = await worker.runNormalization({
        runDirectoryPath,
        signal: abortController.signal,
      })

      if (workerResult.kind === 'success') {
        return {
          kind: 'success',
          normalizedVacancy: sanitizeNormalizedVacancy(workerResult.normalizedVacancy),
        }
      }

      return workerResult
    } catch (error) {
      throw normalizeVacancyReviewError({
        abortController,
        error,
      })
    } finally {
      clearTimeout(timeoutId)
      await rm(runDirectoryPath, {
        force: true,
        recursive: true,
      })
    }
  }

  return {
    normalizeVacancy: async (input, options): Promise<NormalizedVacancy> => {
      const workerResult = await reviewVacancyPage(input, options)

      if (workerResult.kind === 'no_job_content') {
        throw new VacancyNormalizationError({
          code: 'no_job_content',
          message: 'Vacancy normalization found no job content to persist.',
        })
      }

      if (workerResult.kind === 'authentication_required') {
        throw new VacancyNormalizationError({
          code: 'authentication_required',
          message: 'Vacancy page requires sign-in before job content can be read.',
        })
      }

      if (workerResult.kind === 'interaction_requested') {
        throw new VacancyNormalizationError({
          code: 'invalid_normalization',
          message: 'Vacancy normalization requested an interaction where none is available.',
        })
      }

      return workerResult.normalizedVacancy
    },
    reviewVacancyPage,
  }
}

async function writeRunWorkspaceInput({
  input,
  runDirectoryPath,
}: {
  input: VacancyNormalizationInput
  runDirectoryPath: string
}): Promise<void> {
  const normalizationArtifacts = prepareVacancyNormalizationArtifacts({
    html: input.html,
  })
  const inputDirectoryPath = path.join(runDirectoryPath, 'input')
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
    readingInteractions: {
      allowedActions: ['click', 'scroll', 'wait'],
      disallowedActions: [
        'type into fields',
        'submit forms',
        'upload files',
        'click Apply or Submit equivalents',
        'perform account actions',
        'open external links',
        'change the top-level host, path, or query',
      ],
      history: input.interactionHistory ?? [],
      hashOnlyUrlChangesAllowed: true,
      requestContract:
        'If more visible same-page evidence is needed, return kind "interaction_requested" with one safe reading interaction.',
    },
    vacancyPage: {
      extractedTextPath: 'input/page.txt',
      originalUrl: input.originalUrl,
      pageTitle: input.pageTitle,
      resolvedUrl: input.resolvedUrl,
      sanitizedHtmlPath: 'input/page.html',
      source: input.source,
    },
  })

  await mkdir(inputDirectoryPath, {
    recursive: true,
  })
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
  ])
}

function normalizeVacancyReviewError({
  abortController,
  error,
}: {
  abortController: AbortController
  error: unknown
}): Error {
  if (abortController.signal.reason === VACANCY_NORMALIZATION_TIMEOUT_REASON) {
    return new VacancyNormalizationError({
      code: 'timeout',
      message: 'Vacancy normalization timed out.',
    })
  }

  if (error instanceof VacancyNormalizationError) {
    return error
  }

  if (isCancellationError(error)) {
    return new VacancyNormalizationError({
      code: 'cancelled',
      message: 'Vacancy normalization was cancelled.',
    })
  }

  return error instanceof Error ? error : new Error('Vacancy normalization failed.')
}

function resolveTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_VACANCY_NORMALIZATION_TIMEOUT_MS
  }

  return Math.trunc(timeoutMs)
}

function sanitizeNormalizedVacancy(normalizedVacancy: NormalizedVacancy): NormalizedVacancy {
  const bodyText = normalizeBodyText(normalizedVacancy.bodyText)
  const employer = normalizeNullableText(normalizedVacancy.employer)
  const location = normalizeNullableText(normalizedVacancy.location)
  const requirements = normalizeList(normalizedVacancy.requirements)
  const responsibilities = normalizeList(normalizedVacancy.responsibilities)
  const title = normalizeNullableText(normalizedVacancy.title)
  const semanticText = [title, employer, location, bodyText, ...requirements, ...responsibilities]
    .filter((value): value is string => {
      return value !== null
    })
    .join(' ')

  if (looksLikeSemanticJunk(semanticText)) {
    throw new VacancyNormalizationError({
      code: 'semantic_rejection',
      message: 'Vacancy normalization produced semantically invalid vacancy content.',
    })
  }

  return {
    bodyText,
    employer,
    location,
    requirements,
    responsibilities,
    title,
  }
}

function normalizeBodyText(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim()
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const normalizedValue = value.replaceAll(/\s+/g, ' ').trim()

  return normalizedValue === '' ? null : normalizedValue
}

function normalizeList(values: string[]): string[] {
  const normalizedValues = values
    .map((value) => {
      return value.replaceAll(/\s+/g, ' ').trim()
    })
    .filter((value) => {
      return value !== ''
    })

  return [...new Set(normalizedValues)]
}

function looksLikeSemanticJunk(value: string): boolean {
  const normalizedValue = value.toLowerCase()

  if (
    normalizedValue.includes('cookie') &&
    (normalizedValue.includes('accept') || normalizedValue.includes('consent'))
  ) {
    return true
  }

  if (normalizedValue.includes('sign in') || normalizedValue.includes('log in')) {
    return true
  }

  if (
    normalizedValue.includes('feed') &&
    (normalizedValue.includes('welcome back') || normalizedValue.includes('people you follow'))
  ) {
    return true
  }

  return false
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Vacancy normalization cancelled.'
}
