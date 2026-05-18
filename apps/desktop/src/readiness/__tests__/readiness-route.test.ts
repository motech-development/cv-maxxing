import { expect, test } from 'vitest';
import { createReadinessRouteViewModel } from '../readiness-route.js';

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
  });

  expect(viewModel).toEqual({
    body: 'Getting AI ready before you enter the app.',
    canEnterWorkspace: false,
    diagnostic: 'Checking your AI connection on this Mac.',
    heading: 'Connect AI',
    primaryActionLabel: undefined,
    secondaryActionLabel: undefined,
    startupDestination: undefined,
    status: 'checking',
  });
});

test('startup renders sign-in-required guidance with provider-neutral copy and diagnostics', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: false,
        failureCode: 'auth_expired',
        message: 'Your AI sign-in has expired. Sign in again before CV Maxxing can continue.',
        provider: 'codex',
        status: 'sign_in_required',
      }),
    getStartupDestination: () => Promise.resolve('workspace'),
  });

  expect(viewModel).toEqual({
    body: 'Your AI sign-in has expired. Sign in again before CV Maxxing can continue.',
    canEnterWorkspace: false,
    diagnostic: 'Your sign-in expired on this Mac.',
    heading: 'Connect AI',
    primaryActionLabel: 'Continue',
    secondaryActionLabel: 'Get help',
    startupDestination: undefined,
    status: 'sign_in_required',
  });
});

test('startup restores the saved workspace destination after readiness succeeds', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    getStartupDestination: () => Promise.resolve('workspace'),
  });

  expect(viewModel).toEqual({
    body: 'AI is ready. Opening your jobs.',
    canEnterWorkspace: true,
    diagnostic: undefined,
    heading: 'Ready',
    primaryActionLabel: undefined,
    secondaryActionLabel: undefined,
    startupDestination: 'workspace',
    status: 'ready',
  });
});

test('timeout failures render retry-first local repair guidance', async () => {
  const viewModel = await createReadinessRouteViewModel({
    getAiWorkerPreflight: () =>
      Promise.resolve({
        canResumeGeneration: false,
        failureCode: 'healthcheck_failed',
        message: 'AI took too long to respond. Check the setup on this Mac, then try again.',
        provider: 'codex',
        status: 'unavailable',
      }),
    getStartupDestination: () => Promise.resolve('first_launch'),
  });

  expect(viewModel).toEqual({
    body: 'AI took too long to respond. Check the setup on this Mac, then try again.',
    canEnterWorkspace: false,
    diagnostic: "AI didn't respond in time.",
    heading: 'Connect AI',
    primaryActionLabel: 'Try again',
    secondaryActionLabel: 'Get help',
    startupDestination: undefined,
    status: 'unavailable',
  });
});
