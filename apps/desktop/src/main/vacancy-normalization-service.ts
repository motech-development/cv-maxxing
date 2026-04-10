import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { VacancySource } from '../shared/vacancy.js'
import { VacancyNormalizationError } from './vacancy-normalization-error.js'
import { VACANCY_NORMALIZATION_EXAMPLES } from './vacancy-normalization-examples.js'
import { extractTextFromHtml, sanitizeSnapshotHtml } from './vacancy-page-content.js'
import type { VacancyNormalizationWorker } from './vacancy-normalization-worker.js'

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
  originalUrl: string
  pageTitle: string | null
  resolvedUrl: string
  source: VacancySource
}

export interface VacancyNormalizationService {
  normalizeVacancy: (input: VacancyNormalizationInput) => Promise<NormalizedVacancy>
}

const DEFAULT_VACANCY_NORMALIZATION_TIMEOUT_MS = 45_000
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

  return {
    normalizeVacancy: async (input): Promise<NormalizedVacancy> => {
      const runDirectoryPath = path.join(runWorkspaceRootPath, generateId())
      const abortController = new AbortController()

      await writeRunWorkspaceInput({
        input,
        runDirectoryPath,
      })

      const timeoutId = setTimeout(() => {
        abortController.abort(VACANCY_NORMALIZATION_TIMEOUT_REASON)
      }, resolvedTimeoutMs)

      try {
        return await worker.runNormalization({
          runDirectoryPath,
          signal: abortController.signal,
        })
      } catch (error) {
        if (abortController.signal.reason === VACANCY_NORMALIZATION_TIMEOUT_REASON) {
          throw new VacancyNormalizationError({
            code: 'timeout',
            message: 'Vacancy normalization timed out.',
          })
        }

        throw error
      } finally {
        clearTimeout(timeoutId)
        await rm(runDirectoryPath, {
          force: true,
          recursive: true,
        })
      }
    },
  }
}

async function writeRunWorkspaceInput({
  input,
  runDirectoryPath,
}: {
  input: VacancyNormalizationInput
  runDirectoryPath: string
}): Promise<void> {
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
    writeFile(path.join(inputDirectoryPath, 'page.html'), sanitizeSnapshotHtml(input.html), 'utf8'),
    writeFile(path.join(inputDirectoryPath, 'page.txt'), extractTextFromHtml(input.html), 'utf8'),
    writeFile(path.join(inputDirectoryPath, 'task.json'), taskJson, 'utf8'),
  ])
}

function resolveTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_VACANCY_NORMALIZATION_TIMEOUT_MS
  }

  return Math.trunc(timeoutMs)
}
