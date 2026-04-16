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

test('probes the configured Codex CLI when no test override status is present', async () => {
  const service = createAiWorkerPreflightService({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'custom-codex',
    },
    getPendingGenerationCommand: vi.fn().mockResolvedValue(null),
    getPersistedCheckingTimeout: vi.fn().mockResolvedValue(null),
    getPersistedStartupDestination: vi.fn().mockResolvedValue('first_launch'),
    runCommand: vi.fn().mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: 'Logged in using ChatGPT',
    }),
  })

  await expect(service.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
})

test('maps a CLI login-status auth failure to sign-in-required guidance', async () => {
  const service = createAiWorkerPreflightService({
    environment: {},
    getPendingGenerationCommand: vi.fn().mockResolvedValue(null),
    getPersistedCheckingTimeout: vi.fn().mockResolvedValue(null),
    getPersistedStartupDestination: vi.fn().mockResolvedValue('first_launch'),
    runCommand: vi.fn().mockResolvedValue({
      exitCode: 1,
      stderr: '',
      stdout: 'Not logged in',
    }),
  })

  await expect(service.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: false,
    failureCode: 'auth_missing',
    message: 'The local AI worker needs a valid sign-in before CV Maxxing can continue.',
    provider: 'codex',
    status: 'sign_in_required',
  })
})

test('maps an expired CLI session to the expired-auth guidance', async () => {
  const service = createAiWorkerPreflightService({
    environment: {},
    getPendingGenerationCommand: vi.fn().mockResolvedValue(null),
    getPersistedCheckingTimeout: vi.fn().mockResolvedValue(null),
    getPersistedStartupDestination: vi.fn().mockResolvedValue('first_launch'),
    runCommand: vi.fn().mockResolvedValue({
      exitCode: 1,
      stderr: '',
      stdout: 'Session expired. Sign in again.',
    }),
  })

  await expect(service.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: false,
    failureCode: 'auth_expired',
    message:
      'The local AI worker sign-in has expired. Sign in again before CV Maxxing can continue.',
    provider: 'codex',
    status: 'sign_in_required',
  })
})

test('returns sign-in-required guidance and keeps resumability when a pending generation is blocked on auth', async () => {
  const service = createAiWorkerPreflightService({
    environment: {
      CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'auth_missing',
    },
    getPendingGenerationCommand: vi.fn().mockResolvedValue({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: 'Senior product designer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
    getPersistedCheckingTimeout: vi.fn().mockResolvedValue(null),
    getPersistedStartupDestination: vi.fn().mockResolvedValue('workspace'),
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

test('restores the workspace destination when a pending generation is ready to resume', async () => {
  const service = createAiWorkerPreflightService({
    environment: {
      CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    },
    getPendingGenerationCommand: vi.fn().mockResolvedValue({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: 'Senior engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
    getPersistedCheckingTimeout: vi.fn().mockResolvedValue(null),
    getPersistedStartupDestination: vi.fn().mockResolvedValue('workspace'),
    probeAiWorker: vi.fn().mockResolvedValue('ready'),
  })

  await expect(service.getStartupDestination()).resolves.toBe('workspace')
})
