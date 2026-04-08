import { afterEach, expect, test, vi } from 'vitest'

import {
  createAiWorkerPreflightService,
  resolveCheckingTimeoutMs,
} from '../ai-worker-preflight-service.js'

afterEach(() => {
  vi.useRealTimers()
})

test('prefers the runtime checking timeout over persisted config values', () => {
  expect(
    resolveCheckingTimeoutMs({
      environment: {
        CHECKING_TIMEOUT_MS: '2500',
      },
      persistedCheckingTimeout: 80 * 100,
    }),
  ).toBe(25 * 100)
})

test('falls back to persisted checking timeout and then the 12000 ms default', () => {
  expect(
    resolveCheckingTimeoutMs({
      environment: {},
      persistedCheckingTimeout: 50 * 100,
    }),
  ).toBe(50 * 100)
  expect(
    resolveCheckingTimeoutMs({
      environment: {},
      persistedCheckingTimeout: null,
    }),
  ).toBe(12 * 1000)
})

test('returns sign-in-required guidance and keeps resumability when a pending generation is blocked on auth', async () => {
  const service = createAiWorkerPreflightService({
    environment: {
      CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'auth_missing',
    },
    getPendingGenerationCommand: vi.fn().mockResolvedValue({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      vacancyText: 'Senior product designer',
    }),
    getPersistedCheckingTimeout: vi.fn().mockResolvedValue(null),
    getPersistedStartupDestination: vi.fn().mockResolvedValue('workspace_empty'),
    probeAiWorker: vi.fn().mockResolvedValue('auth_missing'),
  })

  await expect(service.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    failureCode: 'auth_missing',
    message:
      'The local AI worker needs a valid sign-in before CV Maxxing can resume your tailored application.',
    provider: 'codex',
    status: 'sign_in_required',
  })
})

test('maps a hanging health probe to an unavailable timeout failure using the resolved timeout', async () => {
  vi.useFakeTimers()

  const probeAiWorker = vi.fn(() => {
    return new Promise<'ready'>((resolve) => {
      void resolve
    })
  })
  const service = createAiWorkerPreflightService({
    environment: {
      CHECKING_TIMEOUT_MS: '25',
    },
    getPendingGenerationCommand: vi.fn().mockResolvedValue(null),
    getPersistedCheckingTimeout: vi.fn().mockResolvedValue(40 * 100),
    getPersistedStartupDestination: vi.fn().mockResolvedValue('first_launch'),
    probeAiWorker,
  })

  const preflightPromise = service.getAiWorkerPreflight()

  await vi.advanceTimersByTimeAsync(25)

  await expect(preflightPromise).resolves.toEqual({
    canResumeGeneration: false,
    failureCode: 'healthcheck_failed',
    message:
      'The local AI worker health check timed out. Repair the local setup, then retry the check.',
    provider: 'codex',
    status: 'unavailable',
  })
  expect(probeAiWorker).toHaveBeenCalledWith({
    reason: 'startup',
    timeoutMs: 25,
  })
})

test('restores workspace loading ahead of saved startup state when a pending generation is ready to resume', async () => {
  const service = createAiWorkerPreflightService({
    environment: {
      CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    },
    getPendingGenerationCommand: vi.fn().mockResolvedValue({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      vacancyText: 'Senior engineer',
    }),
    getPersistedCheckingTimeout: vi.fn().mockResolvedValue(null),
    getPersistedStartupDestination: vi.fn().mockResolvedValue('workspace_active'),
    probeAiWorker: vi.fn().mockResolvedValue('ready'),
  })

  await expect(service.getStartupDestination()).resolves.toBe('workspace_loading')
})
