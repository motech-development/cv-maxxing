import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

import type { TailoredApplicationGenerationResult } from '../shared/tailored-application.js'
import type { TailoredApplicationGenerationWorker } from './tailored-application-session-service.js'

export interface TailoredApplicationGenerationEnvironment {
  CV_MAXXING_AI_WORKER_CODEX_COMMAND?: string
  CV_MAXXING_AI_WORKER_GENERATION_DELAY_MS?: string
  CV_MAXXING_AI_WORKER_GENERATION_FAILURE?: string
  CV_MAXXING_AI_WORKER_GENERATION_OUTPUT?: string
  CV_MAXXING_AI_WORKER_GENERATION_TIMEOUT_MS?: string
}

const OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    adaptationSummary: {
      additionalProperties: false,
      properties: {
        emphasized: {
          items: groundedTextSchema(),
          type: 'array',
        },
        gaps: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        omitted: {
          items: groundedTextSchema(),
          type: 'array',
        },
        validationHints: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
      },
      required: ['emphasized', 'gaps', 'omitted', 'validationHints'],
      type: 'object',
    },
    adaptedCv: {
      additionalProperties: false,
      properties: {
        candidateName: {
          type: 'string',
        },
        header: {
          additionalProperties: false,
          properties: {
            intro: groundedTextSchema(),
          },
          required: ['intro'],
          type: 'object',
        },
        headline: groundedTextSchema(),
        sections: {
          items: adaptedCvSectionSchema(),
          type: 'array',
        },
      },
      required: ['candidateName', 'header', 'headline', 'sections'],
      type: 'object',
    },
    coverLetter: {
      additionalProperties: false,
      properties: {
        body: {
          items: groundedTextSchema(),
          type: 'array',
        },
        closing: groundedTextSchema(),
        date: {
          type: 'string',
        },
        greeting: {
          type: 'string',
        },
        opening: groundedTextSchema(),
        signature: {
          type: 'string',
        },
      },
      required: ['body', 'closing', 'date', 'greeting', 'opening', 'signature'],
      type: 'object',
    },
    trace: {
      additionalProperties: false,
      properties: {
        model: {
          type: ['string', 'null'],
        },
        provider: {
          const: 'codex',
          type: 'string',
        },
        sessionId: {
          type: ['string', 'null'],
        },
      },
      required: ['model', 'provider', 'sessionId'],
      type: 'object',
    },
  },
  required: ['adaptationSummary', 'adaptedCv', 'coverLetter', 'trace'],
  type: 'object',
} as const
const TAILORED_APPLICATION_GENERATION_MODEL = 'gpt-5.4'
const TAILORED_APPLICATION_GENERATION_REASONING_EFFORT = 'low'

interface TailoredApplicationTaskInput {
  originalCv: {
    extractedTextPath: string
    normalizedJsonPath: string
    writingStyleProfilePath: string
  }
  vacancy: {
    extractedTextPath: string
    normalizedJsonPath: string
  }
}

export function createTailoredApplicationGenerationWorker({
  environment = process.env,
}: {
  environment?: TailoredApplicationGenerationEnvironment
} = {}): TailoredApplicationGenerationWorker {
  return {
    runGeneration: async ({ runDirectoryPath, signal }) => {
      const fixtureOutput = environment.CV_MAXXING_AI_WORKER_GENERATION_OUTPUT

      if (fixtureOutput !== undefined && fixtureOutput.trim() !== '') {
        const delayMs = parseDelay(environment.CV_MAXXING_AI_WORKER_GENERATION_DELAY_MS)

        if (delayMs > 0) {
          await waitForDelay(delayMs, signal)
        }

        if (environment.CV_MAXXING_AI_WORKER_GENERATION_FAILURE) {
          throw new Error(environment.CV_MAXXING_AI_WORKER_GENERATION_FAILURE)
        }

        return parseGenerationResultJson({
          context: 'CV_MAXXING_AI_WORKER_GENERATION_OUTPUT',
          outputText: fixtureOutput,
        })
      }

      return await runCodexCliGeneration({
        command: environment.CV_MAXXING_AI_WORKER_CODEX_COMMAND ?? 'codex',
        runDirectoryPath,
        signal,
        timeoutMs: resolveTimeoutMs(environment.CV_MAXXING_AI_WORKER_GENERATION_TIMEOUT_MS),
      })
    },
  }
}

