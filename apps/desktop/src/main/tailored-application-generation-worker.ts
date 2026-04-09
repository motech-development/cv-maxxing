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
        experienceHighlights: {
          items: {
            additionalProperties: false,
            properties: {
              bullets: {
                items: groundedTextSchema(),
                type: 'array',
              },
              heading: {
                type: 'string',
              },
            },
            required: ['bullets', 'heading'],
            type: 'object',
          },
          type: 'array',
        },
        headline: groundedTextSchema(),
        skills: {
          items: groundedTextSchema(),
          type: 'array',
        },
        summary: groundedTextSchema(),
      },
      required: ['candidateName', 'experienceHighlights', 'headline', 'skills', 'summary'],
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
    coverLetterPlainText: {
      type: 'string',
    },
    trace: {
      additionalProperties: false,
      properties: {
        model: {
          type: ['string', 'null'],
        },
        provider: {
          const: 'codex',
        },
        sessionId: {
          type: ['string', 'null'],
        },
      },
      required: ['model', 'provider', 'sessionId'],
      type: 'object',
    },
  },
  required: ['adaptationSummary', 'adaptedCv', 'coverLetter', 'coverLetterPlainText', 'trace'],
  type: 'object',
} as const

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
    'Ground every generated claim in the provided evidence.',
    'Do not fetch any external context.',
    'Do not generate PDFs.',
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
      sourceEvidence: {
        items: {
          type: 'string',
        },
        type: 'array',
      },
      text: {
        type: 'string',
      },
    },
    required: ['sourceEvidence', 'text'],
    type: 'object',
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
