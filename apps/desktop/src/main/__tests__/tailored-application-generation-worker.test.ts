import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => {
  return {
    spawnMock: vi.fn(),
  }
})

vi.mock('node:child_process', () => {
  return {
    spawn: spawnMock,
  }
})

import { createTailoredApplicationGenerationWorker } from '../tailored-application-generation-worker.js'

const temporaryDirectories: string[] = []

class MockEventTarget extends EventTarget {
  on(eventName: string, listener: (detail: unknown) => void): this {
    this.addEventListener(eventName, (event) => {
      listener((event as CustomEvent<unknown>).detail)
    })

    return this
  }

  emit(eventName: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(eventName, { detail }))
  }
}

type MockChildProcess = MockEventTarget & {
  kill: ReturnType<typeof vi.fn>
  stderr: MockEventTarget
  stdin: {
    end: ReturnType<typeof vi.fn>
  }
  stdout: MockEventTarget
}

function createMockChildProcess(): MockChildProcess {
  const child = new MockEventTarget() as MockChildProcess

  child.kill = vi.fn()
  child.stderr = new MockEventTarget()
  child.stdin = {
    end: vi.fn(),
  }
  child.stdout = new MockEventTarget()

  return child
}

afterEach(async () => {
  vi.useRealTimers()
  spawnMock.mockReset()

  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      })
    }),
  )
})

test('reports invalid fixture JSON with clear context', async () => {
  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: '{"invalid"',
    },
  })

  await expect(
    worker.runGeneration({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/CV_MAXXING_AI_WORKER_GENERATION_OUTPUT produced invalid JSON/u)
})

test('times out a stalled Codex CLI generation and logs lifecycle milestones', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-timeout-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation((message: string) => {
    void message
  })
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message: string) => {
    void message
  })

  let childProcess: MockChildProcess | undefined

  spawnMock.mockImplementation(() => {
    const child = createMockChildProcess()

    child.kill = vi.fn(() => {
      child.emit('close', null)
    })
    childProcess = child

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
      CV_MAXXING_AI_WORKER_GENERATION_TIMEOUT_MS: '25',
    },
  })

  const runPromise = worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  await expect(runPromise).rejects.toThrow('Tailored application generation timed out.')
  expect(childProcess?.kill).toHaveBeenCalledWith('SIGTERM')
  expect(consoleInfoSpy).toHaveBeenCalledWith(
    `Starting tailored application generation via Codex CLI in ${runDirectoryPath}.`,
  )
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    'Tailored application generation timed out after 25 ms.',
  )
})

test('does not time out by default and logs completion duration', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-no-timeout-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation((message: string) => {
    void message
  })
  const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
  const dateNowSpy = vi.spyOn(Date, 'now')

  const childProcess = createMockChildProcess()

  dateNowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(9000)

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const outputFilePath = args[args.indexOf('--output-last-message') + 1]

    if (outputFilePath === undefined) {
      throw new Error('Expected Codex CLI output file path argument.')
    }

    queueMicrotask(() => {
      void writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8').then(
        () => {
          childProcess.emit('close', 0)
        },
        (error: unknown) => {
          childProcess.emit('error', error)
        },
      )
    })

    return childProcess
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  const runPromise = worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  await expect(runPromise).resolves.toEqual(createValidGenerationResult())
  expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 300_000)
  expect(childProcess.kill).not.toHaveBeenCalled()
  expect(consoleInfoSpy).toHaveBeenCalledWith(
    `Starting tailored application generation via Codex CLI in ${runDirectoryPath}.`,
  )
  expect(consoleInfoSpy).toHaveBeenCalledWith(
    'Tailored application generation completed in 8000 ms.',
  )
})

