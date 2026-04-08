import { expect, test } from 'vitest'

import { createReadinessRouteViewModel } from '../readiness-route.js'

test('startup keeps the AI worker readiness gate blocked while the preflight is still checking', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: false,
        message: 'Checking local worker setup.',
        provider: 'codex',
        status: 'checking',
      }),
    getStartupDestination: () => Promise.resolve('first_launch'),
  })

  expect(viewModel).toEqual({
    body: 'Checking the local AI worker before opening your workspace.',
    canEnterWorkspace: false,
    diagnostic: 'Looking for the configured local worker, authentication state, and health probe.',
    heading: 'AI worker setup',
    primaryActionLabel: undefined,
    secondaryActionLabel: undefined,
    startupDestination: undefined,
    status: 'checking',
  })
})

test('startup renders sign-in-required guidance with provider-neutral copy and Codex-specific diagnostics', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: false,
        failureCode: 'auth_expired',
        message:
          'The local AI worker sign-in has expired. Sign in again before CV Maxxing can continue.',
        provider: 'codex',
        status: 'sign_in_required',
      }),
    getStartupDestination: () => Promise.resolve('workspace_empty'),
  })

  expect(viewModel).toEqual({
    body: 'The local AI worker sign-in has expired. Sign in again before CV Maxxing can continue.',
    canEnterWorkspace: false,
    diagnostic: 'Codex CLI session expired.',
    heading: 'AI worker setup',
    primaryActionLabel: 'Continue sign-in',
    secondaryActionLabel: 'Open setup guide',
    startupDestination: undefined,
    status: 'sign_in_required',
  })
})

test('startup restores the saved workspace destination after readiness succeeds', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    getStartupDestination: () => Promise.resolve('workspace_active'),
  })

  expect(viewModel).toEqual({
    body: 'The local AI worker is ready. Restoring your last tailored application.',
    canEnterWorkspace: true,
    diagnostic: 'Startup route restored: workspace_active.',
    heading: 'Workspace restored',
    primaryActionLabel: undefined,
    secondaryActionLabel: undefined,
    startupDestination: 'workspace_active',
    status: 'ready',
  })
})

test('timeout failures render retry-first local repair guidance', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: false,
        failureCode: 'healthcheck_failed',
        message:
          'The local AI worker health check timed out. Repair the local setup, then retry the check.',
        provider: 'codex',
        status: 'unavailable',
      }),
    getStartupDestination: () => Promise.resolve('first_launch'),
  })

  expect(viewModel).toEqual({
    body: 'The local AI worker health check timed out. Repair the local setup, then retry the check.',
    canEnterWorkspace: false,
    diagnostic: 'Codex CLI health check timed out.',
    heading: 'AI worker setup',
    primaryActionLabel: 'Retry check',
    secondaryActionLabel: 'Open setup guide',
    startupDestination: undefined,
    status: 'unavailable',
  })
})
