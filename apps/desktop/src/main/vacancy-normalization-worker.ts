import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { VacancyNormalizationError } from './vacancy-normalization-error.js'
import type { NormalizedVacancy } from './vacancy-normalization-service.js'

export interface VacancyNormalizationWorker {
  runNormalization: (input: {
    runDirectoryPath: string
    signal: AbortSignal
  }) => Promise<NormalizedVacancy>
}

export interface VacancyNormalizationWorkerEnvironment {
  CV_MAXXING_AI_WORKER_CODEX_COMMAND?: string
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_DELAY_MS?: string
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_FAILURE?: string
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT?: string
}

const OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    bodyText: {
      type: 'string',
    },
    employer: {
      type: ['string', 'null'],
    },
    location: {
      type: ['string', 'null'],
    },
    requirements: {
      items: {
        type: 'string',
      },
      type: 'array',
    },
    responsibilities: {
      items: {
        type: 'string',
      },
      type: 'array',
    },
    title: {
      type: ['string', 'null'],
    },
  },
  required: ['bodyText', 'employer', 'location', 'requirements', 'responsibilities', 'title'],
  type: 'object',
} as const

export function createVacancyNormalizationWorker({
  environment = process.env,
}: {
  environment?: VacancyNormalizationWorkerEnvironment
} = {}): VacancyNormalizationWorker {
  return {
    runNormalization: async ({ runDirectoryPath, signal }) => {
      const fixtureOutput = environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT

      if (fixtureOutput !== undefined && fixtureOutput.trim() !== '') {
        const delayMs = parseDelay(environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_DELAY_MS)

        if (delayMs > 0) {
          await waitForDelay(delayMs, signal)
        }

        if (environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_FAILURE) {
          throw new Error(environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_FAILURE)
        }

        return parseNormalizationResultJson({
          context: 'CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT',
          outputText: fixtureOutput,
        })
      }

      return await runCodexCliNormalization({
        command: environment.CV_MAXXING_AI_WORKER_CODEX_COMMAND ?? 'codex',
        runDirectoryPath,
        signal,
      })
    },
  }
}

async function runCodexCliNormalization({
  command,
  runDirectoryPath,
  signal,
}: {
  command: string
  runDirectoryPath: string
  signal: AbortSignal
}): Promise<NormalizedVacancy> {
  const outputDirectoryPath = path.join(runDirectoryPath, 'output')
  const outputFilePath = path.join(outputDirectoryPath, 'result.json')
  const schemaFilePath = path.join(runDirectoryPath, 'output-schema.json')

  await mkdir(outputDirectoryPath, {
    recursive: true,
  })
  await writeFile(schemaFilePath, JSON.stringify(OUTPUT_SCHEMA), 'utf8')

  const prompt = [
    'Read input/task.json, input/examples.json, and the referenced vacancy page artifacts.',
    'Return JSON only.',
    'Use British English.',
    'Preserve source meaning and page order.',
    'Ignore navigation chrome, cookie banners, account UI, and related-job content.',
    'Prefer the main vacancy body over summary snippets.',
    'Leave missing fields empty instead of guessing.',
  ].join(' ')

  const stderrChunks: string[] = []

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      command,
      [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '--output-schema',
        schemaFilePath,
        '--output-last-message',
        outputFilePath,
        prompt,
      ],
      {
        cwd: runDirectoryPath,
      },
    )

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString())
    })
    child.stdout.on('data', () => {
      return
    })

    const abortHandler = () => {
      child.kill('SIGTERM')
      reject(new Error('Vacancy normalization cancelled.'))
    }

    signal.addEventListener('abort', abortHandler, {
      once: true,
    })

    child.on('error', (error) => {
      signal.removeEventListener('abort', abortHandler)
      reject(error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abortHandler)

      if (signal.aborted) {
        reject(new Error('Vacancy normalization cancelled.'))

        return
      }

      if (code !== 0) {
        reject(new Error(stderrChunks.join('').trim() || 'Codex CLI vacancy normalization failed.'))

        return
      }

      resolve()
    })
  })

  const outputText = await readFile(outputFilePath, 'utf8')

  return parseNormalizationResultJson({
    context: `Codex CLI output at ${outputFilePath}`,
    outputText,
  })
}

function parseNormalizationResultJson({
  context,
  outputText,
}: {
  context: string
  outputText: string
}): NormalizedVacancy {
  let parsedOutput: unknown

  try {
    parsedOutput = JSON.parse(outputText) as unknown
  } catch (error) {
    const preview = buildOutputPreview(outputText)
    const reason = error instanceof Error ? error.message : 'Unknown parse error.'

    throw new VacancyNormalizationError({
      code: 'invalid_normalization',
      message: `${context} produced invalid JSON: ${reason}. Preview: ${preview}`,
    })
  }

  if (!isNormalizedVacancy(parsedOutput)) {
    throw new VacancyNormalizationError({
      code: 'invalid_normalization',
      message: `${context} produced invalid normalization output. Preview: ${buildOutputPreview(
        outputText,
      )}`,
    })
  }

  return parsedOutput
}

function isNormalizedVacancy(value: unknown): value is NormalizedVacancy {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.bodyText === 'string' &&
    isNullableString(candidate.employer) &&
    isNullableString(candidate.location) &&
    isStringArray(candidate.requirements) &&
    isStringArray(candidate.responsibilities) &&
    isNullableString(candidate.title)
  )
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      return typeof entry === 'string'
    })
  )
}

function parseDelay(value: string | undefined): number {
  const parsedValue = Number.parseInt(value ?? '', 10)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0
  }

  return parsedValue
}

function buildOutputPreview(outputText: string): string {
  const preview = outputText.length > 200 ? `${outputText.slice(0, 200)}...` : outputText

  return JSON.stringify(preview)
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', abortHandler)
      resolve()
    }, delayMs)

    const abortHandler = () => {
      clearTimeout(timeoutId)
      reject(new Error('Vacancy normalization cancelled.'))
    }

    signal.addEventListener('abort', abortHandler, {
      once: true,
    })
  })
}
