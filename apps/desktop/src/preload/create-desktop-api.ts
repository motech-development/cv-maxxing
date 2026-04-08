import type { DesktopIpcChannel } from '../shared/ipc.js'
import { AI_WORKER_IPC_CHANNELS, ORIGINAL_CV_IPC_CHANNELS } from '../shared/ipc.js'
import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type {
  OriginalCvImportInput,
  OriginalCvImportResult,
  OriginalCvWorkspaceState,
} from '../shared/original-cv.js'
import type { StartupDestination } from '../shared/startup-destination.js'
import type { CvMaxxingWindowApi } from '../shared/window-api.js'

type DesktopApiInvoke = <TResult>(channel: DesktopIpcChannel, payload?: unknown) => Promise<TResult>

export interface DesktopApiInvoker {
  invoke: DesktopApiInvoke
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
    originalCv: {
      getOriginalCvWorkspaceState: async (): Promise<OriginalCvWorkspaceState> => {
        return await invoke(ORIGINAL_CV_IPC_CHANNELS.getWorkspaceState)
      },
      importOriginalCv: async (input: OriginalCvImportInput): Promise<OriginalCvImportResult> => {
        return await invoke(ORIGINAL_CV_IPC_CHANNELS.importOriginalCv, input)
      },
    },
  }
}
