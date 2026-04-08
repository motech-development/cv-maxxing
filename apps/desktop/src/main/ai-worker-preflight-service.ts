import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'

export interface AiWorkerPreflightEnvironment {
  CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS?: string
}

export function getAiWorkerPreflight(
  environment: AiWorkerPreflightEnvironment = process.env,
): Promise<AiWorkerPreflightResult> {
  const status = environment.CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS ?? 'checking'

  if (status === 'ready') {
    return Promise.resolve({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
  }

  if (status === 'unavailable') {
    return Promise.resolve({
      canResumeGeneration: false,
      failureCode: 'runtime_missing',
      message: 'The local AI worker is unavailable. Check setup, then retry.',
      provider: 'codex',
      status: 'unavailable',
    })
  }

  return Promise.resolve({
    canResumeGeneration: false,
    message: 'Checking the local AI worker before opening your workspace.',
    provider: 'codex',
    status: 'checking',
  })
}
