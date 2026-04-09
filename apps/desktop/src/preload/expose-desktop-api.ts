import { createDesktopApi } from './create-desktop-api.js'
import type { DesktopIpcChannel } from '../shared/ipc.js'
import type { CvMaxxingWindowApi } from '../shared/window-api.js'

export interface ContextBridgeLike {
  exposeInMainWorld: (key: string, value: CvMaxxingWindowApi) => void
}

export interface IpcRendererLike {
  invoke: <TResult>(channel: DesktopIpcChannel, payload?: unknown) => Promise<TResult>
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
    invoke: async (channel, payload) => {
      return await ipcRenderer.invoke(channel, payload)
    },
  })

  contextBridge.exposeInMainWorld('cvMaxxing', cvMaxxingApi)

  return cvMaxxingApi
}
