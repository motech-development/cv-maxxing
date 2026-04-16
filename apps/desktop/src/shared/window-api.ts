import type { AiWorkerPreflightResult } from './ai-worker-preflight.js'
import type {
  OriginalCvImportInput,
  OriginalCvImportResult,
  OriginalCvWorkspaceState,
} from './original-cv.js'
import type {
  CompletePendingGenerationInput,
  CompletePendingGenerationResult,
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
import type { WorkspaceSelection } from './workspace-selection.js'
import type {
  PastedVacancyInput,
  VacancyIngestResult,
  VacancyUrlInput,
  VacancyWorkspaceState,
} from './vacancy.js'
import type { ResetLocalAppDataInput, SettingsSnapshot } from './settings.js'

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
  settings: {
    clearJobSiteBrowserData: () => Promise<void>
    getSettingsSnapshot: () => Promise<SettingsSnapshot>
    resetLocalAppData: (input: ResetLocalAppDataInput) => Promise<void>
  }
  tailoredApplication: {
    abandonPendingGeneration: () => Promise<void>
    completePendingGeneration: (
      commandId: CompletePendingGenerationInput['commandId'],
    ) => Promise<CompletePendingGenerationResult>
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
    setWorkspaceSelection: (selection: WorkspaceSelection) => Promise<void>
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
