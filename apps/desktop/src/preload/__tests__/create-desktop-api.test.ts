import { expect, test, vi } from 'vitest'

import { AI_WORKER_IPC_CHANNELS } from '../../shared/ipc.js'
import { createDesktopApi } from '../create-desktop-api.js'

test('preload exposes an AI worker preflight query over the typed IPC channel', async () => {
  const invoke = vi.fn().mockResolvedValue({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })

  const desktopApi = createDesktopApi({
    invoke,
  })

  await expect(desktopApi.aiWorker.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })

  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.getPreflight)
})