test('writes a typed trace provider field in the Codex CLI output schema', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-output-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  let capturedSchema:
    | {
        properties?: {
          trace?: {
            properties?: {
              provider?: unknown
            }
          }
        }
      }
    | undefined

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const schemaFlagIndex = args.indexOf('--output-schema')
    const outputFlagIndex = args.indexOf('--output-last-message')

    if (
      schemaFlagIndex === -1 ||
      outputFlagIndex === -1 ||
      schemaFlagIndex + 1 >= args.length ||
      outputFlagIndex + 1 >= args.length
    ) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    const schemaFilePath = args[schemaFlagIndex + 1]
    const outputFilePath = args[outputFlagIndex + 1]

    if (schemaFilePath === undefined || outputFilePath === undefined) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    void Promise.all([
      readFile(schemaFilePath, 'utf8').then((schemaText) => {
        capturedSchema = JSON.parse(schemaText) as typeof capturedSchema
      }),
      writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8'),
    ]).then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await expect(
    worker.runGeneration({
      runDirectoryPath,
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual(createValidGenerationResult())

  expect(capturedSchema?.properties?.trace?.properties?.provider).toEqual({
    const: 'codex',
    type: 'string',
  })
})

test('writes a concise adapted-CV header intro field in the Codex CLI output schema', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-output-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  let capturedSchema:
    | {
        properties?: {
          adaptedCv?: {
            properties?: {
              header?: {
                properties?: {
                  intro?: {
                    properties?: {
                      text?: unknown
                    }
                  }
                }
              }
            }
          }
        }
      }
    | undefined

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const schemaFlagIndex = args.indexOf('--output-schema')
    const outputFlagIndex = args.indexOf('--output-last-message')

    if (
      schemaFlagIndex === -1 ||
      outputFlagIndex === -1 ||
      schemaFlagIndex + 1 >= args.length ||
      outputFlagIndex + 1 >= args.length
    ) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    const schemaFilePath = args[schemaFlagIndex + 1]
    const outputFilePath = args[outputFlagIndex + 1]

    if (schemaFilePath === undefined || outputFilePath === undefined) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    void Promise.all([
      readFile(schemaFilePath, 'utf8').then((schemaText) => {
        capturedSchema = JSON.parse(schemaText) as typeof capturedSchema
      }),
      writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8'),
    ]).then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  expect(capturedSchema?.properties?.adaptedCv?.properties?.header?.properties?.intro).toEqual({
    additionalProperties: false,
    properties: {
      text: {
        maxLength: 180,
        type: 'string',
      },
    },
    required: ['text'],
    type: 'object',
  })
})

test('writes stricter sidebar-label descriptions for core skills and tools in the Codex CLI output schema', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-output-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  let capturedSchema:
    | {
        properties?: {
          adaptedCv?: {
            properties?: {
              coreSkills?: {
                description?: string
              }
              tools?: {
                description?: string
              }
            }
          }
        }
      }
    | undefined

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const schemaFlagIndex = args.indexOf('--output-schema')
    const outputFlagIndex = args.indexOf('--output-last-message')

    if (
      schemaFlagIndex === -1 ||
      outputFlagIndex === -1 ||
      schemaFlagIndex + 1 >= args.length ||
      outputFlagIndex + 1 >= args.length
    ) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    const schemaFilePath = args[schemaFlagIndex + 1]
    const outputFilePath = args[outputFlagIndex + 1]

    if (schemaFilePath === undefined || outputFilePath === undefined) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    void Promise.all([
      readFile(schemaFilePath, 'utf8').then((schemaText) => {
        capturedSchema = JSON.parse(schemaText) as typeof capturedSchema
      }),
      writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8'),
    ]).then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  expect(capturedSchema?.properties?.adaptedCv?.properties?.coreSkills?.description).toContain(
    'Return concise sidebar labels only',
  )
  expect(capturedSchema?.properties?.adaptedCv?.properties?.coreSkills?.description).toContain(
    'not sentences',
  )
  expect(capturedSchema?.properties?.adaptedCv?.properties?.tools?.description).toContain(
    'Return ungrouped concise tool labels only',
  )
  expect(capturedSchema?.properties?.adaptedCv?.properties?.tools?.description).toContain(
    'Do not combine multiple tools into one item',
  )
})

