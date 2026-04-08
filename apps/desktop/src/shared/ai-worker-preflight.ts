export type AiWorkerProvider = 'codex'

export type AiWorkerFailureCode = 'healthcheck_failed' | 'launch_failed' | 'runtime_missing'

export type AiWorkerPreflightResult =
  | {
      canResumeGeneration: false
      message: string
      provider: AiWorkerProvider
      status: 'checking'
    }
  | {
      canResumeGeneration: true
      message: string
      provider: AiWorkerProvider
      status: 'ready'
    }
  | {
      canResumeGeneration: false
      failureCode: AiWorkerFailureCode
      message: string
      provider: AiWorkerProvider
      status: 'unavailable'
    }

export interface AiWorkerPreflightProvider {
  getAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>
}
