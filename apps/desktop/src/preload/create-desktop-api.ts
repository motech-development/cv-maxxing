import type { DesktopIpcChannel } from '../shared/ipc.js'
import {
  AI_WORKER_IPC_CHANNELS,
  ORIGINAL_CV_IPC_CHANNELS,
  TAILORED_APPLICATION_IPC_CHANNELS,
  VACANCY_IPC_CHANNELS,
} from '../shared/ipc.js'
import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type {
  OriginalCvImportInput,
  OriginalCvImportResult,
  OriginalCvWorkspaceState,
} from '../shared/original-cv.js'
import type {
  PendingGenerationCommand,
  ResumePendingGenerationResult,
  StartPendingGenerationInput,
} from '../shared/pending-generation.js'
import type { StartupDestination } from '../shared/startup-destination.js'
import type {
  TailoredApplicationExportResult,
  TailoredApplicationPreview,
  TailoredApplicationWorkspaceState,
} from '../shared/tailored-application.js'
import type {
  PastedVacancyInput,
  VacancyIngestResult,
  VacancyUrlInput,
  VacancyWorkspaceState,
} from '../shared/vacancy.js'
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
    tailoredApplication: {
      abandonPendingGeneration: async (): Promise<void> => {
        await invoke<undefined>(TAILORED_APPLICATION_IPC_CHANNELS.abandonPendingGeneration)
      },
      completePendingGeneration: async (commandId: string): Promise<void> => {
        await invoke<undefined>(TAILORED_APPLICATION_IPC_CHANNELS.completePendingGeneration, {
          commandId,
        })
      },
      deleteTailoredApplication: async (tailoredApplicationId: string): Promise<void> => {
        await invoke<undefined>(TAILORED_APPLICATION_IPC_CHANNELS.delete, {
          tailoredApplicationId,
        })
      },
      getPendingGenerationCommand: async (): Promise<PendingGenerationCommand | null> => {
        return await invoke(TAILORED_APPLICATION_IPC_CHANNELS.getPendingGeneration)
      },
      getTailoredApplicationPreview: async (
        tailoredApplicationId: string,
      ): Promise<TailoredApplicationPreview | null> => {
        return await invoke(TAILORED_APPLICATION_IPC_CHANNELS.getPreview, {
          tailoredApplicationId,
        })
      },
      getWorkspaceState: async (): Promise<TailoredApplicationWorkspaceState> => {
        return await invoke(TAILORED_APPLICATION_IPC_CHANNELS.getWorkspaceState)
      },
      resumePendingGeneration: async (): Promise<ResumePendingGenerationResult> => {
        return await invoke(TAILORED_APPLICATION_IPC_CHANNELS.resumePendingGeneration)
      },
      startPendingGeneration: async (
        input: StartPendingGenerationInput,
      ): Promise<AiWorkerPreflightResult> => {
        return await invoke(TAILORED_APPLICATION_IPC_CHANNELS.startPendingGeneration, input)
      },
      exportAdaptedCvPdf: async (
        tailoredApplicationId: string,
      ): Promise<TailoredApplicationExportResult | null> => {
        return await invoke(TAILORED_APPLICATION_IPC_CHANNELS.exportAdaptedCvPdf, {
          tailoredApplicationId,
        })
      },
      exportCoverLetterPdf: async (
        tailoredApplicationId: string,
      ): Promise<TailoredApplicationExportResult | null> => {
        return await invoke(TAILORED_APPLICATION_IPC_CHANNELS.exportCoverLetterPdf, {
          tailoredApplicationId,
        })
      },
    },
    vacancy: {
      clearVacancyWorkspaceState: async (): Promise<void> => {
        await invoke<undefined>(VACANCY_IPC_CHANNELS.clearWorkspaceState)
      },
      getVacancyWorkspaceState: async (): Promise<VacancyWorkspaceState> => {
        return await invoke(VACANCY_IPC_CHANNELS.getWorkspaceState)
      },
      ingestPastedVacancy: async (input: PastedVacancyInput): Promise<VacancyIngestResult> => {
        return await invoke(VACANCY_IPC_CHANNELS.ingestPasted, input)
      },
      ingestVacancyUrl: async (input: VacancyUrlInput): Promise<VacancyIngestResult> => {
        return await invoke(VACANCY_IPC_CHANNELS.ingestUrl, input)
      },
      openVacancyBrowserSession: async (input: VacancyUrlInput): Promise<VacancyIngestResult> => {
        return await invoke(VACANCY_IPC_CHANNELS.openBrowserSession, input)
      },
    },
  }
}
