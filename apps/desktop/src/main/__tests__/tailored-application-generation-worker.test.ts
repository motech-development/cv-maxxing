import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
