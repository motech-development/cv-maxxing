import { expect, test } from 'vitest'

import { getAiWorkerPreflight } from '../ai-worker-preflight-service.js'

test('returns checking by default', async () => {
  await expect(getAiWorkerPreflight({})).resolves.toEqual({
    canResumeGeneration: false,
    message: 'Checking the local AI worker before opening your workspace.',
    provider: 'codex',
    status: 'checking',
  })
})

test('returns ready when the environment enables the worker', async () => {
  await expect(
    getAiWorkerPreflight({
      CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    }),
  ).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
})

test('returns unavailable when the environment blocks the worker', async () => {
  await expect(
    getAiWorkerPreflight({
      CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'unavailable',
    }),
  ).resolves.toEqual({
    canResumeGeneration: false,
    failureCode: 'runtime_missing',
    message: 'The local AI worker is unavailable. Check setup, then retry.',
    provider: 'codex',
    status: 'unavailable',
  })
})
