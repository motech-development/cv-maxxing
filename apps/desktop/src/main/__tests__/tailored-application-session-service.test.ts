import { expect, test, vi } from 'vitest'

import { createTailoredApplicationSessionService } from '../tailored-application-session-service.js'

test('persists pending generation context before readiness repair begins', async () => {
  const savePendingGenerationCommand = vi.fn().mockImplementation(() => Promise.resolve())
  const setStartupDestination = vi.fn().mockImplementation(() => Promise.resolve())
  const retryAiWorkerPreflight = vi.fn().mockResolvedValue({
    canResumeGeneration: true,
    failureCode: 'auth_missing',
    message:
      'The local AI worker needs a valid sign-in before CV Maxxing can resume your tailored application.',
    provider: 'codex',
    status: 'sign_in_required',
  })
  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight,
    },
    generateId: () => {
      return 'command-123'
    },
    readinessStore: {
      clearPendingGenerationCommand: vi.fn().mockImplementation(() => Promise.resolve()),
      getPendingGenerationCommand: vi.fn().mockResolvedValue(null),
      savePendingGenerationCommand,
      setStartupDestination,
    },
  })

  await expect(
    service.startPendingGeneration({
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
  ).resolves.toEqual({
    canResumeGeneration: true,
    failureCode: 'auth_missing',
    message:
      'The local AI worker needs a valid sign-in before CV Maxxing can resume your tailored application.',
    provider: 'codex',
    status: 'sign_in_required',
  })

  expect(savePendingGenerationCommand).toHaveBeenCalledWith({
    commandId: 'command-123',
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior platform engineer',
      url: 'https://jobs.example.com/roles/123',
    },
  })
  const saveCallOrder = savePendingGenerationCommand.mock.invocationCallOrder[0]
  const retryCallOrder = retryAiWorkerPreflight.mock.invocationCallOrder[0]

  expect(saveCallOrder).toBeDefined()
  expect(retryCallOrder).toBeDefined()
  expect(saveCallOrder ?? 0).toBeLessThan(retryCallOrder ?? 0)
  expect(setStartupDestination).toHaveBeenCalledWith('workspace_loading')
})

test('clears pending generation state and routes to workspace active when resumed generation completes', async () => {
  const clearPendingGenerationCommand = vi.fn().mockImplementation(() => Promise.resolve())
  const setStartupDestination = vi.fn().mockImplementation(() => Promise.resolve())
  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn(),
    },
    readinessStore: {
      clearPendingGenerationCommand,
      getPendingGenerationCommand: vi.fn().mockResolvedValue({
        commandId: 'command-123',
        originalCvId: 'original-cv-123',
        originalCvLabel: 'ada-lovelace.pdf',
        vacancyDraft: {
          text: 'Senior platform engineer',
          url: 'https://jobs.example.com/roles/123',
        },
      }),
      savePendingGenerationCommand: vi.fn(),
      setStartupDestination,
    },
  })

  await expect(service.completePendingGeneration('command-123')).resolves.toBeUndefined()

  expect(clearPendingGenerationCommand).toHaveBeenCalledTimes(1)
  expect(setStartupDestination).toHaveBeenCalledWith('workspace_active')
})

test('clears pending generation state and routes back to workspace empty when the resumed flow is abandoned', async () => {
  const clearPendingGenerationCommand = vi.fn().mockImplementation(() => Promise.resolve())
  const setStartupDestination = vi.fn().mockImplementation(() => Promise.resolve())
  const service = createTailoredApplicationSessionService({
    aiWorker: {
      retryAiWorkerPreflight: vi.fn(),
    },
    readinessStore: {
      clearPendingGenerationCommand,
      getPendingGenerationCommand: vi.fn().mockResolvedValue({
        commandId: 'command-123',
        originalCvId: 'original-cv-123',
        originalCvLabel: 'ada-lovelace.pdf',
        vacancyDraft: {
          text: 'Senior platform engineer',
          url: 'https://jobs.example.com/roles/123',
        },
      }),
      savePendingGenerationCommand: vi.fn(),
      setStartupDestination,
    },
  })

  await expect(service.abandonPendingGeneration()).resolves.toBeUndefined()

  expect(clearPendingGenerationCommand).toHaveBeenCalledTimes(1)
  expect(setStartupDestination).toHaveBeenCalledWith('workspace_empty')
})
