import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

import type {
  AdaptedCvEducationEntry,
  AdaptedCvExperienceEntry,
  GroundedText,
  TailoredApplicationGenerationResult,
} from '../shared/tailored-application.js'
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
        coreSkills: {
          description: 'Required sidebar section. Max 6 short vacancy-relevant skill labels.',
          additionalProperties: false,
          properties: {
            items: {
              items: conciseGroundedTextSchema(40),
              maxItems: 6,
              type: 'array',
            },
          },
          required: ['items'],
          type: 'object',
        },
        experience: {
          additionalProperties: false,
          properties: {
            items: {
              items: adaptedCvExperienceEntrySchema(),
              type: 'array',
            },
          },
          required: ['items'],
          type: 'object',
        },
        selectedWork: nullableItemsSectionSchema({
          description:
            'Optional left-column section. Use only for grounded named projects, products, clients, or case-study style examples.',
          items: groundedTextSchema(),
        }),
        impactHighlights: nullableItemsSectionSchema({
          description:
            'Optional left-column section. Use only for grounded outcome or achievement lines, not for skill or tooling lists.',
          items: groundedTextSchema(),
        }),
        profile: {
          additionalProperties: false,
          properties: {
            summary: groundedTextSchema(),
          },
          required: ['summary'],
          type: 'object',
        },
        tools: nullableItemsSectionSchema({
          description:
            'Optional sidebar section. Max 6 concise technology, framework, platform, database, or tooling labels.',
          items: conciseGroundedTextSchema(48),
          maxItems: 6,
        }),
        education: nullableEducationSectionSchema(),
        certifications: nullableItemsSectionSchema({
          description: 'Optional sidebar section. Max 2 concise certification labels.',
          items: conciseGroundedTextSchema(60),
          maxItems: 2,
        }),
        languages: nullableItemsSectionSchema({
          description: 'Optional sidebar section. Max 3 concise language entries.',
          items: conciseGroundedTextSchema(40),
          maxItems: 3,
        }),
        focus: nullableItemsSectionSchema({
          description: 'Optional sidebar section. Max 3 concise focus labels.',
          items: conciseGroundedTextSchema(40),
          maxItems: 3,
        }),
        references: {
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
      },
      required: [
        'candidateName',
        'coreSkills',
        'experience',
        'header',
        'headline',
        'selectedWork',
        'impactHighlights',
        'profile',
        'tools',
        'education',
        'certifications',
        'languages',
        'focus',
        'references',
      ],
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

interface StructuredWorkerAdaptedCv {
  candidateName: string
  coreSkills: {
    items: GroundedText[]
  }
  experience: {
    items: AdaptedCvExperienceEntry[]
  }
  header: {
    intro: GroundedText
  }
  headline: GroundedText
  selectedWork: {
    items: GroundedText[]
  } | null
  impactHighlights: {
    items: GroundedText[]
  } | null
  profile: {
    summary: GroundedText
  }
  tools: {
    items: GroundedText[]
  } | null
  education: {
    entry: AdaptedCvEducationEntry
  } | null
  certifications: {
    items: GroundedText[]
  } | null
  languages: {
    items: GroundedText[]
  } | null
  focus: {
    items: GroundedText[]
  } | null
  references: {
    kind: 'references'
  }
}

type WorkerGenerationResult = Omit<TailoredApplicationGenerationResult, 'adaptedCv'> & {
  adaptedCv: StructuredWorkerAdaptedCv | TailoredApplicationGenerationResult['adaptedCv']
}

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
    'Return explicit adaptedCv fields for every template section: profile, experience, selectedWork, impactHighlights, coreSkills, tools, education, certifications, languages, focus, and references.',
    'Always include adaptedCv.profile, adaptedCv.experience, adaptedCv.coreSkills, and adaptedCv.references.',
    'Set optional section fields to null when they are weak, generic, duplicative, unsupported, or not needed.',
    'Return adaptedCv.coreSkills.items as concise vacancy-relevant skill labels only, not sentences, achievements, or responsibility statements.',
    'Keep each adaptedCv.coreSkills.items entry brief, usually one to three words.',
    'Return adaptedCv.tools.items only for concise technology, framework, platform, database, or tooling labels that are explicit or conservatively inferable from the original CV.',
    "Ungroup adaptedCv.tools.items; split combined labels such as 'NoSQL databases (MongoDB, AWS DynamoDB)' into separate items like 'MongoDB' and 'AWS DynamoDB'.",
    'Do not repeat the same label across adaptedCv.coreSkills.items and adaptedCv.tools.items.',
    'Return adaptedCv.selectedWork.items only for grounded named projects, products, clients, or case-study style examples.',
    'Return adaptedCv.impactHighlights.items only for grounded achievement or outcome lines, not for skills or tooling lists.',
    'Return adaptedCv.education as the latest relevant completed education entry only, or null.',
    'Return adaptedCv.certifications.items, adaptedCv.languages.items, and adaptedCv.focus.items as concise sidebar entries only when strongly grounded and useful.',
    'Set adaptedCv.headline.text to the role name only.',
    'Reuse a source role label from the original CV, vacancy title, or structured experience role titles.',
    'Do not append skills, technologies, employers, locations, taglines, or separator suffixes.',
    'If tailoring evidence is thin, keep required sections concise and grounded in the original CV rather than omitting them.',
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

