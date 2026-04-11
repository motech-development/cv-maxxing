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
      })
    },
  }
}

async function runCodexCliGeneration({
  command,
  runDirectoryPath,
  signal,
}: {
  command: string
  runDirectoryPath: string
  signal: AbortSignal
}): Promise<TailoredApplicationGenerationResult> {
  const outputDirectoryPath = path.join(runDirectoryPath, 'output')
  const outputFilePath = path.join(outputDirectoryPath, 'result.json')
  const schemaFilePath = path.join(runDirectoryPath, 'output-schema.json')

  await mkdir(outputDirectoryPath, {
    recursive: true,
  })
  await writeFile(schemaFilePath, JSON.stringify(OUTPUT_SCHEMA), 'utf8')

  const prompt = [
    'Read input/task.json and the referenced structured input files.',
    'Return JSON only.',
    'Use British English.',
    'Follow the JSON schema exactly.',
    'Keep the adapted CV and cover letter truthful to the provided CV and vacancy.',
    'Use British English spelling.',
    'Format cover-letter dates like "9 April 2026".',
    'Do not fetch any external context.',
    'Do not generate PDFs.',
  ].join(' ')

  const stderrChunks: string[] = []

  await new Promise<void>((resolve, reject) => {
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
      reject(new Error('Generation cancelled.'))
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
        reject(new Error('Generation cancelled.'))

        return
      }

      if (code !== 0) {
        reject(new Error(stderrChunks.join('').trim() || 'Codex CLI generation failed.'))

        return
      }

      resolve()
    })
  })

  const outputText = await readFile(outputFilePath, 'utf8')

  return parseGenerationResultJson({
    context: `Codex CLI output at ${outputFilePath}`,
    outputText,
  })
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
    oneOf: [
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
