import { AI_WORKER_IPC_CHANNELS } from '../shared/ipc.js'
import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type { CvMaxxingWindowApi } from '../shared/window-api.js'

export interface DesktopApiInvoker {
  invoke: (channel: string) => Promise<AiWorkerPreflightResult>
}

export function createDesktopApi({ invoke }: DesktopApiInvoker): CvMaxxingWindowApi {
  return {
    aiWorker: {
      getAiWorkerPreflight: async (): Promise<AiWorkerPreflightResult> => {
        return await invoke(AI_WORKER_IPC_CHANNELS.getPreflight)
      },
    },
  }
}
