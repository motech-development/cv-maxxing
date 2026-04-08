import type { AiWorkerPreflightResult } from './ai-worker-preflight.js'

export interface CvMaxxingWindowApi {
  aiWorker: {
    getAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>
  }
}
