export interface PreflightInput {
  readonly baselineRepoCommandsAvailable: boolean
  readonly ciPollingAvailable: boolean
  readonly cleanWorkingTree: boolean
  readonly codeRabbitAvailable: boolean
  readonly codexAvailable: boolean
  readonly dockerAvailable: boolean
  readonly githubReadWriteAvailable: boolean
  readonly gitPushAvailable: boolean
  readonly mainUpdateAvailable: boolean
  readonly nodeAvailable: boolean
  readonly pnpmAvailable: boolean
  readonly sandcastleAvailable: boolean
}

export interface PreflightCheck {
  readonly name: string
  readonly passed: boolean
}

export interface PreflightResult {
  readonly blockers: readonly string[]
  readonly checks: readonly PreflightCheck[]
  readonly ready: boolean
}

export interface RunLock {
  readonly heartbeatEpochMs: number
  readonly phase: string
  readonly pid: number
  readonly prdIssueNumber: number
  readonly runId: string
}

export interface RemoteAutomationPr {
  readonly branchName: string
  readonly isDraft: boolean
  readonly prNumber: number
  readonly prdIssueNumber: number
  readonly url: string
}

export interface RemoteAutomationPrOwnership {
  readonly blockers: readonly string[]
  readonly remoteAutomationPrs: readonly RemoteAutomationPr[]
}

export type RunLockAction = 'acquire' | 'block' | 'recover-stale-lock' | 'resume-remote'

export interface EvaluateRunLockInput {
  readonly existingLock: RunLock | undefined
  readonly nowEpochMs: number
  readonly processIdsAlive: readonly number[]
  readonly remoteAutomationPr: RemoteAutomationPr | undefined
}

export interface RunLockDecision {
  readonly action: RunLockAction
  readonly blockers: readonly string[]
  readonly recoverableStaleLock: boolean
  readonly recoveryNote?: string
}

export interface RunStatus {
  readonly activePrdIssueNumber: number | undefined
  readonly blockers: readonly string[]
  readonly branchName: string | undefined
  readonly ciStatus: string | undefined
  readonly codeRabbitStatus: string | undefined
  readonly completedChildren: readonly number[]
  readonly currentChildIssueNumber: number | undefined
  readonly heartbeatIso: string | undefined
  readonly lastCommand: string | undefined
  readonly phase: string
  readonly prNumber: number | undefined
  readonly prUrl: string | undefined
}

export type CleanupArtifactCategory =
  | 'committed-config'
  | 'container'
  | 'run-log'
  | 'sandbox-branch'
  | 'sandcastle-artifact'

export interface CleanupArtifact {
  readonly category: CleanupArtifactCategory
  readonly lastModifiedEpochMs: number
  readonly path: string
  readonly pid?: number
  readonly runId?: string
}

export interface EvaluateCleanupPlanInput {
  readonly activeRunIds: readonly string[]
  readonly artifacts: readonly CleanupArtifact[]
  readonly liveProcessIds?: readonly number[]
  readonly nowEpochMs: number
  readonly retentionDays: number
}

export interface CleanupPlan {
  readonly preserve: readonly string[]
  readonly remove: readonly string[]
}

const runStateRoot = '.git/prd-orchestrator/runs'
const repoRunLockPath = '.git/prd-orchestrator/lock.json'
const staleLockHeartbeatMs = 15 * 60 * 1000

export const createRepoRunLockPath = (): string => repoRunLockPath

export const createRunStatePath = (runId: string): string => `${runStateRoot}/${runId}`

export const evaluatePreflight = (input: PreflightInput): PreflightResult => {
  const checks = [
    {
      name: 'clean working tree',
      passed: input.cleanWorkingTree,
    },
    {
      name: 'main can be updated',
      passed: input.mainUpdateAvailable,
    },
    {
      name: 'GitHub read/write capability',
      passed: input.githubReadWriteAvailable,
    },
    {
      name: 'git push capability',
      passed: input.gitPushAvailable,
    },
    {
      name: 'Docker availability',
      passed: input.dockerAvailable,
    },
    {
      name: 'Sandcastle availability',
      passed: input.sandcastleAvailable,
    },
    {
      name: 'CodeRabbit availability',
      passed: input.codeRabbitAvailable,
    },
    {
      name: 'Codex availability',
      passed: input.codexAvailable,
    },
    {
      name: 'CI polling capability',
      passed: input.ciPollingAvailable,
    },
    {
      name: 'Node availability',
      passed: input.nodeAvailable,
    },
    {
      name: 'pnpm availability',
      passed: input.pnpmAvailable,
    },
    {
      name: 'baseline repo commands availability',
      passed: input.baselineRepoCommandsAvailable,
    },
  ] as const satisfies readonly PreflightCheck[]
  const blockers = checks.filter((check) => !check.passed).map((check) => check.name)

  return {
    blockers,
    checks,
    ready: blockers.length === 0,
  }
}

