import { expect, test, vi } from 'vitest'

import { AI_WORKER_IPC_CHANNELS } from '../../shared/ipc.js'
import { exposeDesktopApi } from '../preload.js'

test('preload exposes the desktop API in the renderer global', async () => {
  const exposeInMainWorld = vi.fn()
  const invoke = vi.fn().mockResolvedValue({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })

  const desktopApi = exposeDesktopApi({
    contextBridge: {
      exposeInMainWorld,
    },
    ipcRenderer: {
      invoke,
    },
  })

  await expect(desktopApi.aiWorker.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })

  expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
  expect(exposeInMainWorld).toHaveBeenCalledWith('cvMaxxing', desktopApi)
  expect(invoke).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.getPreflight)
})
