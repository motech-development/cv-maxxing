import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { OriginalCvWritingStyle } from '../shared/original-cv.js'
import { OriginalCvNormalizationError } from './original-cv-normalization-error.js'
import type {
  NormalizedOriginalCv,
  OriginalCvNormalizationResult,
} from './original-cv-normalization-service.js'

export interface OriginalCvNormalizationWorker {
  runNormalization: (input: {
    runDirectoryPath: string
    signal: AbortSignal
  }) => Promise<OriginalCvNormalizationResult>
}

export interface OriginalCvNormalizationWorkerEnvironment {
  CV_MAXXING_AI_WORKER_CODEX_COMMAND?: string
  CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_DELAY_MS?: string
  CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_FAILURE?: string
  CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT?: string
}

const OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    normalizedCv: {
      additionalProperties: false,
      properties: {
        contact: {
          additionalProperties: false,
          properties: {
            email: {
              type: 'string',
            },
            location: {
              type: 'string',
            },
            phone: {
              type: 'string',
            },
            professionalLink: {
              type: 'string',
            },
          },
          required: ['email', 'location', 'phone', 'professionalLink'],
          type: 'object',
        },
        experience: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        fullName: {
          type: 'string',
        },
        headline: {
          type: 'string',
        },
        skills: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        summary: {
          type: 'string',
        },
      },
      required: ['contact', 'experience', 'fullName', 'headline', 'skills', 'summary'],
      type: 'object',
    },
    writingStyle: {
      additionalProperties: false,
      properties: {
        averageSentenceLength: {
          type: 'number',
        },
        clicheDetections: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        firstPersonUsage: {
          enum: ['absent', 'mixed', 'present'],
          type: 'string',
        },
        formality: {
          enum: ['conversational', 'direct', 'formal'],
          type: 'string',
        },
      },
      required: ['averageSentenceLength', 'clicheDetections', 'firstPersonUsage', 'formality'],
      type: 'object',
    },
  },
  required: ['normalizedCv', 'writingStyle'],
  type: 'object',
} as const
const ORIGINAL_CV_NORMALIZATION_MODEL = 'gpt-5.4'
const ORIGINAL_CV_NORMALIZATION_REASONING_EFFORT = 'low'