async function runCodexCliGeneration({
  command,
  runDirectoryPath,
  signal,
  timeoutMs,
}: {
  command: string
  runDirectoryPath: string
  signal: AbortSignal
  timeoutMs: number | null
}): Promise<TailoredApplicationGenerationResult> {
  const startedAt = Date.now()
  const outputDirectoryPath = path.join(runDirectoryPath, 'output')
  const outputFilePath = path.join(outputDirectoryPath, 'result.json')
  const schemaFilePath = path.join(runDirectoryPath, 'output-schema.json')

  await mkdir(outputDirectoryPath, {
    recursive: true,
  })
  await writeFile(schemaFilePath, JSON.stringify(OUTPUT_SCHEMA), 'utf8')

  const prompt = await buildGenerationPrompt(runDirectoryPath)

  const stderrChunks: string[] = []
  console.info(`Starting tailored application generation via Codex CLI in ${runDirectoryPath}.`)

  await new Promise<void>((resolve, reject) => {
    let generationTimedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const child = spawn(
      command,
      [
        'exec',
        '-m',
        TAILORED_APPLICATION_GENERATION_MODEL,
        '-c',
        `model_reasoning_effort="${TAILORED_APPLICATION_GENERATION_REASONING_EFFORT}"`,
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
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    child.stdin.end()
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString())
    })
    child.stdout.on('data', () => {
      return
    })

    if (timeoutMs !== null) {
      timeoutId = setTimeout(() => {
        generationTimedOut = true
        console.error(`Tailored application generation timed out after ${String(timeoutMs)} ms.`)
        child.kill('SIGTERM')
      }, timeoutMs)
    }

    const abortHandler = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }

      child.kill('SIGTERM')
      reject(new Error('Generation cancelled.'))
    }

    signal.addEventListener('abort', abortHandler, {
      once: true,
    })

    child.on('error', (error) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }

      signal.removeEventListener('abort', abortHandler)
      reject(error)
    })
    child.on('close', (code) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }

      signal.removeEventListener('abort', abortHandler)

      if (generationTimedOut) {
        reject(new Error('Tailored application generation timed out.'))

        return
      }

      if (signal.aborted) {
        reject(new Error('Generation cancelled.'))

        return
      }

      if (code !== 0) {
        console.error(
          `Tailored application generation failed in Codex CLI with exit code ${String(code)} after ${String(
            Date.now() - startedAt,
          )} ms.`,
        )
        reject(new Error(stderrChunks.join('').trim() || 'Codex CLI generation failed.'))

        return
      }

      console.info(
        `Tailored application generation completed in ${String(Date.now() - startedAt)} ms.`,
      )
      resolve()
    })
  })

  const outputText = await readFile(outputFilePath, 'utf8')

  return parseGenerationResultJson({
    context: `Codex CLI output at ${outputFilePath}`,
    outputText,
  })
}

async function buildGenerationPrompt(runDirectoryPath: string): Promise<string> {
  const taskFilePath = path.join(runDirectoryPath, 'input', 'task.json')
  const taskText = await readFile(taskFilePath, 'utf8')
  const task = parseTaskInput(taskText)
  const [originalCvJson, originalCvText, vacancyJson, vacancyText, writingStyleProfileJson] =
    await Promise.all([
      readFile(path.join(runDirectoryPath, task.originalCv.normalizedJsonPath), 'utf8'),
      readFile(path.join(runDirectoryPath, task.originalCv.extractedTextPath), 'utf8'),
      readFile(path.join(runDirectoryPath, task.vacancy.normalizedJsonPath), 'utf8'),
      readFile(path.join(runDirectoryPath, task.vacancy.extractedTextPath), 'utf8'),
      readFile(path.join(runDirectoryPath, task.originalCv.writingStyleProfilePath), 'utf8'),
    ])

  return [
    'Return JSON only.',
    'Use British English.',
    'Follow the JSON schema exactly.',
    'Keep the adapted CV and cover letter truthful to the provided CV and vacancy.',
    'Set adaptedCv.headline.text to the role name only.',
    'Reuse a source role label from the original CV, vacancy title, or structured experience role titles.',
    'Do not append skills, technologies, employers, locations, taglines, or separator suffixes.',
    'Use British English spelling.',
    'Format cover-letter dates like "9 April 2026".',
    'Do not fetch any external context.',
    'Do not generate PDFs.',
    'Use only the inline inputs below.',
    '',
    '<task-json>',
    taskText,
    '</task-json>',
    '',
    '<original-cv-json>',
    originalCvJson,
    '</original-cv-json>',
    '',
    '<original-cv-text>',
    originalCvText,
    '</original-cv-text>',
    '',
    '<vacancy-json>',
    vacancyJson,
    '</vacancy-json>',
    '',
    '<vacancy-text>',
    vacancyText,
    '</vacancy-text>',
    '',
    '<writing-style-profile-json>',
    writingStyleProfileJson,
    '</writing-style-profile-json>',
  ].join('\n')
}

