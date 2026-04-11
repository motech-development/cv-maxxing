import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

afterEach(async () => {
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

test('writes a typed trace provider field in the Codex CLI output schema', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-output-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)

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
    const child = new MockEventTarget() as MockEventTarget & {
      kill: ReturnType<typeof vi.fn>
      stderr: MockEventTarget
      stdout: MockEventTarget
    }

    child.kill = vi.fn()
    child.stderr = new MockEventTarget()
    child.stdout = new MockEventTarget()

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

test('does not require cover-letter plain text in the Codex CLI output schema', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-output-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)

  let capturedSchema:
    | {
        required?: string[]
      }
    | undefined

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new MockEventTarget() as MockEventTarget & {
      kill: ReturnType<typeof vi.fn>
      stderr: MockEventTarget
      stdout: MockEventTarget
    }

    child.kill = vi.fn()
    child.stderr = new MockEventTarget()
    child.stdout = new MockEventTarget()

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

test('reports invalid Codex CLI output JSON with the output file path', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-generation-worker-invalid-json-'),
  )

  temporaryDirectories.push(runDirectoryPath)

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new MockEventTarget() as MockEventTarget & {
      kill: ReturnType<typeof vi.fn>
      stderr: MockEventTarget
      stdout: MockEventTarget
    }

    child.kill = vi.fn()
    child.stderr = new MockEventTarget()
    child.stdout = new MockEventTarget()

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
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
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
        text: 'Principal Product Designer for desktop workflow products',
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
              heading: 'Analytical Engines Ltd',
            },
          ],
          kind: 'experience',
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
