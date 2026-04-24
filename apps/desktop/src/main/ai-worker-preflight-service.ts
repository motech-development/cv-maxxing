import { spawn } from 'node:child_process'

import type { AiWorkerFailureCode, AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type { PendingGenerationCommand } from '../shared/pending-generation.js'
import type { StartupDestination } from '../shared/startup-destination.js'

export interface AiWorkerPreflightEnvironment {
  CHECKING_TIMEOUT_MS?: string
  CV_MAXXING_AI_WORKER_CODEX_COMMAND?: string
  CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS?: string
  CV_MAXXING_AI_WORKER_RETRY_STATUS?: string
  CV_MAXXING_AI_WORKER_SIGN_IN_STATUS?: string
  CV_MAXXING_TEST_OPEN_AI_SETUP_GUIDE_ERROR?: string
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

interface CommandExecutionResult {
  exitCode: number
  stderr: string
  stdout: string
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
  runCommand?: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<CommandExecutionResult>
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
  runCommand = executeCommand,
  probeAiWorker = createProbeAiWorker({
    environment,
    runCommand,
  }),
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
        return 'workspace'
      }

      const persistedStartupDestination = await getPersistedStartupDestination()

      return persistedStartupDestination ?? 'first_launch'
    },
    openAiWorkerSetupGuide: () => {
      const setupGuideErrorMessage = environment.CV_MAXXING_TEST_OPEN_AI_SETUP_GUIDE_ERROR

      if (setupGuideErrorMessage !== undefined && setupGuideErrorMessage.trim() !== '') {
        return Promise.reject(new Error(setupGuideErrorMessage))
      }

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

function createProbeAiWorker({
  environment,
  runCommand,
}: {
  environment: AiWorkerPreflightEnvironment
  runCommand: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<CommandExecutionResult>
}): (input: AiWorkerProbeInput) => Promise<AiWorkerProbeOutcome> {
  return async ({ reason, timeoutMs }) => {
    const statusOverride = readProbeStatusOverride({
      environment,
      reason,
    })

    if (statusOverride !== undefined) {
      const status = normalizeProbeStatus(statusOverride)

      if (status === 'hang') {
        return await new Promise<AiWorkerProbeOutcome>((resolve) => {
          void resolve
        })
      }

      return status
    }

    return await probeCodexCli({
      command: environment.CV_MAXXING_AI_WORKER_CODEX_COMMAND ?? 'codex',
      runCommand,
      timeoutMs,
    })
  }
}

function readProbeStatusOverride({
  environment,
  reason,
}: {
  environment: AiWorkerPreflightEnvironment
  reason: AiWorkerProbeInput['reason']
}): string | undefined {
  if (reason === 'sign_in') {
    return (
      environment.CV_MAXXING_AI_WORKER_SIGN_IN_STATUS ??
      environment.CV_MAXXING_AI_WORKER_RETRY_STATUS ??
      environment.CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS
    )
  }

  if (reason === 'retry') {
    return (
      environment.CV_MAXXING_AI_WORKER_RETRY_STATUS ??
      environment.CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS
    )
  }

  return environment.CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS
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

async function probeCodexCli({
  command,
  runCommand,
  timeoutMs,
}: {
  command: string
  runCommand: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<CommandExecutionResult>
  timeoutMs: number
}): Promise<AiWorkerProbeOutcome> {
  try {
    const loginStatus = await runCommand(command, ['login', 'status'], timeoutMs)

    if (loginStatus.exitCode === 0) {
      return 'ready'
    }

    const diagnosticText = `${loginStatus.stdout}\n${loginStatus.stderr}`.toLowerCase()

    if (diagnosticText.includes('expired')) {
      return 'auth_expired'
    }

    if (
      diagnosticText.includes('not logged in') ||
      diagnosticText.includes('login required') ||
      diagnosticText.includes('sign in')
    ) {
      return 'auth_missing'
    }

    return 'launch_failed'
  } catch (error) {
    if (isCommandMissingError(error)) {
      return 'runtime_missing'
    }

    if (isCommandTimeoutError(error)) {
      return 'hang'
    }

    return 'launch_failed'
  }
}

async function executeCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandExecutionResult> {
  return await new Promise((resolve, reject) => {
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('Command timed out.'))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(chunk.toString())
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString())
    })
    child.on('error', (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeoutId)
      resolve({
        exitCode: code ?? 1,
        stderr: stderrChunks.join(''),
        stdout: stdoutChunks.join(''),
      })
    })
  })
}

function isCommandMissingError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isCommandTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.message === 'Command timed out.'
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
      message: 'AI is ready.',
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
          ? 'AI needs you to sign in before CV Maxxing can continue.'
          : 'AI needs you to sign in before CV Maxxing can finish your CV and cover letter.',
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
          ? 'Your AI sign-in has expired. Sign in again before CV Maxxing can continue.'
          : 'Your AI sign-in has expired. Sign in again before CV Maxxing can finish your CV and cover letter.',
      provider: 'codex',
      status: 'sign_in_required',
    }
  }

  if (probeOutcome === 'healthcheck_failed') {
    return {
      canResumeGeneration: false,
      failureCode: 'healthcheck_failed',
      message: 'AI took too long to respond. Check the setup on this Mac, then try again.',
      provider: 'codex',
      status: 'unavailable',
    }
  }

  if (probeOutcome === 'launch_failed') {
    return {
      canResumeGeneration: false,
      failureCode: 'launch_failed',
      message: "CV Maxxing couldn't start AI on this Mac. Check the setup, then try again.",
      provider: 'codex',
      status: 'unavailable',
    }
  }

  return {
    canResumeGeneration: false,
    failureCode: 'runtime_missing',
    message: "AI isn't available on this Mac yet. Check the setup, then try again.",
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
