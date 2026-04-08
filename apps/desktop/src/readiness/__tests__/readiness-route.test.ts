import { expect, test } from 'vitest'

import { createReadinessRouteViewModel } from '../readiness-route.js'

test('startup renders the AI worker readiness gate before workspace access', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: false,
        message: 'Checking local worker setup.',
        provider: 'codex',
        status: 'checking',
      }),
  })

  expect(viewModel).toEqual({
    body: 'Checking the local AI worker before opening your workspace.',
    canEnterWorkspace: false,
    heading: 'AI worker setup',
    retryLabel: undefined,
    status: 'checking',
  })
})

test('startup keeps workspace access blocked when the AI worker is unavailable', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: false,
        failureCode: 'runtime_missing',
        message: 'Codex CLI was not found.',
        provider: 'codex',
        status: 'unavailable',
      }),
  })

  expect(viewModel).toEqual({
    body: 'The local AI worker is unavailable. Check setup, then retry.',
    canEnterWorkspace: false,
    heading: 'AI worker setup',
    retryLabel: 'Retry',
    status: 'unavailable',
  })
})

test('startup can continue after the AI worker is ready', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: true,
        message: 'Ready.',
        provider: 'codex',
        status: 'ready',
      }),
  })

  expect(viewModel).toEqual({
    body: 'The local AI worker is ready.',
    canEnterWorkspace: true,
    heading: 'AI worker setup',
    retryLabel: undefined,
    status: 'ready',
  })
})
