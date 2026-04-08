import { expect, test, vi } from 'vitest'

import { AI_WORKER_IPC_CHANNELS, type DesktopIpcChannel } from '../../shared/ipc.js'
import { exposeDesktopApi } from '../preload.js'
import type { IpcRendererLike } from '../preload.js'

test('preload exposes the desktop API in the renderer global', async () => {
  const exposeInMainWorld = vi.fn()
  const invokeMock = vi.fn((channel: DesktopIpcChannel) => {
    if (channel === AI_WORKER_IPC_CHANNELS.getStartupDestination) {
      return Promise.resolve('workspace_empty')
    }

    return Promise.resolve({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
  })
  const invoke: IpcRendererLike['invoke'] = (channel) => {
    return invokeMock(channel) as never
  }

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
  await expect(desktopApi.aiWorker.retryAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
  await expect(desktopApi.aiWorker.startAiWorkerSignIn()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
  await expect(desktopApi.aiWorker.getStartupDestination()).resolves.toBe('workspace_empty')
  await expect(desktopApi.aiWorker.openAiWorkerSetupGuide()).resolves.toBeUndefined()

  expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
  expect(exposeInMainWorld).toHaveBeenCalledWith('cvMaxxing', desktopApi)
  expect(invokeMock).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.getPreflight)
  expect(invokeMock).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.retryPreflight)
  expect(invokeMock).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.startSignIn)
  expect(invokeMock).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.getStartupDestination)
  expect(invokeMock).toHaveBeenCalledWith(AI_WORKER_IPC_CHANNELS.openSetupGuide)
})
