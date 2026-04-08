import { expect, test, vi } from 'vitest'

import { AI_WORKER_IPC_CHANNELS } from '../../shared/ipc.js'
import { createDesktopApi } from '../create-desktop-api.js'

test('preload exposes the AI worker onboarding queries and commands over typed IPC', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
    .mockResolvedValueOnce({
      canResumeGeneration: false,
      failureCode: 'runtime_missing',
      message: 'The local AI worker is unavailable. Check setup, then retry.',
      provider: 'codex',
      status: 'unavailable',
    })
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
    .mockResolvedValueOnce('workspace_active')
    .mockImplementationOnce(() => Promise.resolve())

  const desktopApi = createDesktopApi({
    invoke,
  })

  await expect(desktopApi.aiWorker.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
  await expect(desktopApi.aiWorker.retryAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: false,
    failureCode: 'runtime_missing',
    message: 'The local AI worker is unavailable. Check setup, then retry.',
    provider: 'codex',
    status: 'unavailable',
  })
  await expect(desktopApi.aiWorker.startAiWorkerSignIn()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
  await expect(desktopApi.aiWorker.getStartupDestination()).resolves.toBe('workspace_active')
  await expect(desktopApi.aiWorker.openAiWorkerSetupGuide()).resolves.toBeUndefined()

  expect(invoke).toHaveBeenNthCalledWith(1, AI_WORKER_IPC_CHANNELS.getPreflight)
  expect(invoke).toHaveBeenNthCalledWith(2, AI_WORKER_IPC_CHANNELS.retryPreflight)
  expect(invoke).toHaveBeenNthCalledWith(3, AI_WORKER_IPC_CHANNELS.startSignIn)
  expect(invoke).toHaveBeenNthCalledWith(4, AI_WORKER_IPC_CHANNELS.getStartupDestination)
  expect(invoke).toHaveBeenNthCalledWith(5, AI_WORKER_IPC_CHANNELS.openSetupGuide)
})
