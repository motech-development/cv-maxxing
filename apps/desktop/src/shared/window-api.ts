import type { AiWorkerPreflightResult } from './ai-worker-preflight.js'
import type {
  OriginalCvImportInput,
  OriginalCvImportResult,
  OriginalCvWorkspaceState,
} from './original-cv.js'
import type {
  CompletePendingGenerationInput,
  PendingGenerationCommand,
  ResumePendingGenerationResult,
  StartPendingGenerationInput,
} from './pending-generation.js'
import type { StartupDestination } from './startup-destination.js'
import type {
  TailoredApplicationExportResult,
  TailoredApplicationPreview,
  TailoredApplicationWorkspaceState,
} from './tailored-application.js'
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
    deleteTailoredApplication: (tailoredApplicationId: string) => Promise<void>
    exportAdaptedCvPdf: (
      tailoredApplicationId: string,
    ) => Promise<TailoredApplicationExportResult | null>
    exportCoverLetterPdf: (
      tailoredApplicationId: string,
    ) => Promise<TailoredApplicationExportResult | null>
    getPendingGenerationCommand: () => Promise<PendingGenerationCommand | null>
    getTailoredApplicationPreview: (
      tailoredApplicationId: string,
    ) => Promise<TailoredApplicationPreview | null>
    getWorkspaceState: () => Promise<TailoredApplicationWorkspaceState>
    resumePendingGeneration: () => Promise<ResumePendingGenerationResult>
    startPendingGeneration: (input: StartPendingGenerationInput) => Promise<AiWorkerPreflightResult>
  }
  vacancy: {
    clearVacancyWorkspaceState: () => Promise<void>
    getVacancyWorkspaceState: () => Promise<VacancyWorkspaceState>
    ingestPastedVacancy: (input: PastedVacancyInput) => Promise<VacancyIngestResult>
    ingestVacancyUrl: (input: VacancyUrlInput) => Promise<VacancyIngestResult>
    openVacancyBrowserSession: (input: VacancyUrlInput) => Promise<VacancyIngestResult>
  }
}
