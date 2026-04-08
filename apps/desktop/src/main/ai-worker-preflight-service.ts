import type { AiWorkerFailureCode, AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type { StartupDestination } from '../shared/startup-destination.js'

export interface AiWorkerPreflightEnvironment {
  CHECKING_TIMEOUT_MS?: string
  CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS?: string
  CV_MAXXING_AI_WORKER_RETRY_STATUS?: string
  CV_MAXXING_AI_WORKER_SIGN_IN_STATUS?: string
}

export interface PendingGenerationCommand {
  commandId: string
  originalCvId: string
  vacancyText: string
}

export type AiWorkerProbeOutcome =
  | 'auth_expired'
  | 'auth_missing'
  | 'hang'
  | 'launch_failed'
  | 'ready'
  | 'runtime_missing'

export interface AiWorkerProbeInput {
  reason: 'retry' | 'sign_in' | 'startup'
  timeoutMs: number
}

export interface AiWorkerPreflightService {
  getAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>
  getStartupDestination: () => Promise<StartupDestination>
  openAiWorkerSetupGuide: () => Promise<void>
  retryAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>
  startAiWorkerSignIn: () => Promise<AiWorkerPreflightResult>
}

interface CreateAiWorkerPreflightServiceOptions {
  environment?: AiWorkerPreflightEnvironment
  getPendingGenerationCommand?: () => Promise<PendingGenerationCommand | null>
  getPersistedCheckingTimeout?: () => Promise<number | null>
  getPersistedStartupDestination?: () => Promise<StartupDestination | null>
  openAiWorkerSetupGuide?: () => Promise<void>
  probeAiWorker?: (input: AiWorkerProbeInput) => Promise<AiWorkerProbeOutcome>
}

const DEFAULT_CHECKING_TIMEOUT_MS = 12_000
const resolveNullPendingGenerationCommand = (): Promise<PendingGenerationCommand | null> => {
  return Promise.resolve(null)
}
const resolveNullCheckingTimeout = (): Promise<number | null> => {
  return Promise.resolve(null)
}
const resolveNullStartupDestination = (): Promise<StartupDestination | null> => {
  return Promise.resolve(null)
}
const resolveVoid = (): Promise<void> => {
  return Promise.resolve()
}

export function createAiWorkerPreflightService({
  environment = process.env,
  getPendingGenerationCommand = resolveNullPendingGenerationCommand,
  getPersistedCheckingTimeout = resolveNullCheckingTimeout,
  getPersistedStartupDestination = resolveNullStartupDestination,
  openAiWorkerSetupGuide = resolveVoid,
  probeAiWorker = createEnvironmentBackedProbe(environment),
}: CreateAiWorkerPreflightServiceOptions = {}): AiWorkerPreflightService {
  async function runPreflight(
    reason: AiWorkerProbeInput['reason'],
  ): Promise<AiWorkerPreflightResult> {
    const [pendingGenerationCommand, persistedCheckingTimeout] = await Promise.all([
      getPendingGenerationCommand(),
      getPersistedCheckingTimeout(),
    ])
    const timeoutMs = resolveCheckingTimeoutMs({
      environment,
      persistedCheckingTimeout,
    })
    const probeOutcome = await resolveProbeOutcome({
      probe: () => {
        return probeAiWorker({
          reason,
          timeoutMs,
        })
      },
      timeoutMs,
    })

    return mapProbeOutcomeToPreflightResult({
      pendingGenerationCommand,
      probeOutcome,
    })
  }

  return {
    getAiWorkerPreflight: () => {
      return runPreflight('startup')
    },
    getStartupDestination: async () => {
      const pendingGenerationCommand = await getPendingGenerationCommand()

      if (pendingGenerationCommand !== null) {
        return 'workspace_loading'
      }

      const persistedStartupDestination = await getPersistedStartupDestination()

      return persistedStartupDestination ?? 'first_launch'
    },
    openAiWorkerSetupGuide: () => {
      return openAiWorkerSetupGuide()
    },
    retryAiWorkerPreflight: () => {
      return runPreflight('retry')
    },
    startAiWorkerSignIn: () => {
      return runPreflight('sign_in')
    },
  }
}

export function getAiWorkerPreflight(
  environment: AiWorkerPreflightEnvironment = process.env,
): Promise<AiWorkerPreflightResult> {
  return createAiWorkerPreflightService({
    environment,
  }).getAiWorkerPreflight()
}

export function resolveCheckingTimeoutMs({
  environment,
  persistedCheckingTimeout,
}: {
  environment: AiWorkerPreflightEnvironment
  persistedCheckingTimeout: number | null
}): number {
  const runtimeCheckingTimeout = parseCheckingTimeout(environment.CHECKING_TIMEOUT_MS)

  if (runtimeCheckingTimeout !== null) {
    return runtimeCheckingTimeout
  }

  const storedCheckingTimeout = parseCheckingTimeout(persistedCheckingTimeout)

  if (storedCheckingTimeout !== null) {
    return storedCheckingTimeout
  }

  return DEFAULT_CHECKING_TIMEOUT_MS
}

function createEnvironmentBackedProbe(
  environment: AiWorkerPreflightEnvironment,
): (input: AiWorkerProbeInput) => Promise<AiWorkerProbeOutcome> {
  return async ({ reason }) => {
    const status = readProbeStatus({
      environment,
      reason,
    })

    if (status === 'hang') {
      return await new Promise<AiWorkerProbeOutcome>((resolve) => {
        void resolve
      })
    }

    return status
  }
}

function readProbeStatus({
  environment,
  reason,
}: {
  environment: AiWorkerPreflightEnvironment
  reason: AiWorkerProbeInput['reason']
}): AiWorkerProbeOutcome {
  if (reason === 'sign_in') {
    return normalizeProbeStatus(
      environment.CV_MAXXING_AI_WORKER_SIGN_IN_STATUS ??
        environment.CV_MAXXING_AI_WORKER_RETRY_STATUS ??
        environment.CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS,
    )
  }

  if (reason === 'retry') {
    return normalizeProbeStatus(
      environment.CV_MAXXING_AI_WORKER_RETRY_STATUS ??
        environment.CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS,
    )
  }

  return normalizeProbeStatus(environment.CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS)
}

function normalizeProbeStatus(status: string | undefined): AiWorkerProbeOutcome {
  switch (status) {
    case 'auth_expired':
    case 'auth_missing':
    case 'hang':
    case 'launch_failed':
    case 'ready':
    case 'runtime_missing': {
      return status
    }
    default: {
      return 'runtime_missing'
    }
  }
}

async function resolveProbeOutcome({
  probe,
  timeoutMs,
}: {
  probe: () => Promise<AiWorkerProbeOutcome>
  timeoutMs: number
}): Promise<AiWorkerFailureCode | Exclude<AiWorkerProbeOutcome, 'hang'>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<AiWorkerFailureCode>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve('healthcheck_failed')
    }, timeoutMs)
  })

  const probePromise = probe().then((probeOutcome) => {
    if (probeOutcome === 'hang') {
      return new Promise<AiWorkerFailureCode>((resolve) => {
        void resolve
      })
    }

    return probeOutcome
  })

  try {
    return await Promise.race([probePromise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

function mapProbeOutcomeToPreflightResult({
  pendingGenerationCommand,
  probeOutcome,
}: {
  pendingGenerationCommand: PendingGenerationCommand | null
  probeOutcome: AiWorkerFailureCode | Exclude<AiWorkerProbeOutcome, 'hang'>
}): AiWorkerPreflightResult {
  if (probeOutcome === 'ready') {
    return {
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    }
  }

  if (probeOutcome === 'auth_missing') {
    return {
      canResumeGeneration: pendingGenerationCommand !== null,
      failureCode: 'auth_missing',
      message:
        pendingGenerationCommand === null
          ? 'The local AI worker needs a valid sign-in before CV Maxxing can continue.'
          : 'The local AI worker needs a valid sign-in before CV Maxxing can resume your tailored application.',
      provider: 'codex',
      status: 'sign_in_required',
    }
  }

  if (probeOutcome === 'auth_expired') {
    return {
      canResumeGeneration: pendingGenerationCommand !== null,
      failureCode: 'auth_expired',
      message:
        pendingGenerationCommand === null
          ? 'The local AI worker sign-in has expired. Sign in again before CV Maxxing can continue.'
          : 'The local AI worker sign-in has expired. Sign in again before CV Maxxing can resume your tailored application.',
      provider: 'codex',
      status: 'sign_in_required',
    }
  }

  if (probeOutcome === 'healthcheck_failed') {
    return {
      canResumeGeneration: false,
      failureCode: 'healthcheck_failed',
      message:
        'The local AI worker health check timed out. Repair the local setup, then retry the check.',
      provider: 'codex',
      status: 'unavailable',
    }
  }

  if (probeOutcome === 'launch_failed') {
    return {
      canResumeGeneration: false,
      failureCode: 'launch_failed',
      message:
        'The local AI worker could not be launched. Repair the local setup, then retry the check.',
      provider: 'codex',
      status: 'unavailable',
    }
  }

  return {
    canResumeGeneration: false,
    failureCode: 'runtime_missing',
    message: 'The local AI worker is unavailable. Check setup, then retry.',
    provider: 'codex',
    status: 'unavailable',
  }
}

function parseCheckingTimeout(value: number | string | undefined | null): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  const parsedValue = Number.parseInt(value, 10)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null
  }

  return parsedValue
}