test('does not require cover-letter plain text in the Codex CLI output schema', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-output-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  let capturedSchema:
    | {
        required?: string[]
      }
    | undefined

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const schemaFlagIndex = args.indexOf('--output-schema')
    const outputFlagIndex = args.indexOf('--output-last-message')

    if (
      schemaFlagIndex === -1 ||
      outputFlagIndex === -1 ||
      schemaFlagIndex + 1 >= args.length ||
      outputFlagIndex + 1 >= args.length
    ) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    const schemaFilePath = args[schemaFlagIndex + 1]
    const outputFilePath = args[outputFlagIndex + 1]

    if (schemaFilePath === undefined || outputFilePath === undefined) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    void Promise.all([
      readFile(schemaFilePath, 'utf8').then((schemaText) => {
        capturedSchema = JSON.parse(schemaText) as typeof capturedSchema
      }),
      writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8'),
    ]).then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  expect(capturedSchema?.required).not.toContain('coverLetterPlainText')
})

test('writes a Codex-compatible tailored-application schema without unsupported composition branches', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-output-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  let capturedSchemaText = ''

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const schemaFlagIndex = args.indexOf('--output-schema')
    const outputFlagIndex = args.indexOf('--output-last-message')

    if (
      schemaFlagIndex === -1 ||
      outputFlagIndex === -1 ||
      schemaFlagIndex + 1 >= args.length ||
      outputFlagIndex + 1 >= args.length
    ) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    const schemaFilePath = args[schemaFlagIndex + 1]
    const outputFilePath = args[outputFlagIndex + 1]

    if (schemaFilePath === undefined || outputFilePath === undefined) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    void Promise.all([
      readFile(schemaFilePath, 'utf8').then((schemaText) => {
        capturedSchemaText = schemaText
      }),
      writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8'),
    ]).then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  expect(capturedSchemaText).toContain('"adaptedCv"')
  expect(capturedSchemaText).not.toContain('"oneOf"')
  expect(capturedSchemaText).not.toContain('"allOf"')
})

test('requires explicit adapted-CV section objects in the Codex output schema', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-required-sections-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  let capturedSchema:
    | {
        properties?: {
          adaptedCv?: {
            properties?: {
              certifications?: unknown
              coreSkills?: unknown
              education?: unknown
              experience?: unknown
              focus?: unknown
              impactHighlights?: unknown
              languages?: unknown
              profile?: unknown
              references?: unknown
              selectedWork?: unknown
              sections?: unknown
              tools?: unknown
            }
            required?: string[]
          }
        }
      }
    | undefined

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const schemaFilePath = args[args.indexOf('--output-schema') + 1]
    const outputFilePath = args[args.indexOf('--output-last-message') + 1]

    if (schemaFilePath === undefined || outputFilePath === undefined) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    void Promise.all([
      readFile(schemaFilePath, 'utf8').then((schemaText) => {
        capturedSchema = JSON.parse(schemaText) as typeof capturedSchema
      }),
      writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8'),
    ]).then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  expect(capturedSchema?.properties?.adaptedCv?.properties?.sections).toBeUndefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.profile).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.experience).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.selectedWork).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.impactHighlights).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.coreSkills).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.tools).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.education).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.certifications).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.languages).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.focus).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.properties?.references).toBeDefined()
  expect(capturedSchema?.properties?.adaptedCv?.required).toEqual(
    expect.arrayContaining([
      'profile',
      'experience',
      'selectedWork',
      'impactHighlights',
      'coreSkills',
      'tools',
      'education',
      'certifications',
      'languages',
      'focus',
      'references',
    ]),
  )
})

