import type { AiWorkerIpcChannel } from '../shared/ipc.js'
import { AI_WORKER_IPC_CHANNELS } from '../shared/ipc.js'
import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type { StartupDestination } from '../shared/startup-destination.js'
import type { CvMaxxingWindowApi } from '../shared/window-api.js'

export interface DesktopApiInvoker {
  invoke: <TResult>(channel: AiWorkerIpcChannel) => Promise<TResult>
}

export function createDesktopApi({ invoke }: DesktopApiInvoker): CvMaxxingWindowApi {
  return {
    aiWorker: {
      getAiWorkerPreflight: async (): Promise<AiWorkerPreflightResult> => {
        return await invoke(AI_WORKER_IPC_CHANNELS.getPreflight)
      },
      getStartupDestination: async (): Promise<StartupDestination> => {
        return await invoke(AI_WORKER_IPC_CHANNELS.getStartupDestination)
      },
      openAiWorkerSetupGuide: async (): Promise<void> => {
        await invoke<undefined>(AI_WORKER_IPC_CHANNELS.openSetupGuide)
      },
      retryAiWorkerPreflight: async (): Promise<AiWorkerPreflightResult> => {
        return await invoke(AI_WORKER_IPC_CHANNELS.retryPreflight)
      },
      startAiWorkerSignIn: async (): Promise<AiWorkerPreflightResult> => {
        return await invoke(AI_WORKER_IPC_CHANNELS.startSignIn)
      },
    },
  }
}
