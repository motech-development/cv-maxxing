import { mkdtemp, rm } from 'node:fs/promises'
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

import { createOriginalCvNormalizationWorker } from '../original-cv-normalization-worker.js'

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

test('reports invalid fixture JSON with clear context for original CV normalization', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: '{"invalid"',
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT produced invalid JSON/u)
})

test('rejects fixture output that does not match the normalization contract', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: JSON.stringify({
        normalizedCv: {
          experience: [],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 12,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
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
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: JSON.stringify({
        normalizedCv: {
          experience: ['Principal Product Designer | Analytical Engines Ltd'],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Product strategy', 'UX research', 'Prototyping'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 12,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
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
    normalizedCv: {
      experience: ['Principal Product Designer | Analytical Engines Ltd'],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Product strategy', 'UX research', 'Prototyping'],
      summary: 'Design leader focused on complex workflow products for technical users.',
    },
    writingStyle: {
      averageSentenceLength: 12,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'formal',
    },
  })
})

test('kills the Codex CLI subprocess when normalization is aborted', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-original-cv-normalization-worker-abort-'),
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

  const worker = createOriginalCvNormalizationWorker({
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

  abortController.abort()

  await expect(runPromise).rejects.toThrow('Original CV normalization cancelled.')
  expect(childProcesses).toHaveLength(1)
  expect(childProcesses[0]?.kill).toHaveBeenCalledWith('SIGTERM')
})