function conciseGroundedTextSchema(maxLength: number) {
  return {
    additionalProperties: false,
    properties: {
      text: {
        maxLength,
        type: 'string',
      },
    },
    required: ['text'],
    type: 'object',
  }
}

function adaptedCvExperienceEntrySchema() {
  return {
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
  }
}

function nullableItemsSectionSchema({
  description,
  items,
  maxItems,
}: {
  description: string
  items: ReturnType<typeof groundedTextSchema> | ReturnType<typeof conciseGroundedTextSchema>
  maxItems?: number
}) {
  return {
    additionalProperties: false,
    description,
    properties: {
      items: {
        ...(maxItems === undefined
          ? {}
          : {
              maxItems,
            }),
        items,
        type: 'array',
      },
    },
    required: ['items'],
    type: ['object', 'null'],
  }
}

function nullableEducationSectionSchema() {
  return {
    additionalProperties: false,
    description: 'Optional sidebar section. Latest relevant completed education entry only.',
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
        type: 'object',
      },
    },
    required: ['entry'],
    type: ['object', 'null'],
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
    return normalizeWorkerGenerationResult(JSON.parse(outputText) as WorkerGenerationResult)
  } catch (error) {
    const preview = buildOutputPreview(outputText)
    const reason = error instanceof Error ? error.message : 'Unknown parse error.'

    throw new Error(`${context} produced invalid JSON: ${reason}. Preview: ${preview}`)
  }
}

function normalizeWorkerGenerationResult(
  result: WorkerGenerationResult,
): TailoredApplicationGenerationResult {
  if (!isStructuredWorkerAdaptedCv(result.adaptedCv)) {
    return result as TailoredApplicationGenerationResult
  }

  return {
    ...result,
    adaptedCv: {
      candidateName: result.adaptedCv.candidateName,
      header: result.adaptedCv.header,
      headline: result.adaptedCv.headline,
      sections: [
        {
          kind: 'profile',
          summary: result.adaptedCv.profile.summary,
        },
        {
          items: result.adaptedCv.experience.items,
          kind: 'experience',
        },
        ...(result.adaptedCv.selectedWork === null
          ? []
          : [
              {
                items: result.adaptedCv.selectedWork.items,
                kind: 'selected_work' as const,
              },
            ]),
        ...(result.adaptedCv.impactHighlights === null
          ? []
          : [
              {
                items: result.adaptedCv.impactHighlights.items,
                kind: 'impact_highlights' as const,
              },
            ]),
        {
          items: result.adaptedCv.coreSkills.items,
          kind: 'core_skills',
        },
        ...(result.adaptedCv.tools === null
          ? []
          : [
              {
                items: result.adaptedCv.tools.items,
                kind: 'tools' as const,
              },
            ]),
        ...(result.adaptedCv.education === null
          ? []
          : [
              {
                entry: result.adaptedCv.education.entry,
                kind: 'education' as const,
              },
            ]),
        ...(result.adaptedCv.certifications === null
          ? []
          : [
              {
                items: result.adaptedCv.certifications.items,
                kind: 'certifications' as const,
              },
            ]),
        ...(result.adaptedCv.languages === null
          ? []
          : [
              {
                items: result.adaptedCv.languages.items,
                kind: 'languages' as const,
              },
            ]),
        ...(result.adaptedCv.focus === null
          ? []
          : [
              {
                items: result.adaptedCv.focus.items,
                kind: 'focus' as const,
              },
            ]),
        result.adaptedCv.references,
      ],
    },
  }
}

function isStructuredWorkerAdaptedCv(
  value: WorkerGenerationResult['adaptedCv'],
): value is StructuredWorkerAdaptedCv {
  return !('sections' in value)
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