function parseTaskInput(taskText: string): TailoredApplicationTaskInput {
  const parsedTask = JSON.parse(taskText) as unknown

  if (!isTailoredApplicationTaskInput(parsedTask)) {
    throw new Error('Tailored application task input is invalid.')
  }

  return parsedTask
}

function isTailoredApplicationTaskInput(value: unknown): value is TailoredApplicationTaskInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    isTaskDocumentGroup(candidate.originalCv) &&
    typeof candidate.originalCv.writingStyleProfilePath === 'string' &&
    isTaskDocumentGroup(candidate.vacancy)
  )
}

function isTaskDocumentGroup(value: unknown): value is {
  extractedTextPath: string
  normalizedJsonPath: string
  writingStyleProfilePath?: string
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.extractedTextPath === 'string' &&
    typeof candidate.normalizedJsonPath === 'string'
  )
}

function groundedTextSchema() {
  return {
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
      },
    },
    required: ['text'],
    type: 'object',
  }
}

function adaptedCvSectionSchema() {
  return {
    anyOf: [
      {
        additionalProperties: false,
        properties: {
          kind: {
            const: 'profile',
            type: 'string',
          },
          summary: groundedTextSchema(),
        },
        required: ['kind', 'summary'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          items: {
            items: {
              additionalProperties: false,
              properties: {
                bullets: {
                  items: groundedTextSchema(),
                  type: 'array',
                },
                dateRange: {
                  type: 'string',
                },
                employer: {
                  type: 'string',
                },
                location: {
                  type: ['string', 'null'],
                },
                roleTitle: {
                  type: 'string',
                },
              },
              required: ['bullets', 'dateRange', 'employer', 'location', 'roleTitle'],
              type: 'object',
            },
            type: 'array',
          },
          kind: {
            const: 'experience',
            type: 'string',
          },
        },
        required: ['items', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          items: {
            items: groundedTextSchema(),
            maxItems: 6,
            type: 'array',
          },
          kind: {
            const: 'core_skills',
            type: 'string',
          },
        },
        required: ['items', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          items: {
            items: groundedTextSchema(),
            maxItems: 6,
            type: 'array',
          },
          kind: {
            const: 'tools',
            type: 'string',
          },
        },
        required: ['items', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          entry: {
            additionalProperties: false,
            properties: {
              meta: {
                type: 'string',
              },
              title: {
                type: 'string',
              },
            },
            required: ['meta', 'title'],
            type: ['object', 'null'],
          },
          kind: {
            const: 'education',
            type: 'string',
          },
        },
        required: ['entry', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          items: {
            items: groundedTextSchema(),
            maxItems: 2,
            type: 'array',
          },
          kind: {
            const: 'certifications',
            type: 'string',
          },
        },
        required: ['items', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          items: {
            items: groundedTextSchema(),
            maxItems: 3,
            type: 'array',
          },
          kind: {
            const: 'languages',
            type: 'string',
          },
        },
        required: ['items', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          items: {
            items: groundedTextSchema(),
            maxItems: 3,
            type: 'array',
          },
          kind: {
            const: 'focus',
            type: 'string',
          },
        },
        required: ['items', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          items: {
            items: groundedTextSchema(),
            type: 'array',
          },
          kind: {
            const: 'selected_work',
            type: 'string',
          },
        },
        required: ['items', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          items: {
            items: groundedTextSchema(),
            type: 'array',
          },
          kind: {
            const: 'impact_highlights',
            type: 'string',
          },
        },
        required: ['items', 'kind'],
        type: 'object',
      },
      {
        additionalProperties: false,
        properties: {
          kind: {
            const: 'references',
            type: 'string',
          },
        },
        required: ['kind'],
        type: 'object',
      },
    ],
  }
}

function parseDelay(value: string | undefined): number {
  const parsedValue = Number.parseInt(value ?? '', 10)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0
  }

  return parsedValue
}

function resolveTimeoutMs(value: string | undefined): number | null {
  const parsedValue = Number.parseInt(value ?? '', 10)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null
  }

  return parsedValue
}

function parseGenerationResultJson({
  context,
  outputText,
}: {
  context: string
  outputText: string
}): TailoredApplicationGenerationResult {
  try {
    return JSON.parse(outputText) as TailoredApplicationGenerationResult
  } catch (error) {
    const preview = buildOutputPreview(outputText)
    const reason = error instanceof Error ? error.message : 'Unknown parse error.'

    throw new Error(`${context} produced invalid JSON: ${reason}. Preview: ${preview}`)
  }
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
      reject(new Error('Generation cancelled.'))
    }

    signal.addEventListener('abort', abortHandler, {
      once: true,
    })
  })
}
