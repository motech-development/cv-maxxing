import type {
  AiWorkerPreflightProvider,
  AiWorkerPreflightResult,
} from '../shared/ai-worker-preflight.js'

export interface ReadinessRouteViewModel {
  body: string
  canEnterWorkspace: boolean
  heading: string
  retryLabel?: string
  status: AiWorkerPreflightResult['status']
}

export async function createReadinessRouteViewModel({
  getAiWorkerPreflight,
}: AiWorkerPreflightProvider): Promise<ReadinessRouteViewModel> {
  const preflight = await getAiWorkerPreflight()

  if (preflight.status === 'unavailable') {
    return {
      body: 'The local AI worker is unavailable. Check setup, then retry.',
      canEnterWorkspace: false,
      heading: 'AI worker setup',
      retryLabel: 'Retry',
      status: preflight.status,
    }
  }

  if (preflight.status === 'ready') {
    return {
      body: 'The local AI worker is ready.',
      canEnterWorkspace: true,
      heading: 'AI worker setup',
      retryLabel: undefined,
      status: preflight.status,
    }
  }

  return {
    body: 'Checking the local AI worker before opening your workspace.',
    canEnterWorkspace: false,
    heading: 'AI worker setup',
    retryLabel: undefined,
    status: preflight.status,
  }
}
