import type {
  AiWorkerPreflightProvider,
  AiWorkerPreflightResult,
} from '../shared/ai-worker-preflight.js'
import type { StartupDestination } from '../shared/startup-destination.js'

export interface StartupDestinationProvider {
  getStartupDestination: () => Promise<StartupDestination>
}

export interface ReadinessRouteViewModel {
  body: string
  canEnterWorkspace: boolean
  diagnostic?: string
  heading: string
  primaryActionLabel?: string
  secondaryActionLabel?: string
  startupDestination?: StartupDestination
  status: AiWorkerPreflightResult['status']
}

export function mapReadinessRouteViewModel({
  preflight,
  startupDestination,
}: {
  preflight: AiWorkerPreflightResult
  startupDestination?: StartupDestination
}): ReadinessRouteViewModel {
  if (preflight.status === 'checking') {
    return {
      body: 'Checking AI before opening the app.',
      canEnterWorkspace: false,
      diagnostic:
        'Looking for the configured local worker, authentication state, and health probe.',
      heading: 'AI worker setup',
      primaryActionLabel: undefined,
      secondaryActionLabel: undefined,
      startupDestination: undefined,
      status: preflight.status,
    }
  }

  if (preflight.status === 'sign_in_required') {
    return {
      body: preflight.message,
      canEnterWorkspace: false,
      diagnostic: buildDiagnostic(preflight),
      heading: 'AI worker setup',
      primaryActionLabel: 'Continue sign-in',
      secondaryActionLabel: 'Open setup guide',
      startupDestination: undefined,
      status: preflight.status,
    }
  }

  if (preflight.status === 'unavailable') {
    return {
      body: preflight.message,
      canEnterWorkspace: false,
      diagnostic: buildDiagnostic(preflight),
      heading: 'AI worker setup',
      primaryActionLabel: 'Retry check',
      secondaryActionLabel: 'Open setup guide',
      startupDestination: undefined,
      status: preflight.status,
    }
  }

  const resolvedStartupDestination = startupDestination ?? 'first_launch'

  return {
    body: buildReadyBody(resolvedStartupDestination),
    canEnterWorkspace: true,
    diagnostic: `Startup route restored: ${resolvedStartupDestination}.`,
    heading: buildReadyHeading(resolvedStartupDestination),
    primaryActionLabel: undefined,
    secondaryActionLabel: undefined,
    startupDestination: resolvedStartupDestination,
    status: preflight.status,
  }
}

export async function createReadinessRouteViewModel({
  getAiWorkerPreflight,
  getStartupDestination,
}: AiWorkerPreflightProvider & StartupDestinationProvider): Promise<ReadinessRouteViewModel> {
  const preflight = await getAiWorkerPreflight()
  const startupDestination =
    preflight.status === 'ready' ? await getStartupDestination() : undefined

  return mapReadinessRouteViewModel({
    preflight,
    startupDestination,
  })
}

function buildDiagnostic(
  preflight: Extract<AiWorkerPreflightResult, { status: 'sign_in_required' | 'unavailable' }>,
): string {
  if (preflight.failureCode === 'auth_expired') {
    return 'Codex CLI session expired.'
  }

  if (preflight.failureCode === 'auth_missing') {
    return 'Codex CLI session missing.'
  }

  if (preflight.failureCode === 'healthcheck_failed') {
    return 'Codex CLI health check timed out.'
  }

  if (preflight.failureCode === 'launch_failed') {
    return 'Codex CLI failed to launch.'
  }

  return 'Codex CLI was not found on this machine.'
}

function buildReadyBody(startupDestination: StartupDestination): string {
  if (startupDestination === 'workspace') {
    return 'AI is ready. Opening your jobs.'
  }

  return 'AI is ready. Add your CV to get started.'
}

function buildReadyHeading(startupDestination: StartupDestination): string {
  if (startupDestination === 'first_launch') {
    return 'First launch'
  }

  return 'Workspace restored'
}