export const evaluateRunLock = (input: EvaluateRunLockInput): RunLockDecision => {
  if (input.existingLock !== undefined) {
    return evaluateLocalLock({
      existingLock: input.existingLock,
      nowEpochMs: input.nowEpochMs,
      processIdsAlive: input.processIdsAlive,
    })
  }

  if (input.remoteAutomationPr !== undefined) {
    return {
      action: 'resume-remote',
      blockers: [],
      recoverableStaleLock: false,
    }
  }

  return {
    action: 'acquire',
    blockers: [],
    recoverableStaleLock: false,
  }
}

export const formatRunStatus = (status: RunStatus): string =>
  [
    'PRD Orchestrator Status',
    `Active PRD: ${formatOptionalIssueReference(status.activePrdIssueNumber)}`,
    `PR: ${formatOptionalIssueReference(status.prNumber)}`,
    `Branch: ${status.branchName ?? 'none'}`,
    `Phase: ${status.phase}`,
    `Current child: ${formatOptionalIssueReference(status.currentChildIssueNumber)}`,
    `Completed children: ${formatIssueList(status.completedChildren)}`,
    `Blockers: ${formatTextList(status.blockers)}`,
    `Heartbeat: ${status.heartbeatIso ?? 'none'}`,
    `Last command: ${status.lastCommand ?? 'none'}`,
    `CodeRabbit: ${status.codeRabbitStatus ?? 'unknown'}`,
    `CI: ${status.ciStatus ?? 'unknown'}`,
    `PR link: ${status.prUrl ?? 'none'}`,
  ].join('\n')

export const evaluateCleanupPlan = (input: EvaluateCleanupPlanInput): CleanupPlan => {
  const activeRunIds = new Set(input.activeRunIds)
  const liveProcessIds =
    input.liveProcessIds === undefined ? new Set<number>() : new Set(input.liveProcessIds)
  const retentionMs = input.retentionDays * 24 * 60 * 60 * 1000

  return input.artifacts.reduce<CleanupPlan>(
    (plan, artifact) => {
      if (
        shouldRemoveArtifact({
          activeRunIds,
          artifact,
          liveProcessIds,
          nowEpochMs: input.nowEpochMs,
          retentionMs,
        })
      ) {
        return {
          preserve: plan.preserve,
          remove: [...plan.remove, artifact.path],
        }
      }

      return {
        preserve: [...plan.preserve, artifact.path],
        remove: plan.remove,
      }
    },
    {
      preserve: [],
      remove: [],
    },
  )
}

const evaluateLocalLock = (input: {
  readonly existingLock: RunLock
  readonly nowEpochMs: number
  readonly processIdsAlive: readonly number[]
}): RunLockDecision => {
  const { existingLock } = input

  if (input.processIdsAlive.includes(existingLock.pid)) {
    return {
      action: 'block',
      blockers: [
        `Local run ${existingLock.runId} for PRD ${formatIssueReference(
          existingLock.prdIssueNumber,
        )} is active on process ${String(existingLock.pid)}`,
      ],
      recoverableStaleLock: false,
    }
  }

  if (input.nowEpochMs - existingLock.heartbeatEpochMs >= staleLockHeartbeatMs) {
    return {
      action: 'recover-stale-lock',
      blockers: [],
      recoverableStaleLock: true,
      recoveryNote:
        'Recover completed task state from GitHub and branch history, not from the stale lock.',
    }
  }

  return {
    action: 'block',
    blockers: [`Local run ${existingLock.runId} has no live process but is not stale yet`],
    recoverableStaleLock: false,
  }
}

const shouldRemoveArtifact = (input: {
  readonly activeRunIds: ReadonlySet<string>
  readonly artifact: CleanupArtifact
  readonly liveProcessIds: ReadonlySet<number>
  readonly nowEpochMs: number
  readonly retentionMs: number
}): boolean => {
  if (input.artifact.category === 'committed-config') {
    return false
  }

  if (input.artifact.runId !== undefined && input.activeRunIds.has(input.artifact.runId)) {
    return false
  }

  if (input.artifact.pid !== undefined && input.liveProcessIds.has(input.artifact.pid)) {
    return false
  }

  return input.nowEpochMs - input.artifact.lastModifiedEpochMs >= input.retentionMs
}

const formatOptionalIssueReference = (issueNumber: number | undefined): string =>
  issueNumber === undefined ? 'none' : formatIssueReference(issueNumber)

const formatIssueList = (issueNumbers: readonly number[]): string =>
  issueNumbers.length === 0
    ? 'none'
    : issueNumbers.map((issueNumber) => formatIssueReference(issueNumber)).join(', ')

const formatIssueReference = (issueNumber: number): string => `#${String(issueNumber)}`

const formatTextList = (items: readonly string[]): string =>
  items.length === 0 ? 'none' : items.join('; ')
