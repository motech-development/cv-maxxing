import type { AiWorkerPreflightResult } from './ai-worker-preflight.js'
import type {
  OriginalCvImportInput,
  OriginalCvImportResult,
  OriginalCvWorkspaceState,
} from './original-cv.js'
import type {
  CompletePendingGenerationInput,
  PendingGenerationCommand,
  StartPendingGenerationInput,
} from './pending-generation.js'
import type { StartupDestination } from './startup-destination.js'
import type {
  PastedVacancyInput,
  VacancyIngestResult,
  VacancyUrlInput,
  VacancyWorkspaceState,
} from './vacancy.js'

export interface CvMaxxingWindowApi {
  aiWorker: {
    getAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>
    getStartupDestination: () => Promise<StartupDestination>
    openAiWorkerSetupGuide: () => Promise<void>
    retryAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>
    startAiWorkerSignIn: () => Promise<AiWorkerPreflightResult>
  }
  originalCv: {
    getOriginalCvWorkspaceState: () => Promise<OriginalCvWorkspaceState>
    importOriginalCv: (input: OriginalCvImportInput) => Promise<OriginalCvImportResult>
  }
  tailoredApplication: {
    abandonPendingGeneration: () => Promise<void>
    completePendingGeneration: (
      commandId: CompletePendingGenerationInput['commandId'],
    ) => Promise<void>
    getPendingGenerationCommand: () => Promise<PendingGenerationCommand | null>
    startPendingGeneration: (input: StartPendingGenerationInput) => Promise<AiWorkerPreflightResult>
  }
  vacancy: {
    getVacancyWorkspaceState: () => Promise<VacancyWorkspaceState>
    ingestPastedVacancy: (input: PastedVacancyInput) => Promise<VacancyIngestResult>
    ingestVacancyUrl: (input: VacancyUrlInput) => Promise<VacancyIngestResult>
    openVacancyBrowserSession: (input: VacancyUrlInput) => Promise<void>
  }
}