test('normalizes explicit adapted-CV section fields into the legacy sections array', async () => {
  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createStructuredGenerationResult()),
    },
  })

  await expect(
    worker.runGeneration({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual(createValidGenerationResult())
})

test('instructs Codex to emit a role-only adapted-CV headline', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-headline-prompt-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  let capturedPrompt = ''

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const outputFilePath = args[args.indexOf('--output-last-message') + 1]
    const prompt = args.at(-1)

    if (outputFilePath === undefined || prompt === undefined) {
      throw new Error('Expected Codex CLI output file path and prompt arguments.')
    }

    capturedPrompt = prompt

    void writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8').then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  expect(capturedPrompt).toContain('Set adaptedCv.headline.text to the role name only.')
  expect(capturedPrompt).toContain(
    'Always include adaptedCv.profile, adaptedCv.experience, adaptedCv.coreSkills, and adaptedCv.references.',
  )
  expect(capturedPrompt).toContain(
    'If tailoring evidence is thin, keep required sections concise and grounded in the original CV rather than omitting them.',
  )
  expect(capturedPrompt).toContain(
    'Retain every source role from the original CV in adaptedCv.experience.items; do not omit earlier roles even when they are less relevant.',
  )
  expect(capturedPrompt).toContain(
    'Preserve the source experience chronology in adaptedCv.experience.items, with the most recent roles first.',
  )
  expect(capturedPrompt).toContain(
    'Keep older or less relevant roles briefer by using fewer bullets and tighter phrasing instead of dropping those roles.',
  )
  expect(capturedPrompt).toContain(
    'Return explicit adaptedCv fields for every template section: profile, experience, selectedWork, impactHighlights, coreSkills, tools, education, certifications, languages, focus, and references.',
  )
  expect(capturedPrompt).toContain(
    'Return adaptedCv.coreSkills.items as concise vacancy-relevant skill labels only, not sentences, achievements, or responsibility statements.',
  )
  expect(capturedPrompt).toContain(
    'Keep each adaptedCv.coreSkills.items entry brief, usually one to three words.',
  )
  expect(capturedPrompt).toContain(
    "Good adaptedCv.coreSkills.items examples: 'Stakeholder management', 'Roadmapping', 'Service design'.",
  )
  expect(capturedPrompt).toContain(
    "Bad adaptedCv.coreSkills.items examples: 'Led cross-functional teams to deliver roadmap outcomes.' and 'Improved stakeholder alignment across product and engineering teams'.",
  )
  expect(capturedPrompt).toContain(
    'Always include adaptedCv.profile, adaptedCv.experience, adaptedCv.coreSkills, and adaptedCv.references.',
  )
  expect(capturedPrompt).toContain(
    'Set optional section fields to null when they are weak, generic, duplicative, unsupported, or not needed.',
  )
  expect(capturedPrompt).toContain(
    'Return adaptedCv.tools.items only for concise technology, framework, platform, database, or tooling labels that are explicit or conservatively inferable from the original CV.',
  )
  expect(capturedPrompt).toContain(
    "Ungroup adaptedCv.tools.items; split combined labels such as 'NoSQL databases (MongoDB, AWS DynamoDB)' into separate items like 'MongoDB' and 'AWS DynamoDB'.",
  )
  expect(capturedPrompt).toContain(
    "Bad adaptedCv.tools.items examples: 'MongoDB / DynamoDB', 'Figma and FigJam', and 'NoSQL databases (MongoDB, AWS DynamoDB)'.",
  )
  expect(capturedPrompt).toContain(
    'Do not repeat the same label across adaptedCv.coreSkills.items and adaptedCv.tools.items.',
  )
  expect(capturedPrompt).toContain(
    'Return adaptedCv.impactHighlights.items only for grounded achievement or outcome lines, not for skills or tooling lists.',
  )
  expect(capturedPrompt).toContain(
    'Return adaptedCv.selectedWork.items only for grounded named projects, products, clients, or case-study style examples.',
  )
  expect(capturedPrompt).toContain(
    'Return adaptedCv.education as the latest relevant completed education entry only, or null.',
  )
  expect(capturedPrompt).toContain(
    'Keep adaptedCv.header.intro.text to a short recruiter-facing introduction, not a paragraph, and at most 180 characters.',
  )
})

