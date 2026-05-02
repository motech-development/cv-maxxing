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

import { createVacancyNormalizationWorker } from '../vacancy-normalization-worker.js'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

test('reports invalid fixture JSON with clear context for vacancy normalization', async () => {
  const worker = createVacancyNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: '{"invalid"',
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT produced invalid JSON/u)
})

test('rejects fixture output that does not match the vacancy-normalization contract', async () => {
  const worker = createVacancyNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: JSON.stringify({
        kind: 'success',
        normalizedVacancy: {
          employer: 'Example Labs',
          title: 'Senior Product Designer',
        },
      }),
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/produced invalid normalization output/u)
})

test('returns parsed normalization results from fixture output', async () => {
  const worker = createVacancyNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: JSON.stringify({
        kind: 'success',
        normalizedVacancy: {
          bodyText:
            'Lead product design for desktop workflows. Partner with engineering and research.',
          employer: 'Example Labs',
          location: 'London, United Kingdom',
          requirements: ['Experience shipping workflow software.'],
          responsibilities: ['Lead product design for desktop workflows.'],
          title: 'Senior Product Designer',
        },
      }),
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({
    kind: 'success',
    normalizedVacancy: {
      bodyText: 'Lead product design for desktop workflows. Partner with engineering and research.',
      employer: 'Example Labs',
      location: 'London, United Kingdom',
      requirements: ['Experience shipping workflow software.'],
      responsibilities: ['Lead product design for desktop workflows.'],
      title: 'Senior Product Designer',
    },
  })
})

test('returns the no-job-content tagged union from fixture output', async () => {
  const worker = createVacancyNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: JSON.stringify({
        kind: 'no_job_content',
      }),
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({
    kind: 'no_job_content',
  })
})

test('returns an AI-requested vacancy page reading interaction from fixture output', async () => {
  const worker = createVacancyNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: JSON.stringify({
        interaction: {
          kind: 'click',
          selector: '[data-testid="show-more-description"]',
        },
        kind: 'interaction_requested',
        normalizedVacancy: null,
      }),
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({
    interaction: {
      kind: 'click',
      selector: '[data-testid="show-more-description"]',
    },
    kind: 'interaction_requested',
  })
})

test('maps Codex no-job-content output with null normalized vacancy to the internal tagged union', async () => {
  const worker = createVacancyNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: JSON.stringify({
        kind: 'no_job_content',
        normalizedVacancy: null,
      }),
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({
    kind: 'no_job_content',
  })
})

test('writes a root object schema for Codex vacancy normalization', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-vacancy-normalization-worker-schema-'),
  )

  temporaryDirectories.push(runDirectoryPath)

  let observedSchema: unknown

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new MockEventTarget() as MockEventTarget & {
      stderr: MockEventTarget
      stdout: MockEventTarget
    }

    child.stderr = new MockEventTarget()
    child.stdout = new MockEventTarget()

    const schemaFilePath = args[args.indexOf('--output-schema') + 1]
    const outputFilePath = args[args.indexOf('--output-last-message') + 1]

    if (schemaFilePath === undefined || outputFilePath === undefined) {
      throw new Error('Expected Codex CLI schema and output file path arguments.')
    }

    void readFile(schemaFilePath, 'utf8').then(
      async (schemaText) => {
        observedSchema = JSON.parse(schemaText) as unknown
        await writeFile(outputFilePath, JSON.stringify({ kind: 'no_job_content' }), 'utf8')
        child.emit('close', 0)
      },
      (error: unknown) => {
        child.emit('error', error)
      },
    )

    return child
  })

  const worker = createVacancyNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath,
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({
    kind: 'no_job_content',
  })

  expect(isRecord(observedSchema)).toBe(true)

  if (!isRecord(observedSchema)) {
    throw new Error('Expected the written schema to be an object.')
  }

  expect(observedSchema.type).toBe('object')
  expect(Object.hasOwn(observedSchema, 'oneOf')).toBe(false)
  expect(isRecord(observedSchema.properties)).toBe(true)
})

test('kills the Codex CLI subprocess when vacancy normalization is aborted', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-vacancy-normalization-worker-abort-'),
  )

  temporaryDirectories.push(runDirectoryPath)

  const childProcesses: (MockEventTarget & {
    kill: ReturnType<typeof vi.fn>
    stderr: MockEventTarget
    stdout: MockEventTarget
  })[] = []

  spawnMock.mockImplementation(() => {
    const child = new MockEventTarget() as MockEventTarget & {
      kill: ReturnType<typeof vi.fn>
      stderr: MockEventTarget
      stdout: MockEventTarget
    }

    child.kill = vi.fn(() => {
      child.emit('close', null)
    })
    child.stderr = new MockEventTarget()
    child.stdout = new MockEventTarget()
    childProcesses.push(child)

    return child
  })

  const worker = createVacancyNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  })
  const abortController = new AbortController()
  const runPromise = worker.runNormalization({
    runDirectoryPath,
    signal: abortController.signal,
  })

  await vi.waitFor(() => {
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

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

  abortController.abort()

  await expect(runPromise).rejects.toThrow('Vacancy normalization cancelled.')
  expect(childProcesses).toHaveLength(1)
  expect(childProcesses[0]?.kill).toHaveBeenCalledWith('SIGTERM')
})
