import type { AiWorkerPreflightResult } from './ai-worker-preflight.js'
import type {
  OriginalCvImportInput,
  OriginalCvImportResult,
  OriginalCvWorkspaceState,
} from './original-cv.js'
import type { StartupDestination } from './startup-destination.js'

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
}