test('passes inline structured inputs to Codex instead of asking it to read files itself', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-inline-inputs-'),
  )

  temporaryDirectories.push(runDirectoryPath)

  await createRunWorkspaceInput(runDirectoryPath)

  let capturedPrompt = ''

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const outputFilePath = args[args.indexOf('--output-last-message') + 1]
    const prompt = args.at(-1)

    if (outputFilePath === undefined || prompt === undefined) {
      throw new Error('Expected Codex CLI output file path and prompt arguments.')
    }

    capturedPrompt = prompt

    void writeFile(outputFilePath, JSON.stringify(createValidGenerationResult()), 'utf8').then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await worker.runGeneration({
    runDirectoryPath,
    signal: new AbortController().signal,
  })

  expect(capturedPrompt).toContain('Use only the inline inputs below.')
  expect(capturedPrompt).toContain('<task-json>')
  expect(capturedPrompt).toContain('"headline":"Senior Web Engineer"')
  expect(capturedPrompt).toContain('Original CV text')
  expect(capturedPrompt).toContain('Vacancy text')
  expect(capturedPrompt).not.toContain(
    'Read input/task.json and the referenced structured input files.',
  )
})

test('reports invalid Codex CLI output JSON with the output file path', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-invalid-json-'),
  )

  temporaryDirectories.push(runDirectoryPath)
  await createRunWorkspaceInput(runDirectoryPath)

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChildProcess()

    const outputFilePath = args[args.indexOf('--output-last-message') + 1]

    if (outputFilePath === undefined) {
      throw new Error('Expected Codex CLI output file path argument.')
    }

    void writeFile(outputFilePath, '{"invalid"', 'utf8').then(
      () => {
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createTailoredApplicationGenerationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await expect(
    worker.runGeneration({
      runDirectoryPath,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/Codex CLI output at .*result\.json produced invalid JSON/u)

  expect(spawnMock).toHaveBeenCalledWith(
    'codex',
    expect.arrayContaining([
      'exec',
      '-m',
      'gpt-5.4',
      '-c',
      'model_reasoning_effort="low"',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
    ]),
    expect.objectContaining({
      cwd: runDirectoryPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  )
  expect(spawnMock.mock.calls[0]?.[1]).not.toContain('-a')
})

function createValidGenerationResult() {
  return {
    adaptationSummary: {
      emphasized: [
        {
          text: 'Emphasises desktop workflow design for technical users.',
        },
      ],
      gaps: [
        'The vacancy asks for workflow-software shipping experience; the original CV shows related desktop-tooling design work but does not claim engineering ownership.',
      ],
      omitted: [
        {
          text: 'Compresses broader research language so the vacancy-specific desktop tooling evidence stays primary.',
        },
      ],
      validationHints: ['Keep interview examples grounded in shipped desktop workflow tooling.'],
    },
    adaptedCv: {
      candidateName: 'Ada Lovelace',
      header: {
        intro: {
          text: 'Design leader shaping truthful desktop workflow products for technical users.',
        },
      },
      headline: {
        text: 'Principal Product Designer',
      },
      sections: [
        {
          kind: 'profile',
          summary: {
            text: 'Design leader adapting complex desktop workflow products for technical users.',
          },
        },
        {
          items: [
            {
              bullets: [
                {
                  text: 'Led product design for AI-assisted desktop tooling used by technical teams.',
                },
              ],
              dateRange: '2022 — Present',
              employer: 'Analytical Engines Ltd',
              location: 'London',
              roleTitle: 'Lead Product Designer',
            },
          ],
          kind: 'experience',
        },
        {
          items: [
            {
              text: 'Workflow redesign for regulatory tooling',
            },
          ],
          kind: 'selected_work',
        },
        {
          items: [
            {
              text: 'Improved operator throughput for technical workflow reviews.',
            },
          ],
          kind: 'impact_highlights',
        },
        {
          items: [
            {
              text: 'Product strategy',
            },
            {
              text: 'UX research',
            },
          ],
          kind: 'core_skills',
        },
        {
          items: [
            {
              text: 'Figma',
            },
            {
              text: 'FigJam',
            },
          ],
          kind: 'tools',
        },
        {
          entry: {
            meta: 'UCL · 2015 — 2018',
            title: 'BSc Computer Science',
          },
          kind: 'education',
        },
        {
          items: [
            {
              text: 'NN/g UX Certification',
            },
          ],
          kind: 'certifications',
        },
        {
          items: [
            {
              text: 'English (Native)',
            },
          ],
          kind: 'languages',
        },
        {
          items: [
            {
              text: 'Technical product design',
            },
          ],
          kind: 'focus',
        },
        {
          kind: 'references',
        },
      ],
    },
    coverLetter: {
      body: [
        {
          text: 'I have led product design for AI-assisted desktop tooling, which aligns with your focus on reliable tooling for technical users.',
        },
      ],
      closing: {
        text: 'I would welcome the chance to discuss how that experience could support Example Labs.',
      },
      date: '9 April 2026',
      greeting: 'Dear Hiring Manager,',
      opening: {
        text: 'I am applying for the Senior platform engineer role at Example Labs.',
      },
      signature: 'Ada Lovelace',
    },
    trace: {
      model: 'gpt-5.4-codex',
      provider: 'codex' as const,
      sessionId: 'session-123',
    },
  }
}

function createStructuredGenerationResult() {
  const result = createValidGenerationResult()
  const [
    profileSection,
    experienceSection,
    selectedWorkSection,
    impactHighlightsSection,
    coreSkillsSection,
    toolsSection,
    educationSection,
    certificationsSection,
    languagesSection,
    focusSection,
    referencesSection,
  ] = result.adaptedCv.sections

  if (
    profileSection?.kind !== 'profile' ||
    experienceSection?.kind !== 'experience' ||
    selectedWorkSection?.kind !== 'selected_work' ||
    impactHighlightsSection?.kind !== 'impact_highlights' ||
    coreSkillsSection?.kind !== 'core_skills' ||
    toolsSection?.kind !== 'tools' ||
    educationSection?.kind !== 'education' ||
    certificationsSection?.kind !== 'certifications' ||
    languagesSection?.kind !== 'languages' ||
    focusSection?.kind !== 'focus' ||
    referencesSection?.kind !== 'references'
  ) {
    throw new Error('Expected the valid generation result to contain the required section order.')
  }

  return {
    ...result,
    adaptedCv: {
      candidateName: result.adaptedCv.candidateName,
      coreSkills: {
        items: coreSkillsSection.items,
      },
      experience: {
        items: experienceSection.items,
      },
      header: result.adaptedCv.header,
      headline: result.adaptedCv.headline,
      selectedWork: {
        items: selectedWorkSection.items,
      },
      impactHighlights: {
        items: impactHighlightsSection.items,
      },
      profile: {
        summary: profileSection.summary,
      },
      tools: {
        items: toolsSection.items,
      },
      education: {
        entry: educationSection.entry,
      },
      certifications: {
        items: certificationsSection.items,
      },
      languages: {
        items: languagesSection.items,
      },
      focus: {
        items: focusSection.items,
      },
      references: referencesSection,
    },
  }
}

async function createRunWorkspaceInput(runDirectoryPath: string): Promise<void> {
  await mkdir(path.join(runDirectoryPath, 'input'), {
    recursive: true,
  })

  await Promise.all([
    writeFile(
      path.join(runDirectoryPath, 'input', 'task.json'),
      JSON.stringify({
        originalCv: {
          extractedTextPath: 'input/original-cv.txt',
          normalizedJsonPath: 'input/original-cv.json',
          writingStyleProfilePath: 'input/writing-style-profile.json',
        },
        vacancy: {
          extractedTextPath: 'input/vacancy.txt',
          normalizedJsonPath: 'input/vacancy.json',
        },
      }),
      'utf8',
    ),
    writeFile(path.join(runDirectoryPath, 'input', 'original-cv.txt'), 'Original CV text', 'utf8'),
    writeFile(
      path.join(runDirectoryPath, 'input', 'original-cv.json'),
      JSON.stringify({
        headline: 'Senior Web Engineer',
      }),
      'utf8',
    ),
    writeFile(path.join(runDirectoryPath, 'input', 'vacancy.txt'), 'Vacancy text', 'utf8'),
    writeFile(
      path.join(runDirectoryPath, 'input', 'vacancy.json'),
      JSON.stringify({
        title: 'Full Stack Engineer',
      }),
      'utf8',
    ),
    writeFile(
      path.join(runDirectoryPath, 'input', 'writing-style-profile.json'),
      JSON.stringify({
        formality: 'direct',
      }),
      'utf8',
    ),
  ])
}