export function createOriginalCvNormalizationWorker({
  environment = process.env,
}: {
  environment?: OriginalCvNormalizationWorkerEnvironment
} = {}): OriginalCvNormalizationWorker {
  return {
    runNormalization: async ({ runDirectoryPath, signal }) => {
      const fixtureOutput = environment.CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT

      if (fixtureOutput !== undefined && fixtureOutput.trim() !== '') {
        const delayMs = parseDelay(
          environment.CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_DELAY_MS,
        )

        if (delayMs > 0) {
          await waitForDelay(delayMs, signal)
        }

        if (environment.CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_FAILURE) {
          throw new Error(environment.CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_FAILURE)
        }

        return parseNormalizationResultJson({
          context: 'CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT',
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
}): Promise<OriginalCvNormalizationResult> {
  const outputDirectoryPath = path.join(runDirectoryPath, 'output')
  const outputFilePath = path.join(outputDirectoryPath, 'result.json')
  const schemaFilePath = path.join(runDirectoryPath, 'output-schema.json')

  await mkdir(outputDirectoryPath, {
    recursive: true,
  })
  await writeFile(schemaFilePath, JSON.stringify(OUTPUT_SCHEMA), 'utf8')

  const prompt = [
    'Read input/task.json, input/examples.json, and the referenced original CV text.',
    'Return JSON only.',
    'Use British English.',
    'Extract CV contact fields into normalizedCv.contact.',
    'Copy contact values exactly as written in the original CV when present.',
    'Treat normalizedCv.contact.location as optional.',
    'If the CV clearly provides a geographic location, return it in "location, country" format.',
    'If the CV provides a location but omits the country, infer the country and include it.',
    'Do not assume location appears in any specific section or layout position.',
    'Do not include unrelated personal or contact details in normalizedCv.contact.location.',
    'Use empty strings for missing contact fields instead of guessing or normalizing.',
    'Preserve source meaning.',
    'Remain non-vacancy-aware.',
    'Handle heading variants such as Profile, Core Skills, and Career Highlights.',
    'Derive a faithful summary, headline, skills, and regrouped experience entries when needed.',
    'Keep names, headlines, skills, and experience grounded in the source text.',
    'Leave fields empty instead of guessing unsupported facts.',
  ].join(' ')

  const stderrChunks: string[] = []

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      command,
      [
        'exec',
        '-m',
        ORIGINAL_CV_NORMALIZATION_MODEL,
        '-c',
        `model_reasoning_effort="${ORIGINAL_CV_NORMALIZATION_REASONING_EFFORT}"`,
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
        stdio: ['ignore', 'pipe', 'pipe'],
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
      reject(new Error('Original CV normalization cancelled.'))
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
        reject(new Error('Original CV normalization cancelled.'))

        return
      }

      if (code !== 0) {
        reject(new Error(stderrChunks.join('').trim() || 'Codex CLI normalization failed.'))

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
}): OriginalCvNormalizationResult {
  let parsedOutput: unknown

  try {
    parsedOutput = JSON.parse(outputText) as unknown
  } catch (error) {
    const preview = buildOutputPreview(outputText)
    const reason = error instanceof Error ? error.message : 'Unknown parse error.'

    throw new OriginalCvNormalizationError({
      code: 'invalid_normalization',
      message: `${context} produced invalid JSON: ${reason}. Preview: ${preview}`,
    })
  }

  const normalizedOutput = normalizeOriginalCvNormalizationResult(parsedOutput)

  if (normalizedOutput === null) {
    throw new OriginalCvNormalizationError({
      code: 'invalid_normalization',
      message: `${context} produced invalid normalization output. Preview: ${buildOutputPreview(
        outputText,
      )}`,
    })
  }

  return normalizedOutput
}

function normalizeOriginalCvNormalizationResult(
  value: unknown,
): OriginalCvNormalizationResult | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (!isNormalizedOriginalCv(candidate.normalizedCv)) {
    return null
  }

  if (!isOriginalCvWritingStyle(candidate.writingStyle)) {
    return null
  }

  return {
    normalizedCv: normalizeOriginalCv(candidate.normalizedCv),
    writingStyle: candidate.writingStyle,
  }
}

function isNormalizedOriginalCv(value: unknown): value is NormalizedOriginalCv {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.fullName === 'string' &&
    typeof candidate.headline === 'string' &&
    typeof candidate.summary === 'string' &&
    isStringArray(candidate.experience) &&
    isStringArray(candidate.skills)
  )
}

function normalizeOriginalCv(value: unknown): NormalizedOriginalCv {
  const candidate = value as Record<string, unknown>

  return {
    contact: normalizeOriginalCvContact(candidate.contact),
    experience: candidate.experience as string[],
    fullName: candidate.fullName as string,
    headline: candidate.headline as string,
    skills: candidate.skills as string[],
    summary: candidate.summary as string,
  }
}

function normalizeOriginalCvContact(value: unknown): NormalizedOriginalCv['contact'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      email: '',
      location: '',
      phone: '',
      professionalLink: '',
    }
  }

  const candidate = value as Record<string, unknown>

  return {
    email: typeof candidate.email === 'string' ? candidate.email : '',
    location: typeof candidate.location === 'string' ? candidate.location : '',
    phone: typeof candidate.phone === 'string' ? candidate.phone : '',
    professionalLink:
      typeof candidate.professionalLink === 'string' ? candidate.professionalLink : '',
  }
}

function isOriginalCvWritingStyle(value: unknown): value is OriginalCvWritingStyle {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.averageSentenceLength === 'number' &&
    isStringArray(candidate.clicheDetections) &&
    (candidate.firstPersonUsage === 'absent' ||
      candidate.firstPersonUsage === 'mixed' ||
      candidate.firstPersonUsage === 'present') &&
    (candidate.formality === 'conversational' ||
      candidate.formality === 'direct' ||
      candidate.formality === 'formal')
  )
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
      reject(new Error('Original CV normalization cancelled.'))
    }

    signal.addEventListener('abort', abortHandler, {
      once: true,
    })
  })
}
