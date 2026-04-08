import { contextBridge, ipcRenderer } from 'electron'

import { createDesktopApi } from './create-desktop-api.js'
import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type { CvMaxxingWindowApi } from '../shared/window-api.js'

export interface ContextBridgeLike {
  exposeInMainWorld: (key: string, value: CvMaxxingWindowApi) => void
}

export interface IpcRendererLike {
  invoke: (channel: string) => Promise<AiWorkerPreflightResult>
}

export interface PreloadDependencies {
  contextBridge: ContextBridgeLike
  ipcRenderer: IpcRendererLike
}

export function exposeDesktopApi({
  contextBridge,
  ipcRenderer,
}: PreloadDependencies): CvMaxxingWindowApi {
  const cvMaxxingApi = createDesktopApi({
    invoke: async (channel) => {
      return await ipcRenderer.invoke(channel)
    },
  })

  contextBridge.exposeInMainWorld('cvMaxxing', cvMaxxingApi)

  return cvMaxxingApi
}

if (process.env.VITEST !== 'true') {
  exposeDesktopApi({
    contextBridge,
    ipcRenderer,
  })
}
