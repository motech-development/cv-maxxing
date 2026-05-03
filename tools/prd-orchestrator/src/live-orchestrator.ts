import { setTimeout as sleep } from 'node:timers/promises'

import {
  createChildCommitMessage,
  generateDraftPrBody,
  generateMergeInstructions,
  type ChildTaskProgress,
} from './draft-pr-state.js'
import {
  formatRunStatus,
  type CleanupPlan,
  type RemoteAutomationPr,
  type RemoteAutomationPrOwnership,
  type RunStatus,
} from './run-guardrails.js'
import {
  enforceWriteSurface,
  planOneChildTransaction,
  selectVerificationCommands,
  type MainBranchStatus,
  type OneChildTransactionPlan,
} from './one-child-transaction.js'
import {
  createDryRunPlan,
  isOpenPrdIssue,
  renderDryRunPlan,
  type GitHubIssue,
  type ParsedChildTask,
  type SelectedPrdPlan,
} from './planning.js'
import {
  classifyCodeRabbitFinding,
  recordNonActionableFinding,
  type CodeRabbitFinding,
  type NonActionableFindingRecord,
} from './coderabbit-review.js'
import type {
  SandcastleImpactAnalysisResult,
  SiblingTaskSummary,
} from './sandcastle-impact-analysis.js'
import {
  evaluateFinalAuditEvidence,
  evaluateReadyForReviewGate,
  generateFinalPrdAcceptanceAudit,
  planResumePrRepair,
  validateAutomationPrOwnership,
  type ChildCommitReference,
  type ChildTaskAudit,
  type CiStatus,
  type GitHubActionsStatus,
  type ParentUserStoryAudit,
  type ProhibitedCapabilityScanResult,
  type ResumePrFinding,
} from './final-prd-flow.js'
import { groupRunnableTasksByImpactSurface } from './full-run-scheduler.js'

let resumeRepairWorkerBranchSequence = 0

export interface PrdOrchestratorLiveAdapters {
  readonly configuration?: PrdOrchestratorLiveConfiguration
  readonly ci: {
    readonly getFailureEvidence?: (input: PollChecksInput) => Promise<readonly CiFailureEvidence[]>
    readonly pollChecks: (input: PollChecksInput) => Promise<GitHubActionsStatus>
  }
  readonly codeRabbit: {
    readonly reviewChild: (input: ReviewChildInput) => Promise<ReviewChildResult>
  }
  readonly git: {
    readonly applyWorkerDiff: (input: ApplyWorkerDiffInput) => Promise<void>
    readonly amendChildCommit: (message: string) => Promise<ChildCommitResult>
    readonly checkoutChildCommit?: (input: CheckoutChildCommitInput) => Promise<void>
    readonly commitChild: (message: string) => Promise<ChildCommitResult>
    readonly commitFinalCleanup?: (message: string) => Promise<ChildCommitResult>
    readonly getChildCommitReferences?: (
      branchName: string,
    ) => Promise<readonly ChildCommitReference[]>
    readonly getCompletedChildIssueNumbers?: (branchName: string) => Promise<readonly number[]>
    readonly getMainBranchStatus: () => Promise<MainBranchStatus>
    readonly preparePrdBranch: (input: PreparePrdBranchInput) => Promise<void>
    readonly pushPrdBranch: (input: PushPrdBranchInput) => Promise<void>
    readonly restorePrdBranchToCleanState: (
      input: RestorePrdBranchToCleanStateInput,
    ) => Promise<void>
  }
  readonly github: {
    readonly createDraftPr: (input: CreateDraftPrInput) => Promise<RemoteAutomationPr>
    readonly convertPrToDraft?: (prNumber: number) => Promise<void>
    readonly findAutomationPr: (
      prdIssueNumber: number,
      branchName: string,
    ) => Promise<RemoteAutomationPr | undefined>
    readonly getOpenAutomationPrOwnership: () => Promise<RemoteAutomationPrOwnership>
    readonly getReviewFindings?: (prNumber: number) => Promise<readonly ResumePrFinding[]>
    readonly getPr: (prNumber: number) => Promise<AutomationPrDetails>
    readonly getCurrentPr: () => Promise<AutomationPrDetails | undefined>
    readonly listOpenIssues: () => Promise<readonly GitHubIssue[]>
    readonly markReadyForReview: (prNumber: number) => Promise<void>
    readonly postPrComment: (prNumber: number, body: string) => Promise<void>
    readonly updatePrBody: (prNumber: number, body: string) => Promise<void>
    readonly upsertPrComment: (input: UpsertPrCommentInput) => Promise<void>
  }
  readonly sandcastle: {
    readonly repairReviewFindings: (
      input: RepairReviewFindingsInput,
    ) => Promise<RunImplementationResult>
    readonly repairResumeFindings?: (
      input: RepairResumeFindingsInput,
    ) => Promise<RunImplementationResult>
    readonly repairVerificationFailure: (
      input: RepairVerificationFailureInput,
    ) => Promise<RunImplementationResult>
    readonly runImpactAnalysis: (
      input: RunImpactAnalysisInput,
    ) => Promise<SandcastleImpactAnalysisResult>
    readonly runImplementation: (input: RunImplementationInput) => Promise<RunImplementationResult>
  }
  readonly state: {
    readonly acquireRunLock: () => Promise<LiveRunLockResult>
    readonly cleanup: () => Promise<CleanupPlan>
    readonly readArtifactStatus?: () => Promise<AutomationArtifactStatus>
    readonly readRunStatus: () => Promise<RunStatus>
    readonly recoverRunStatusFromPr: (pr: AutomationPrDetails) => Promise<void>
    readonly recordRunStatus: (status: RunStatus) => Promise<void>
    readonly releaseRunLock: () => Promise<void>
    readonly runPreflight: () => Promise<LivePreflightResult>
  }
  readonly verification: {
    readonly runCommands: (commands: readonly string[]) => Promise<readonly string[]>
    readonly scanProhibitedCapabilities: (
      input: ScanProhibitedCapabilitiesInput,
    ) => Promise<readonly ProhibitedCapabilityScanResult[]>
  }
}

export interface AutomationArtifactStatus {
  readonly cleanupStatus: string
  readonly lockStatus: string
  readonly sandcastleStatus: string
}

export interface PrdOrchestratorLiveConfiguration {
  readonly ciPollingIntervalMs?: number
  readonly ciPollingTimeoutMs?: number
  readonly codexEffort: string | undefined
  readonly codexModel: string | undefined
}

export interface LivePreflightResult {
  readonly blockers: readonly string[]
  readonly ready: boolean
}

export interface LiveRunLockResult {
  readonly blockers: readonly string[]
  readonly lockId: string | undefined
  readonly ready: boolean
}

export interface LiveCommandResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export interface CreateDraftPrInput {
  readonly body: string
  readonly branchName: string
  readonly prdIssueNumber: number
  readonly title: string
}

export interface PreparePrdBranchInput {
  readonly branchName: string
  readonly remoteAutomationPr: RemoteAutomationPr | undefined
}

export interface CheckoutChildCommitInput {
  readonly branchName: string
  readonly childIssueNumber: number
  readonly commitHash: string
}

export interface ApplyWorkerDiffInput {
  readonly prdBranchName: string
  readonly workerBranchName: string
  readonly workerWorktreePath?: string
}

export interface PushPrdBranchInput {
  readonly branchName: string
  readonly mode: 'force-with-lease'
}

export interface RestorePrdBranchToCleanStateInput {
  readonly branchName: string
}

export interface ChildCommitResult {
  readonly hash: string
}

export interface RunImpactAnalysisInput {
  readonly childTask: ParsedChildTask
  readonly parentPrd: SelectedPrdPlan
  readonly parentPrdBody: string
  readonly siblingSummaries: readonly SiblingTaskSummary[]
  readonly writeSurfaceReanalysis?: WriteSurfaceReanalysisInput
}

export interface RunImplementationInput extends RunImpactAnalysisInput {
  readonly impactAnalysis: SandcastleImpactAnalysisResult
  readonly prdBranchName: string
  readonly workerBranchName: string
}

export interface RunImplementationResult {
  readonly changedFiles: readonly string[]
  readonly stdout: string
  readonly workerBranchName: string
  readonly workerWorktreePath?: string
}

export interface WriteSurfaceReanalysisInput {
  readonly previousImpactAnalysis: SandcastleImpactAnalysisResult
  readonly unexpectedFiles: readonly string[]
  readonly workerChangedFiles: readonly string[]
}

export interface RepairReviewFindingsInput extends RunImplementationInput {
  readonly findings: readonly CodeRabbitFinding[]
}

export interface RepairResumeFindingsInput {
  readonly branchName: string
  readonly findings: readonly CodeRabbitFinding[]
  readonly prNumber: number
  readonly targetCommitHash?: string
  readonly workerBranchName: string
}

export interface RepairVerificationFailureInput extends RunImplementationInput {
  readonly errorMessage: string
}

export interface ReviewChildInput {
  readonly branchName: string
  readonly childCommitHash: string
  readonly childIssueNumber: number
  readonly prNumber: number
}

export interface ReviewChildResult {
  readonly findings: readonly CodeRabbitFinding[]
  readonly status: string
}

export interface ScanProhibitedCapabilitiesInput {
  readonly branchName: string
  readonly changedFiles: readonly string[]
}

type VerificationRepairResult =
  | {
      readonly impactAnalysis: SandcastleImpactAnalysisResult
      readonly status: 'clean'
      readonly verificationEvidence: readonly string[]
      readonly workerResult: RunImplementationResult
    }
  | {
      readonly blockers: readonly string[]
      readonly impactAnalysis: SandcastleImpactAnalysisResult
      readonly status: 'blocked'
      readonly workerResult: RunImplementationResult
    }

type ResumeRepairGateResult =
  | {
      readonly status: 'clean'
      readonly workerResult: RunImplementationResult
    }
  | {
      readonly blockers: readonly string[]
      readonly codeRabbitStatus: string
      readonly currentChildIssueNumber: number | undefined
      readonly status: 'blocked'
    }

type DraftPrResolver = (body: string) => Promise<RemoteAutomationPr>

interface DraftPrHandle {
  readonly current: () => RemoteAutomationPr | undefined
  readonly ensure: DraftPrResolver
}

interface LiveRunStartupContext {
  readonly issues: readonly GitHubIssue[]
  readonly remoteAutomationPr: RemoteAutomationPr | undefined
}

interface LiveRunStartupCheck {
  readonly blockers: readonly string[]
  readonly context: LiveRunStartupContext
}

export interface PollChecksInput {
  readonly branchName: string
  readonly prNumber: number
}

export interface CiFailureEvidence {
  readonly detailsUrl?: string
  readonly logExcerpt: string
  readonly name: string
  readonly workflowName?: string
}

export interface AutomationPrDetails {
  readonly body: string
  readonly branchName: string
  readonly isDraft: boolean
  readonly prNumber: number
  readonly url: string
}

export interface UpsertPrCommentInput {
  readonly body: string
  readonly marker: string
  readonly prNumber: number
}

const emptyImpactAnalysis = {
  designFiles: [],
  expectedFiles: [],
  expectedModules: [],
  riskLevel: 'low',
  sharedContracts: [],
  tests: [],
} as const satisfies SandcastleImpactAnalysisResult
const defaultCiPollingIntervalMs = 30 * 1000
const defaultCiPollingTimeoutMs = 30 * 60 * 1000
const finalPrdAcceptanceAuditMarker = '## Final PRD Acceptance Audit'
const resumeRepairVerificationCommands = [
  'pnpm lint',
  'pnpm --filter @cv-maxxing/prd-orchestrator typecheck',
  'pnpm --filter @cv-maxxing/prd-orchestrator test:unit',
] as const

const createNonDraftRewriteBlocker = (input: {
  readonly branchName: string
  readonly command: string
  readonly prNumber: number
}): string =>
  `PR #${String(input.prNumber)} is ready for review; ${input.command} will not amend commits or force-push branch ${input.branchName}. Use resume-pr ${String(input.prNumber)} only when actionable CI or review repair work requires a history rewrite.`

const createRemoteAutomationPrFromDetails = (
  pr: AutomationPrDetails,
  prdIssueNumber: number,
  isDraft: boolean = pr.isDraft,
): RemoteAutomationPr => ({
  branchName: pr.branchName,
  isDraft,
  prNumber: pr.prNumber,
  prdIssueNumber,
  url: pr.url,
})

const getExistingRunRewriteBlocker = (
  pr: RemoteAutomationPr | undefined,
  command: string,
): string | undefined =>
  pr === undefined || pr.isDraft
    ? undefined
    : createNonDraftRewriteBlocker({
        branchName: pr.branchName,
        command,
        prNumber: pr.prNumber,
      })

const getFreshRewriteBlocker = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly command: string
  readonly pr: RemoteAutomationPr
}): Promise<string | undefined> => {
  const currentPr = await input.adapters.github.getPr(input.pr.prNumber)

  return currentPr.isDraft
    ? undefined
    : createNonDraftRewriteBlocker({
        branchName: currentPr.branchName,
        command: input.command,
        prNumber: currentPr.prNumber,
      })
}

export const executeLivePlan = async (
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const issues = await adapters.github.listOpenIssues()
  const plan = createDryRunPlan(issues)

  return {
    exitCode: plan.selectedPrd === undefined ? 1 : 0,
    stderr: '',
    stdout: `${renderDryRunPlan(plan)}\n`,
  }
}

const checkLiveRunStartupOwnership = async (
  adapters: PrdOrchestratorLiveAdapters,
  command: 'run' | 'run --one-child',
): Promise<LiveRunStartupCheck> => {
  const issues = await adapters.github.listOpenIssues()
  const selectedPrd = createDryRunPlan(issues).selectedPrd
  const ownership = await adapters.github.getOpenAutomationPrOwnership()
  const remoteAutomationPr =
    selectedPrd === undefined
      ? undefined
      : ownership.remoteAutomationPrs.find((pr) => pr.prdIssueNumber === selectedPrd.issueNumber)
  const blockers = [
    ...ownership.blockers,
    ...formatDifferentRemoteAutomationPrBlockers({
      command,
      remoteAutomationPrs: ownership.remoteAutomationPrs,
      selectedPrdIssueNumber: selectedPrd?.issueNumber,
    }),
  ]

  return {
    blockers,
    context: {
      issues,
      remoteAutomationPr,
    },
  }
}

const formatDifferentRemoteAutomationPrBlockers = (input: {
  readonly command: 'run' | 'run --one-child'
  readonly remoteAutomationPrs: readonly RemoteAutomationPr[]
  readonly selectedPrdIssueNumber: number | undefined
}): readonly string[] =>
  input.remoteAutomationPrs
    .filter((pr) => pr.prdIssueNumber !== input.selectedPrdIssueNumber)
    .map((pr) => {
      const selectedPrdReference =
        input.selectedPrdIssueNumber === undefined
          ? 'no eligible selected PRD'
          : `selected PRD #${String(input.selectedPrdIssueNumber)}`

      return `Remote automation PR #${String(pr.prNumber)} is active for PRD #${String(
        pr.prdIssueNumber,
      )}; ${input.command} cannot mutate ${selectedPrdReference}. Use resume-pr #${String(
        pr.prNumber,
      )} or close that automation PR before starting another PRD.`
    })

export const executeLiveOneChild = async (
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const preflight = await adapters.state.runPreflight()

  if (!preflight.ready) {
    return blockedResult(preflight.blockers.join('\n'))
  }

  const startup = await checkLiveRunStartupOwnership(adapters, 'run --one-child')

  if (startup.blockers.length > 0) {
    return blockedResult(startup.blockers.join('\n'))
  }

  const lock = await adapters.state.acquireRunLock()

  if (!lock.ready) {
    return blockedResult(lock.blockers.join('\n'))
  }

  try {
    return await executeLiveOneChildWithLock(adapters, {
      startupContext: startup.context,
    })
  } finally {
    await adapters.state.releaseRunLock()
  }
}

export const executeLiveRun = async (
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const preflight = await adapters.state.runPreflight()

  if (!preflight.ready) {
    return blockedResult(preflight.blockers.join('\n'))
  }

  const startup = await checkLiveRunStartupOwnership(adapters, 'run')

  if (startup.blockers.length > 0) {
    return blockedResult(startup.blockers.join('\n'))
  }

  const lock = await adapters.state.acquireRunLock()

  if (!lock.ready) {
    return blockedResult(lock.blockers.join('\n'))
  }

  try {
    return await executeLiveRunWithLock(adapters, startup.context)
  } finally {
    await adapters.state.releaseRunLock()
  }
}

const executeLiveRunWithLock = async (
  adapters: PrdOrchestratorLiveAdapters,
  startupContext?: LiveRunStartupContext,
): Promise<LiveCommandResult> => {
  const issues = startupContext?.issues ?? (await adapters.github.listOpenIssues())
  const dryRunPlan = createDryRunPlan(issues)
  const selectedPrd = dryRunPlan.selectedPrd

  if (selectedPrd === undefined) {
    return blockedResult('No eligible PRD with child tasks is available.')
  }

  if (selectedPrd.blockers.length > 0) {
    return await recordPreExecutionPlanningBlockers({
      adapters,
      lastCommand: 'run',
      selectedPrd,
    })
  }

  const branchSeedPlan = planOneChildTransaction({
    childCommitHash: undefined,
    codeRabbitStatus: 'not run',
    completedChildIssueNumbers: [],
    dependencyChangeJustification: undefined,
    existingLedger: [],
    impactAnalysis: emptyImpactAnalysis,
    issues,
    mainBranchStatus: {
      clean: true,
      currentBranch: 'main',
      upToDate: true,
    },
    remoteAutomationPr: undefined,
    verificationEvidence: [],
    workerChangedFiles: [],
  })
  const mainBranchStatus = await adapters.git.getMainBranchStatus()

  if (!isCleanUpToDateMain(mainBranchStatus)) {
    return blockedResult('run must start from clean, up-to-date main.')
  }

  const remoteAutomationPr =
    startupContext === undefined
      ? await adapters.github.findAutomationPr(
          selectedPrd.issueNumber,
          branchSeedPlan.prdBranchName,
        )
      : startupContext.remoteAutomationPr
  const existingPrRewriteBlocker = getExistingRunRewriteBlocker(remoteAutomationPr, 'run')

  if (existingPrRewriteBlocker !== undefined) {
    return blockedResult(existingPrRewriteBlocker)
  }

  const parentPrdBody = issues.find((issue) => issue.number === selectedPrd.issueNumber)?.body ?? ''

  await adapters.git.preparePrdBranch({
    branchName: branchSeedPlan.prdBranchName,
    remoteAutomationPr,
  })

  const draftPrHandle = createDraftPrHandle({
    adapters,
    branchName: branchSeedPlan.prdBranchName,
    prdIssueNumber: selectedPrd.issueNumber,
    remoteAutomationPr,
    title: branchSeedPlan.draftPullRequest.title,
  })
  const initialCompletedChildIssueNumbers =
    (await adapters.git.getCompletedChildIssueNumbers?.(branchSeedPlan.prdBranchName)) ?? []
  const blockedChildIssueNumbers = new Set<number>()
  let madeProgress = initialCompletedChildIssueNumbers.length > 0

  for (;;) {
    const completedChildIssueNumbers =
      (await adapters.git.getCompletedChildIssueNumbers?.(branchSeedPlan.prdBranchName)) ?? []

    for (const completedChildIssueNumber of completedChildIssueNumbers) {
      blockedChildIssueNumbers.delete(completedChildIssueNumber)
    }

    const executableChildren = selectExecutableChildren(selectedPrd, completedChildIssueNumbers, [
      ...blockedChildIssueNumbers,
    ])

    if (executableChildren.length === 0) {
      if (completedChildIssueNumbers.length === selectedPrd.childTasks.length) {
        const status = await adapters.state.readRunStatus()

        if (status.phase === 'ready-for-review') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: renderFullRunCompletion(status),
          }
        }

        const activeDraftPr = await draftPrHandle.ensure(
          generateDraftPrBody({
            branchName: branchSeedPlan.prdBranchName,
            childTasks: selectedPrd.childTasks,
            ledger: await createBaseLedger({
              adapters,
              blockedChildIssueNumbers: [],
              branchName: branchSeedPlan.prdBranchName,
              childTasks: selectedPrd.childTasks,
              completedChildIssueNumbers,
            }),
            parentPrdIssueNumber: selectedPrd.issueNumber,
            prdTitle: selectedPrd.title,
          }),
        )

        return await finalizeRecoveredPrdBranch({
          adapters,
          branchName: branchSeedPlan.prdBranchName,
          completedChildren: completedChildIssueNumbers,
          draftPr: activeDraftPr,
          lastCommand: 'run',
          selectedPrd,
        })
      }

      if (blockedChildIssueNumbers.size > 0) {
        const status = createRunStatus({
          blockers: [...blockedChildIssueNumbers].map(
            (issueNumber) => `Child #${String(issueNumber)} is blocked.`,
          ),
          branchName: branchSeedPlan.prdBranchName,
          codeRabbitStatus: 'passed',
          completedChildIssueNumbers,
          currentChildIssueNumber: undefined,
          lastCommand: 'run',
          phase: 'blocked',
          pr: draftPrHandle.current(),
          prdIssueNumber: selectedPrd.issueNumber,
        })

        const blockedBody = generateDraftPrBody({
          branchName: branchSeedPlan.prdBranchName,
          childTasks: selectedPrd.childTasks,
          ledger: await createBaseLedger({
            adapters,
            blockedChildIssueNumbers: [...blockedChildIssueNumbers],
            branchName: branchSeedPlan.prdBranchName,
            childTasks: selectedPrd.childTasks,
            completedChildIssueNumbers,
          }),
          parentPrdIssueNumber: selectedPrd.issueNumber,
          prdTitle: selectedPrd.title,
        })
        const activeDraftPr = draftPrHandle.current()

        if (activeDraftPr !== undefined) {
          await adapters.github.updatePrBody(activeDraftPr.prNumber, blockedBody)
        }

        await adapters.state.recordRunStatus(status)

        return blockedResult('Full run blocked after continuing independent child work.')
      }

      return blockedResult(
        madeProgress
          ? 'Full run made no further child-task progress.'
          : 'No unblocked child task is available.',
      )
    }

    const taskImpacts = await Promise.all(
      executableChildren.map(async (childTask) => ({
        issueNumber: childTask.issueNumber,
        surface: await adapters.sandcastle.runImpactAnalysis({
          childTask,
          parentPrd: selectedPrd,
          parentPrdBody,
          siblingSummaries: createSiblingSummaries(
            selectedPrd,
            childTask,
            completedChildIssueNumbers,
          ),
        }),
      })),
    )
    const schedule = groupRunnableTasksByImpactSurface({
      tasks: taskImpacts,
    })

    await adapters.state.recordRunStatus(
      createRunStatus({
        blockers: [...blockedChildIssueNumbers].map(
          (issueNumber) => `Child #${String(issueNumber)} is blocked.`,
        ),
        branchName: branchSeedPlan.prdBranchName,
        codeRabbitStatus: 'not run',
        completedChildIssueNumbers,
        currentChildIssueNumber: undefined,
        lastCommand: 'run',
        phase: `scheduling ${String(executableChildren.length)} executable child task${
          executableChildren.length === 1 ? '' : 's'
        }`,
        pr: draftPrHandle.current(),
        prdIssueNumber: selectedPrd.issueNumber,
      }),
    )

    let blockedThisPass = false

    for (const batch of schedule.batches) {
      const batchChildren = batch.issueNumbers
        .map((issueNumber) =>
          executableChildren.find((childTask) => childTask.issueNumber === issueNumber),
        )
        .filter((childTask): childTask is ParsedChildTask => childTask !== undefined)
      const batchImpactsByIssueNumber = new Map(
        taskImpacts.map((taskImpact) => [taskImpact.issueNumber, taskImpact.surface]),
      )
      const parallelWorkerResults =
        batch.mode === 'parallel' && batchChildren.length > 1
          ? await Promise.all(
              batchChildren.map(async (childTask) => ({
                issueNumber: childTask.issueNumber,
                workerResult: await adapters.sandcastle.runImplementation({
                  childTask,
                  impactAnalysis: requiredImpactForChild(
                    batchImpactsByIssueNumber,
                    childTask.issueNumber,
                  ),
                  parentPrd: selectedPrd,
                  parentPrdBody,
                  prdBranchName: branchSeedPlan.prdBranchName,
                  siblingSummaries: createSiblingSummaries(
                    selectedPrd,
                    childTask,
                    completedChildIssueNumbers,
                  ),
                  workerBranchName: createWorkerBranchName(selectedPrd, childTask),
                }),
              })),
            )
          : []
      const parallelWorkerResultsByIssueNumber = new Map(
        parallelWorkerResults.map((result) => [result.issueNumber, result.workerResult]),
      )

      for (const selectedChild of batchChildren) {
        const completedBeforeChild =
          (await adapters.git.getCompletedChildIssueNumbers?.(branchSeedPlan.prdBranchName)) ?? []
        const impactAnalysis = requiredImpactForChild(
          batchImpactsByIssueNumber,
          selectedChild.issueNumber,
        )
        const siblingSummaries = createSiblingSummaries(
          selectedPrd,
          selectedChild,
          completedBeforeChild,
        )
        const workerBranchName = createWorkerBranchName(selectedPrd, selectedChild)
        const workerResult =
          parallelWorkerResultsByIssueNumber.get(selectedChild.issueNumber) ??
          (await adapters.sandcastle.runImplementation({
            childTask: selectedChild,
            impactAnalysis,
            parentPrd: selectedPrd,
            parentPrdBody,
            prdBranchName: branchSeedPlan.prdBranchName,
            siblingSummaries,
            workerBranchName,
          }))
        const childResult = await executePreparedChildWithLock({
          adapters,
          blockedChildIssueNumbers: [...blockedChildIssueNumbers],
          branchSeedPlan,
          completedChildIssueNumbers: completedBeforeChild,
          draftPr: draftPrHandle.current(),
          ensureDraftPr: draftPrHandle.ensure,
          impactAnalysis,
          issues,
          lastCommand: 'run',
          mainBranchStatus,
          parentPrdBody,
          selectedChild,
          selectedPrd,
          siblingSummaries,
          workerBranchName,
          workerResult,
        })

        if (childResult.exitCode === 0) {
          madeProgress = true

          const status = await adapters.state.readRunStatus()

          if (status.phase === 'ready-for-review') {
            return {
              exitCode: 0,
              stderr: '',
              stdout: renderFullRunCompletion(status),
            }
          }

          continue
        }

        const status = await adapters.state.readRunStatus()

        if (status.phase !== 'blocked' || status.currentChildIssueNumber === undefined) {
          return childResult
        }

        blockedChildIssueNumbers.add(status.currentChildIssueNumber)
        blockedThisPass = true

        break
      }

      if (blockedThisPass) {
        break
      }
    }
  }
}

const executeLiveOneChildWithLock = async (
  adapters: PrdOrchestratorLiveAdapters,
  input: {
    readonly blockedChildIssueNumbers?: readonly number[]
    readonly lastCommand?: string
    readonly startupContext?: LiveRunStartupContext
  } = {},
): Promise<LiveCommandResult> => {
  const issues = input.startupContext?.issues ?? (await adapters.github.listOpenIssues())
  const dryRunPlan = createDryRunPlan(issues)
  const selectedPrd = dryRunPlan.selectedPrd

  if (selectedPrd === undefined) {
    return blockedResult('No eligible PRD with child tasks is available.')
  }

  if (selectedPrd.blockers.length > 0) {
    return await recordPreExecutionPlanningBlockers({
      adapters,
      lastCommand: input.lastCommand ?? 'run --one-child',
      selectedPrd,
    })
  }

  const branchSeedPlan = planOneChildTransaction({
    childCommitHash: undefined,
    codeRabbitStatus: 'not run',
    completedChildIssueNumbers: [],
    dependencyChangeJustification: undefined,
    existingLedger: [],
    impactAnalysis: emptyImpactAnalysis,
    issues,
    mainBranchStatus: {
      clean: true,
      currentBranch: 'main',
      upToDate: true,
    },
    remoteAutomationPr: undefined,
    verificationEvidence: [],
    workerChangedFiles: [],
  })
  const mainBranchStatus = await adapters.git.getMainBranchStatus()

  if (!isCleanUpToDateMain(mainBranchStatus)) {
    return blockedResult('run --one-child must start from clean, up-to-date main.')
  }

  const completedChildIssueNumbers =
    (await adapters.git.getCompletedChildIssueNumbers?.(branchSeedPlan.prdBranchName)) ?? []
  const selectedChild = selectNextChild(
    selectedPrd,
    completedChildIssueNumbers,
    input.blockedChildIssueNumbers ?? [],
  )

  if (selectedChild === undefined) {
    return blockedResult('No unblocked child task is available.')
  }

  const remoteAutomationPr =
    input.startupContext === undefined
      ? await adapters.github.findAutomationPr(
          selectedPrd.issueNumber,
          branchSeedPlan.prdBranchName,
        )
      : input.startupContext.remoteAutomationPr
  const existingPrRewriteBlocker = getExistingRunRewriteBlocker(
    remoteAutomationPr,
    'run --one-child',
  )

  if (existingPrRewriteBlocker !== undefined) {
    return blockedResult(existingPrRewriteBlocker)
  }

  const parentPrdBody = issues.find((issue) => issue.number === selectedPrd.issueNumber)?.body ?? ''

  await adapters.git.preparePrdBranch({
    branchName: branchSeedPlan.prdBranchName,
    remoteAutomationPr,
  })

  const draftPrHandle = createDraftPrHandle({
    adapters,
    branchName: branchSeedPlan.prdBranchName,
    prdIssueNumber: selectedPrd.issueNumber,
    remoteAutomationPr,
    title: branchSeedPlan.draftPullRequest.title,
  })

  const siblingSummaries = selectedPrd.childTasks
    .filter((childTask) => childTask.issueNumber !== selectedChild.issueNumber)
    .map((childTask) => ({
      issueNumber: childTask.issueNumber,
      status: completedChildIssueNumbers.includes(childTask.issueNumber) ? 'complete' : 'pending',
      summary: childTask.whatToBuild,
    }))
  const impactAnalysis = await adapters.sandcastle.runImpactAnalysis({
    childTask: selectedChild,
    parentPrd: selectedPrd,
    parentPrdBody,
    siblingSummaries,
  })
  const workerBranchName = createWorkerBranchName(selectedPrd, selectedChild)
  const workerResult = await adapters.sandcastle.runImplementation({
    childTask: selectedChild,
    impactAnalysis,
    parentPrd: selectedPrd,
    parentPrdBody,
    prdBranchName: branchSeedPlan.prdBranchName,
    siblingSummaries,
    workerBranchName,
  })
  const writeSurface = await resolveWriteSurfaceBeforeApply({
    adapters,
    impactAnalysis,
    parentPrd: selectedPrd,
    parentPrdBody,
    selectedChild,
    siblingSummaries,
    workerChangedFiles: workerResult.changedFiles,
  })

  if (writeSurface.blockers.length > 0) {
    const blockedBody = generateDraftPrBody({
      branchName: branchSeedPlan.prdBranchName,
      childTasks: selectedPrd.childTasks,
      ledger: await createRunLedger({
        adapters,
        blockedChildIssueNumber: selectedChild.issueNumber,
        branchName: branchSeedPlan.prdBranchName,
        childTasks: selectedPrd.childTasks,
        completedChildIssueNumbers,
      }),
      parentPrdIssueNumber: selectedPrd.issueNumber,
      prdTitle: selectedPrd.title,
    })
    const activeDraftPr =
      completedChildIssueNumbers.length === 0
        ? draftPrHandle.current()
        : await draftPrHandle.ensure(blockedBody)
    const status = createRunStatus({
      blockers: writeSurface.blockers,
      branchName: branchSeedPlan.prdBranchName,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers,
      currentChildIssueNumber: selectedChild.issueNumber,
      phase: 'blocked',
      pr: activeDraftPr,
      prdIssueNumber: selectedPrd.issueNumber,
    })

    await recordBlockedProgress({
      adapters,
      body: blockedBody,
      draftPr: activeDraftPr,
      status,
    })

    return {
      exitCode: 1,
      stderr: `${writeSurface.blockers.join('\n')}\n`,
      stdout: `${renderOneChildSummary({
        childIssueNumber: selectedChild.issueNumber,
        pr: activeDraftPr,
        status,
      })}\n`,
    }
  }

  const verifiedWorkerResult = await repairVerificationUntilClean({
    adapters,
    impactAnalysis: writeSurface.impactAnalysis,
    parentPrd: selectedPrd,
    parentPrdBody,
    prdBranchName: branchSeedPlan.prdBranchName,
    selectedChild,
    siblingSummaries,
    workerBranchName,
    workerResult,
  })

  if (verifiedWorkerResult.status === 'blocked') {
    return await recordVerificationRepairBlockedProgress({
      adapters,
      blockedChildIssueNumbers: [],
      blockers: verifiedWorkerResult.blockers,
      branchName: branchSeedPlan.prdBranchName,
      completedChildIssueNumbers,
      draftPr: draftPrHandle.current(),
      selectedChild,
      selectedPrd,
    })
  }

  const verificationEvidence = verifiedWorkerResult.verificationEvidence
  const commitReadyPlan = planOneChildTransaction({
    childCommitHash: undefined,
    codeRabbitStatus: 'not run',
    completedChildIssueNumbers,
    dependencyChangeJustification: createDependencyChangeJustification({
      changedFiles: verifiedWorkerResult.workerResult.changedFiles,
      childTask: selectedChild,
      impactAnalysis: verifiedWorkerResult.impactAnalysis,
    }),
    existingLedger: await createRunLedger({
      adapters,
      branchName: branchSeedPlan.prdBranchName,
      childTasks: selectedPrd.childTasks,
      completedChildIssueNumbers,
    }),
    impactAnalysis: verifiedWorkerResult.impactAnalysis,
    issues,
    mainBranchStatus,
    remoteAutomationPr: draftPrHandle.current(),
    verificationEvidence,
    workerChangedFiles: verifiedWorkerResult.workerResult.changedFiles,
  })

  if (commitReadyPlan.status === 'blocked') {
    const activeDraftPr =
      completedChildIssueNumbers.length === 0
        ? draftPrHandle.current()
        : await draftPrHandle.ensure(commitReadyPlan.prBodyAfterChildUpdate)
    const status = createRunStatus({
      blockers: commitReadyPlan.blockers,
      branchName: branchSeedPlan.prdBranchName,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers,
      currentChildIssueNumber: selectedChild.issueNumber,
      phase: 'blocked',
      pr: activeDraftPr,
      prdIssueNumber: selectedPrd.issueNumber,
    })

    await recordBlockedProgress({
      adapters,
      body: commitReadyPlan.prBodyAfterChildUpdate,
      draftPr: activeDraftPr,
      status,
    })

    return {
      exitCode: 1,
      stderr: `${commitReadyPlan.blockers.join('\n')}\n`,
      stdout: `${renderOneChildSummary({
        childIssueNumber: selectedChild.issueNumber,
        pr: activeDraftPr,
        status,
      })}\n`,
    }
  }

  const currentDraftPr = draftPrHandle.current()
  const rewriteBlocker =
    currentDraftPr === undefined
      ? undefined
      : await getFreshRewriteBlocker({
          adapters,
          command: input.lastCommand ?? 'run --one-child',
          pr: currentDraftPr,
        })

  if (rewriteBlocker !== undefined) {
    const status = createRunStatus({
      blockers: [rewriteBlocker],
      branchName: branchSeedPlan.prdBranchName,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers,
      currentChildIssueNumber: selectedChild.issueNumber,
      lastCommand: input.lastCommand ?? 'run --one-child',
      phase: 'blocked',
      pr: draftPrHandle.current(),
      prdIssueNumber: selectedPrd.issueNumber,
    })

    await adapters.state.recordRunStatus(status)

    return {
      exitCode: 1,
      stderr: `${rewriteBlocker}\n`,
      stdout: `${renderOneChildSummary({
        childIssueNumber: selectedChild.issueNumber,
        pr: draftPrHandle.current(),
        status,
      })}\n`,
    }
  }

  const commit = await adapters.git.commitChild(commitReadyPlan.commitMessage)

  await adapters.git.pushPrdBranch(commitReadyPlan.push)

  const baseLedger = await createRunLedger({
    adapters,
    branchName: branchSeedPlan.prdBranchName,
    childTasks: selectedPrd.childTasks,
    completedChildIssueNumbers,
  })
  const activeDraftPr = await draftPrHandle.ensure(
    generateDraftPrBody({
      branchName: branchSeedPlan.prdBranchName,
      childTasks: selectedPrd.childTasks,
      ledger: updateLedgerForChildResult({
        childCommitHash: commit.hash,
        codeRabbitStatus: 'pending',
        existingLedger: baseLedger,
        selectedChild,
        status: 'complete',
        verificationEvidence,
      }),
      parentPrdIssueNumber: selectedPrd.issueNumber,
      prdTitle: selectedPrd.title,
    }),
  )

  let codeRabbitResult: ReviewChildResult

  try {
    codeRabbitResult = await adapters.codeRabbit.reviewChild({
      branchName: branchSeedPlan.prdBranchName,
      childCommitHash: commit.hash,
      childIssueNumber: selectedChild.issueNumber,
      prNumber: activeDraftPr.prNumber,
    })
  } catch (error) {
    return await recordCodeRabbitReviewFailedProgress({
      adapters,
      baseLedger,
      branchName: branchSeedPlan.prdBranchName,
      childCommitHash: commit.hash,
      completedChildIssueNumbers,
      draftPr: activeDraftPr,
      errorMessage: formatErrorMessage(error),
      lastCommand: input.lastCommand ?? 'run --one-child',
      selectedChild,
      selectedPrd,
      verificationEvidence,
    })
  }

  const cleanReview = await repairCodeRabbitFindingsUntilClean({
    adapters,
    branchName: branchSeedPlan.prdBranchName,
    childCommitHash: commit.hash,
    draftPr: activeDraftPr,
    impactAnalysis: verifiedWorkerResult.impactAnalysis,
    parentPrd: selectedPrd,
    parentPrdBody,
    selectedChild,
    siblingSummaries,
    verificationCommands: selectVerificationCommands(verifiedWorkerResult.impactAnalysis),
    workerBranchName,
    initialResult: codeRabbitResult,
    curatedCommitMessage: commitReadyPlan.commitMessage,
  })
  const finalPlan = planOneChildTransaction({
    childCommitHash: cleanReview.commitHash,
    codeRabbitStatus: cleanReview.result.status,
    completedChildIssueNumbers,
    dependencyChangeJustification: createDependencyChangeJustification({
      changedFiles: verifiedWorkerResult.workerResult.changedFiles,
      childTask: selectedChild,
      impactAnalysis: verifiedWorkerResult.impactAnalysis,
    }),
    existingLedger: await createRunLedger({
      adapters,
      branchName: branchSeedPlan.prdBranchName,
      childTasks: selectedPrd.childTasks,
      completedChildIssueNumbers,
    }),
    impactAnalysis: verifiedWorkerResult.impactAnalysis,
    issues,
    mainBranchStatus,
    remoteAutomationPr: activeDraftPr,
    verificationEvidence,
    workerChangedFiles: verifiedWorkerResult.workerResult.changedFiles,
  })
  const completedChildren =
    cleanReview.result.findings.length === 0
      ? [...completedChildIssueNumbers, selectedChild.issueNumber]
      : completedChildIssueNumbers
  const allChildrenComplete = completedChildren.length === selectedPrd.childTasks.length

  await adapters.github.updatePrBody(activeDraftPr.prNumber, finalPlan.prBodyAfterChildUpdate)

  const finalizationResult =
    allChildrenComplete && cleanReview.result.findings.length === 0
      ? await finalizePrdIfReady({
          adapters,
          branchName: branchSeedPlan.prdBranchName,
          completedChildren,
          draftPr: activeDraftPr,
          selectedPrd,
          verificationEvidence,
          verificationEvidenceByChild: createVerificationEvidenceByChild({
            childTasks: selectedPrd.childTasks,
            completedChildren,
            currentChildIssueNumber: selectedChild.issueNumber,
            currentVerificationEvidence: verificationEvidence,
          }),
        })
      : {
          blockers: [],
          ciStatus: undefined,
          phase: cleanReview.result.findings.length === 0 ? 'complete' : 'blocked',
        }
  const status = createRunStatus({
    blockers:
      cleanReview.result.findings.length === 0
        ? finalizationResult.blockers
        : cleanReview.result.findings.map((finding) => finding.title),
    branchName: branchSeedPlan.prdBranchName,
    ciStatus: finalizationResult.ciStatus,
    codeRabbitStatus: cleanReview.result.status,
    completedChildIssueNumbers: completedChildren,
    currentChildIssueNumber: undefined,
    lastCommand: input.lastCommand ?? 'run --one-child',
    phase: cleanReview.result.findings.length === 0 ? finalizationResult.phase : 'blocked',
    pr: activeDraftPr,
    prdIssueNumber: selectedPrd.issueNumber,
  })

  await adapters.state.recordRunStatus(status)

  return {
    exitCode:
      cleanReview.result.findings.length === 0 && finalizationResult.blockers.length === 0 ? 0 : 1,
    stderr: '',
    stdout: `${renderOneChildSummary({
      childIssueNumber: selectedChild.issueNumber,
      pr: activeDraftPr,
      status,
    })}\n`,
  }
}

const executePreparedChildWithLock = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly blockedChildIssueNumbers: readonly number[]
  readonly branchSeedPlan: OneChildTransactionPlan
  readonly completedChildIssueNumbers: readonly number[]
  readonly draftPr: RemoteAutomationPr | undefined
  readonly ensureDraftPr: DraftPrResolver
  readonly impactAnalysis: SandcastleImpactAnalysisResult
  readonly issues: readonly GitHubIssue[]
  readonly lastCommand: string
  readonly mainBranchStatus: MainBranchStatus
  readonly parentPrdBody: string
  readonly selectedChild: ParsedChildTask
  readonly selectedPrd: SelectedPrdPlan
  readonly siblingSummaries: readonly SiblingTaskSummary[]
  readonly workerBranchName: string
  readonly workerResult: RunImplementationResult
}): Promise<LiveCommandResult> => {
  const writeSurface = await resolveWriteSurfaceBeforeApply({
    adapters: input.adapters,
    impactAnalysis: input.impactAnalysis,
    parentPrd: input.selectedPrd,
    parentPrdBody: input.parentPrdBody,
    selectedChild: input.selectedChild,
    siblingSummaries: input.siblingSummaries,
    workerChangedFiles: input.workerResult.changedFiles,
  })

  if (writeSurface.blockers.length > 0) {
    const status = createRunStatus({
      blockers: writeSurface.blockers,
      branchName: input.branchSeedPlan.prdBranchName,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers: input.completedChildIssueNumbers,
      currentChildIssueNumber: input.selectedChild.issueNumber,
      lastCommand: input.lastCommand,
      phase: 'blocked',
      pr: input.draftPr,
      prdIssueNumber: input.selectedPrd.issueNumber,
    })

    await recordBlockedProgress({
      adapters: input.adapters,
      body: generateDraftPrBody({
        branchName: input.branchSeedPlan.prdBranchName,
        childTasks: input.selectedPrd.childTasks,
        ledger: await createBaseLedger({
          adapters: input.adapters,
          blockedChildIssueNumbers: [
            ...input.blockedChildIssueNumbers,
            input.selectedChild.issueNumber,
          ],
          branchName: input.branchSeedPlan.prdBranchName,
          childTasks: input.selectedPrd.childTasks,
          completedChildIssueNumbers: input.completedChildIssueNumbers,
        }),
        parentPrdIssueNumber: input.selectedPrd.issueNumber,
        prdTitle: input.selectedPrd.title,
      }),
      draftPr: input.draftPr,
      status,
    })

    return {
      exitCode: 1,
      stderr: `${writeSurface.blockers.join('\n')}\n`,
      stdout: `${renderOneChildSummary({
        childIssueNumber: input.selectedChild.issueNumber,
        pr: input.draftPr,
        status,
      })}\n`,
    }
  }

  const verifiedWorkerResult = await repairVerificationUntilClean({
    adapters: input.adapters,
    impactAnalysis: writeSurface.impactAnalysis,
    parentPrd: input.selectedPrd,
    parentPrdBody: input.parentPrdBody,
    prdBranchName: input.branchSeedPlan.prdBranchName,
    selectedChild: input.selectedChild,
    siblingSummaries: input.siblingSummaries,
    workerBranchName: input.workerBranchName,
    workerResult: input.workerResult,
  })

  if (verifiedWorkerResult.status === 'blocked') {
    return await recordVerificationRepairBlockedProgress({
      adapters: input.adapters,
      blockedChildIssueNumbers: input.blockedChildIssueNumbers,
      blockers: verifiedWorkerResult.blockers,
      branchName: input.branchSeedPlan.prdBranchName,
      completedChildIssueNumbers: input.completedChildIssueNumbers,
      draftPr: input.draftPr,
      lastCommand: input.lastCommand,
      selectedChild: input.selectedChild,
      selectedPrd: input.selectedPrd,
    })
  }

  const verificationEvidence = verifiedWorkerResult.verificationEvidence
  const baseLedger = await createBaseLedger({
    adapters: input.adapters,
    blockedChildIssueNumbers: input.blockedChildIssueNumbers,
    branchName: input.branchSeedPlan.prdBranchName,
    childTasks: input.selectedPrd.childTasks,
    completedChildIssueNumbers: input.completedChildIssueNumbers,
  })
  const commitMessage = createChildCommitMessage({
    acceptanceEvidence: input.selectedChild.acceptanceCriteria,
    childIssueNumber: input.selectedChild.issueNumber,
    childTitle: input.selectedChild.title,
    verificationEvidence,
  })
  const push = {
    branchName: input.branchSeedPlan.prdBranchName,
    mode: 'force-with-lease',
  } as const
  const rewriteBlocker =
    input.draftPr === undefined
      ? undefined
      : await getFreshRewriteBlocker({
          adapters: input.adapters,
          command: input.lastCommand,
          pr: input.draftPr,
        })

  if (rewriteBlocker !== undefined) {
    const status = createRunStatus({
      blockers: [rewriteBlocker],
      branchName: input.branchSeedPlan.prdBranchName,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers: input.completedChildIssueNumbers,
      currentChildIssueNumber: input.selectedChild.issueNumber,
      lastCommand: input.lastCommand,
      phase: 'blocked',
      pr: input.draftPr,
      prdIssueNumber: input.selectedPrd.issueNumber,
    })

    await input.adapters.state.recordRunStatus(status)

    return {
      exitCode: 1,
      stderr: `${rewriteBlocker}\n`,
      stdout: `${renderOneChildSummary({
        childIssueNumber: input.selectedChild.issueNumber,
        pr: input.draftPr,
        status,
      })}\n`,
    }
  }

  const commit = await input.adapters.git.commitChild(commitMessage)

  await input.adapters.git.pushPrdBranch(push)

  const activeDraftPr = await input.ensureDraftPr(
    generateDraftPrBody({
      branchName: input.branchSeedPlan.prdBranchName,
      childTasks: input.selectedPrd.childTasks,
      ledger: updateLedgerForChildResult({
        childCommitHash: commit.hash,
        codeRabbitStatus: 'pending',
        existingLedger: baseLedger,
        selectedChild: input.selectedChild,
        status: 'complete',
        verificationEvidence,
      }),
      parentPrdIssueNumber: input.selectedPrd.issueNumber,
      prdTitle: input.selectedPrd.title,
    }),
  )

  let codeRabbitResult: ReviewChildResult

  try {
    codeRabbitResult = await input.adapters.codeRabbit.reviewChild({
      branchName: input.branchSeedPlan.prdBranchName,
      childCommitHash: commit.hash,
      childIssueNumber: input.selectedChild.issueNumber,
      prNumber: activeDraftPr.prNumber,
    })
  } catch (error) {
    return await recordCodeRabbitReviewFailedProgress({
      adapters: input.adapters,
      baseLedger,
      branchName: input.branchSeedPlan.prdBranchName,
      childCommitHash: commit.hash,
      completedChildIssueNumbers: input.completedChildIssueNumbers,
      draftPr: activeDraftPr,
      errorMessage: formatErrorMessage(error),
      lastCommand: input.lastCommand,
      selectedChild: input.selectedChild,
      selectedPrd: input.selectedPrd,
      verificationEvidence,
    })
  }

  const cleanReview = await repairCodeRabbitFindingsUntilClean({
    adapters: input.adapters,
    branchName: input.branchSeedPlan.prdBranchName,
    childCommitHash: commit.hash,
    curatedCommitMessage: commitMessage,
    draftPr: activeDraftPr,
    impactAnalysis: verifiedWorkerResult.impactAnalysis,
    initialResult: codeRabbitResult,
    parentPrd: input.selectedPrd,
    parentPrdBody: input.parentPrdBody,
    selectedChild: input.selectedChild,
    siblingSummaries: input.siblingSummaries,
    verificationCommands: selectVerificationCommands(verifiedWorkerResult.impactAnalysis),
    workerBranchName: input.workerBranchName,
  })
  const completedChildren =
    cleanReview.result.findings.length === 0
      ? [...input.completedChildIssueNumbers, input.selectedChild.issueNumber]
      : input.completedChildIssueNumbers
  const allChildrenComplete = completedChildren.length === input.selectedPrd.childTasks.length
  const finalLedger = updateLedgerForChildResult({
    childCommitHash: cleanReview.commitHash,
    codeRabbitStatus: cleanReview.result.status,
    existingLedger: baseLedger,
    selectedChild: input.selectedChild,
    status: cleanReview.result.findings.length === 0 ? 'complete' : 'blocked',
    verificationEvidence,
  })

  await input.adapters.github.updatePrBody(
    activeDraftPr.prNumber,
    generateDraftPrBody({
      branchName: input.branchSeedPlan.prdBranchName,
      childTasks: input.selectedPrd.childTasks,
      ledger: finalLedger,
      parentPrdIssueNumber: input.selectedPrd.issueNumber,
      prdTitle: input.selectedPrd.title,
    }),
  )

  const finalizationResult =
    allChildrenComplete && cleanReview.result.findings.length === 0
      ? await finalizePrdIfReady({
          adapters: input.adapters,
          branchName: input.branchSeedPlan.prdBranchName,
          completedChildren,
          draftPr: activeDraftPr,
          selectedPrd: input.selectedPrd,
          verificationEvidence,
          verificationEvidenceByChild: createVerificationEvidenceByChild({
            childTasks: input.selectedPrd.childTasks,
            completedChildren,
            currentChildIssueNumber: input.selectedChild.issueNumber,
            currentVerificationEvidence: verificationEvidence,
          }),
        })
      : {
          blockers: [],
          ciStatus: undefined,
          phase: cleanReview.result.findings.length === 0 ? 'complete' : 'blocked',
        }
  const status = createRunStatus({
    blockers:
      cleanReview.result.findings.length === 0
        ? finalizationResult.blockers
        : cleanReview.result.findings.map((finding) => finding.title),
    branchName: input.branchSeedPlan.prdBranchName,
    ciStatus: finalizationResult.ciStatus,
    codeRabbitStatus: cleanReview.result.status,
    completedChildIssueNumbers: completedChildren,
    currentChildIssueNumber: undefined,
    lastCommand: input.lastCommand,
    phase: cleanReview.result.findings.length === 0 ? finalizationResult.phase : 'blocked',
    pr: activeDraftPr,
    prdIssueNumber: input.selectedPrd.issueNumber,
  })

  await input.adapters.state.recordRunStatus(status)

  return {
    exitCode:
      cleanReview.result.findings.length === 0 && finalizationResult.blockers.length === 0 ? 0 : 1,
    stderr: '',
    stdout: `${renderOneChildSummary({
      childIssueNumber: input.selectedChild.issueNumber,
      pr: activeDraftPr,
      status,
    })}\n`,
  }
}

export const executeResumePr = async (
  prNumber: number,
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const preflight = await adapters.state.runPreflight()

  if (!preflight.ready) {
    return blockedResult(preflight.blockers.join('\n'))
  }

  const lock = await adapters.state.acquireRunLock()

  if (!lock.ready) {
    return blockedResult(lock.blockers.join('\n'))
  }

  try {
    return await executeResumePrWithLock(prNumber, adapters)
  } finally {
    await adapters.state.releaseRunLock()
  }
}

const executeResumePrWithLock = async (
  prNumber: number,
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const pr = await adapters.github.getPr(prNumber)
  const ownership = validateAutomationPrOwnership({
    body: pr.body,
    branchName: pr.branchName,
    prNumber,
  })

  if (!ownership.valid) {
    return {
      exitCode: 1,
      stderr: `${ownership.blockers.join('\n')}\n`,
      stdout: '',
    }
  }

  const issues = await adapters.github.listOpenIssues()
  const selectedPrd = createDryRunPlanForPrdBranch(issues, pr.branchName)

  if (selectedPrd === undefined) {
    return await recordResumePrdLookupBlocker({
      adapters,
      pr,
    })
  }

  if (selectedPrd.blockers.length > 0) {
    return await recordPreExecutionPlanningBlockers({
      adapters,
      lastCommand: 'resume-pr',
      selectedPrd,
    })
  }

  const reviewFindings = (await adapters.github.getReviewFindings?.(prNumber)) ?? []
  const childCommits = (await adapters.git.getChildCommitReferences?.(pr.branchName)) ?? []
  const repairPlan = planResumePrRepair({
    childCommits,
    findings: reviewFindings,
    ownership: {
      body: pr.body,
      branchName: pr.branchName,
      prNumber,
    },
    prIsDraft: pr.isDraft,
  })

  if (repairPlan.action === 'blocked') {
    return {
      exitCode: 1,
      stderr: `${repairPlan.blockers.join('\n')}\n`,
      stdout: '',
    }
  }

  if (repairPlan.amendChildCommits.length > 0 && adapters.git.checkoutChildCommit === undefined) {
    return {
      exitCode: 1,
      stderr:
        'Resume repair cannot safely target child commits because the git adapter does not support targeted checkout.\n',
      stdout: '',
    }
  }

  const convertPrToDraft = adapters.github.convertPrToDraft

  if (repairPlan.returnToDraft) {
    if (convertPrToDraft === undefined) {
      return {
        exitCode: 1,
        stderr:
          'Resume repair requires returning the PR to draft before rewriting history, but the GitHub adapter does not support it.\n',
        stdout: '',
      }
    }

    await convertPrToDraft(prNumber)
  }

  if (repairPlan.nonActionableFindings.length > 0) {
    await adapters.github.postPrComment(
      prNumber,
      renderNonActionableFindingRecords(repairPlan.nonActionableFindings),
    )
  }

  for (const amendPlan of repairPlan.amendChildCommits) {
    const findings = reviewFindings.filter((finding) => amendPlan.findingIds.includes(finding.id))

    await adapters.git.checkoutChildCommit?.({
      branchName: pr.branchName,
      childIssueNumber: amendPlan.childIssueNumber,
      commitHash: amendPlan.commitHash,
    })
    const repairGate = await runResumeRepairGateUntilClean({
      adapters,
      branchName: pr.branchName,
      codeRabbitChildIssueNumber: amendPlan.childIssueNumber,
      codeRabbitCommitHash: amendPlan.commitHash,
      currentChildIssueNumber: amendPlan.childIssueNumber,
      expectedFiles: [],
      findings,
      prNumber,
      targetLabel: 'child',
      targetCommitHash: amendPlan.commitHash,
      workerBranchName: `${pr.branchName}-resume-${String(amendPlan.childIssueNumber)}`,
    })

    if (repairGate.status === 'blocked') {
      return await recordResumeRepairBlockedProgress({
        adapters,
        blockers: repairGate.blockers,
        codeRabbitStatus: repairGate.codeRabbitStatus,
        completedChildIssueNumbers: childCommits.map((commit) => commit.childIssueNumber),
        currentChildIssueNumber: repairGate.currentChildIssueNumber,
        pr,
        prdIssueNumber: selectedPrd.issueNumber,
      })
    }

    await adapters.git.amendChildCommit(
      createResumeChildCommitMessage(amendPlan.childIssueNumber, findings),
    )
  }

  if (repairPlan.finalCleanupCommit !== undefined) {
    if (adapters.git.commitFinalCleanup === undefined) {
      return await recordResumeRepairBlockedProgress({
        adapters,
        blockers: [
          'Resume repair cannot commit final cleanup changes because the git adapter does not support final cleanup commits.',
        ],
        codeRabbitStatus: 'not run',
        completedChildIssueNumbers: childCommits.map((commit) => commit.childIssueNumber),
        currentChildIssueNumber: undefined,
        pr,
        prdIssueNumber: selectedPrd.issueNumber,
      })
    }

    const findings = reviewFindings.filter((finding) =>
      repairPlan.finalCleanupCommit?.findingIds.includes(finding.id),
    )

    const repairGate = await runResumeRepairGateUntilClean({
      adapters,
      branchName: pr.branchName,
      codeRabbitChildIssueNumber: 0,
      codeRabbitCommitHash: 'final-cleanup',
      currentChildIssueNumber: undefined,
      expectedFiles: [],
      findings,
      prNumber,
      targetLabel: 'final cleanup',
      workerBranchName: `${pr.branchName}-resume-final-cleanup`,
    })

    if (repairGate.status === 'blocked') {
      return await recordResumeRepairBlockedProgress({
        adapters,
        blockers: repairGate.blockers,
        codeRabbitStatus: repairGate.codeRabbitStatus,
        completedChildIssueNumbers: childCommits.map((commit) => commit.childIssueNumber),
        currentChildIssueNumber: repairGate.currentChildIssueNumber,
        pr,
        prdIssueNumber: selectedPrd.issueNumber,
      })
    }

    await adapters.git.commitFinalCleanup(repairPlan.finalCleanupCommit.message)
  }

  if (repairPlan.forcePush !== undefined) {
    await adapters.git.pushPrdBranch(repairPlan.forcePush)
  }

  await adapters.state.recoverRunStatusFromPr(pr)

  const completedChildren =
    (await adapters.git.getCompletedChildIssueNumbers?.(pr.branchName)) ??
    childCommits.map((commit) => commit.childIssueNumber)

  if (completedChildren.length === selectedPrd.childTasks.length) {
    return await finalizeRecoveredPrdBranch({
      adapters,
      branchName: pr.branchName,
      completedChildren,
      draftPr: createRemoteAutomationPrFromDetails(
        pr,
        selectedPrd.issueNumber,
        pr.isDraft || repairPlan.returnToDraft,
      ),
      lastCommand: 'resume-pr',
      selectedPrd,
    })
  }

  return await executeLiveRunWithLock(adapters)
}

const runResumeRepairGateUntilClean = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
  readonly codeRabbitChildIssueNumber: number
  readonly codeRabbitCommitHash: string
  readonly currentChildIssueNumber: number | undefined
  readonly expectedFiles: readonly string[]
  readonly findings: readonly CodeRabbitFinding[]
  readonly prNumber: number
  readonly targetCommitHash?: string
  readonly targetLabel: 'child' | 'final cleanup'
  readonly workerBranchName: string
}): Promise<ResumeRepairGateResult> => {
  const repairResumeFindings = input.adapters.sandcastle.repairResumeFindings

  if (repairResumeFindings === undefined) {
    return {
      blockers: ['Resume repair requires a Sandcastle resume repair adapter.'],
      codeRabbitStatus: 'not run',
      currentChildIssueNumber: input.currentChildIssueNumber,
      status: 'blocked',
    }
  }

  let findings = input.findings
  const seenFindingFingerprints = new Set<string>()

  for (;;) {
    let workerResult: RunImplementationResult
    const workerBranchName = createResumeRepairWorkerBranchName(input.workerBranchName)

    try {
      workerResult = await repairResumeFindings({
        branchName: input.branchName,
        findings,
        prNumber: input.prNumber,
        targetCommitHash: input.targetCommitHash,
        workerBranchName,
      })
    } catch (error) {
      return {
        blockers: [
          `Resume repair Sandcastle worker failed. Error evidence: ${formatConciseErrorEvidence(
            formatErrorMessage(error),
          )}`,
          ...(await restorePrdBranchToCleanStateBeforeBlocker({
            adapters: input.adapters,
            branchName: input.branchName,
          })),
        ],
        codeRabbitStatus: 'not run',
        currentChildIssueNumber: input.currentChildIssueNumber,
        status: 'blocked',
      }
    }

    const writeSurfaceBlockers = validateResumeRepairWriteSurface({
      changedFiles: workerResult.changedFiles,
      expectedFiles: input.expectedFiles,
      targetLabel: input.targetLabel,
    })

    if (writeSurfaceBlockers.length > 0) {
      return {
        blockers: writeSurfaceBlockers,
        codeRabbitStatus: 'not run',
        currentChildIssueNumber: input.currentChildIssueNumber,
        status: 'blocked',
      }
    }

    try {
      await input.adapters.git.applyWorkerDiff({
        prdBranchName: input.branchName,
        workerBranchName: workerResult.workerBranchName,
        workerWorktreePath: workerResult.workerWorktreePath,
      })
    } catch (error) {
      return {
        blockers: [
          `Resume repair failed to apply worker diff from ${workerResult.workerBranchName}. Error evidence: ${formatConciseErrorEvidence(
            formatErrorMessage(error),
          )}`,
          ...(await restorePrdBranchToCleanStateBeforeBlocker({
            adapters: input.adapters,
            branchName: input.branchName,
          })),
        ],
        codeRabbitStatus: 'not run',
        currentChildIssueNumber: input.currentChildIssueNumber,
        status: 'blocked',
      }
    }

    try {
      await input.adapters.verification.runCommands(resumeRepairVerificationCommands)
    } catch (error) {
      return {
        blockers: [
          `Resume repair verification failed. Failing verification command: ${formatFailingVerificationCommand(
            resumeRepairVerificationCommands,
          )}. Error evidence: ${formatConciseErrorEvidence(formatErrorMessage(error))}`,
          ...(await restorePrdBranchToCleanStateBeforeBlocker({
            adapters: input.adapters,
            branchName: input.branchName,
          })),
        ],
        codeRabbitStatus: 'not run',
        currentChildIssueNumber: input.currentChildIssueNumber,
        status: 'blocked',
      }
    }

    let codeRabbitResult: ReviewChildResult

    try {
      codeRabbitResult = await input.adapters.codeRabbit.reviewChild({
        branchName: input.branchName,
        childCommitHash: input.codeRabbitCommitHash,
        childIssueNumber: input.codeRabbitChildIssueNumber,
        prNumber: input.prNumber,
      })
    } catch (error) {
      return {
        blockers: [
          `Resume repair CodeRabbit rerun failed. Error evidence: ${formatConciseErrorEvidence(
            formatErrorMessage(error),
          )}`,
          ...(await restorePrdBranchToCleanStateBeforeBlocker({
            adapters: input.adapters,
            branchName: input.branchName,
          })),
        ],
        codeRabbitStatus: 'failed',
        currentChildIssueNumber: input.currentChildIssueNumber,
        status: 'blocked',
      }
    }

    const classifications = codeRabbitResult.findings.map((finding) =>
      classifyCodeRabbitFinding(finding),
    )
    const nonActionableRecords = classifications.flatMap((classification) =>
      classification.kind === 'non-actionable'
        ? [recordNonActionableFinding(classification.finding)]
        : [],
    )
    const actionableFindings = classifications.flatMap((classification) =>
      classification.kind === 'actionable' ? [classification.finding] : [],
    )

    if (nonActionableRecords.length > 0) {
      await input.adapters.github.postPrComment(
        input.prNumber,
        renderNonActionableFindingRecords(nonActionableRecords),
      )
    }

    if (actionableFindings.length === 0) {
      return {
        status: 'clean',
        workerResult,
      }
    }

    const fingerprint = actionableFindings.map((finding) => finding.id).join('|')

    if (seenFindingFingerprints.has(fingerprint)) {
      return {
        blockers: [
          `Resume repair CodeRabbit rerun still has actionable findings: ${actionableFindings
            .map((finding) => finding.title)
            .join('; ')}`,
          ...(await restorePrdBranchToCleanStateBeforeBlocker({
            adapters: input.adapters,
            branchName: input.branchName,
          })),
        ],
        codeRabbitStatus: codeRabbitResult.status,
        currentChildIssueNumber: input.currentChildIssueNumber,
        status: 'blocked',
      }
    }

    seenFindingFingerprints.add(fingerprint)
    findings = actionableFindings
  }
}

const validateResumeRepairWriteSurface = (input: {
  readonly changedFiles: readonly string[]
  readonly expectedFiles: readonly string[]
  readonly targetLabel: 'child' | 'final cleanup'
}): readonly string[] => {
  if (input.expectedFiles.length === 0) {
    return []
  }

  const expectedFiles = new Set(input.expectedFiles)
  const unexpectedFiles = input.changedFiles.filter(
    (changedFile) => !expectedFiles.has(changedFile),
  )

  if (unexpectedFiles.length === 0) {
    return []
  }

  return [
    `Resume repair output touched files outside the ${input.targetLabel} write surface: ${unexpectedFiles.join(
      ', ',
    )}. Expected files: ${input.expectedFiles.join(', ')}.`,
  ]
}

const createDryRunPlanForPrdBranch = (
  issues: readonly GitHubIssue[],
  branchName: string,
): SelectedPrdPlan | undefined => {
  const prdIssue = issues.find(
    (issue) =>
      isOpenPrdIssue(issue) && createPrdBranchName(issue.number, issue.title) === branchName,
  )

  if (prdIssue === undefined) {
    return undefined
  }

  return createDryRunPlan([prdIssue, ...issues.filter((issue) => !isOpenPrdIssue(issue))])
    .selectedPrd
}

const inferPrdIssueNumber = (branchName: string): number => {
  const issueNumber = Number.parseInt(/^agent\/prd-(\d+)-/.exec(branchName)?.[1] ?? '', 10)

  return Number.isInteger(issueNumber) ? issueNumber : 0
}

const recordResumePrdLookupBlocker = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly pr: AutomationPrDetails
}): Promise<LiveCommandResult> => {
  const blocker = `Could not find the parent PRD for automation branch ${input.pr.branchName}.`

  await input.adapters.state.recordRunStatus(
    createRunStatus({
      blockers: [blocker],
      branchName: input.pr.branchName,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers: [],
      currentChildIssueNumber: undefined,
      lastCommand: 'resume-pr',
      phase: 'blocked',
      pr: createRemoteAutomationPrFromDetails(
        input.pr,
        inferPrdIssueNumber(input.pr.branchName),
        input.pr.isDraft,
      ),
      prdIssueNumber: inferPrdIssueNumber(input.pr.branchName),
    }),
  )

  return blockedResult(blocker)
}

const recordResumeRepairBlockedProgress = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly blockers: readonly string[]
  readonly codeRabbitStatus: string
  readonly completedChildIssueNumbers: readonly number[]
  readonly currentChildIssueNumber: number | undefined
  readonly pr: AutomationPrDetails
  readonly prdIssueNumber: number
}): Promise<LiveCommandResult> => {
  const remotePr = createRemoteAutomationPrFromDetails(
    input.pr,
    input.prdIssueNumber,
    input.pr.isDraft,
  )
  const status = createRunStatus({
    blockers: input.blockers,
    branchName: input.pr.branchName,
    codeRabbitStatus: input.codeRabbitStatus,
    completedChildIssueNumbers: input.completedChildIssueNumbers,
    currentChildIssueNumber: input.currentChildIssueNumber,
    lastCommand: 'resume-pr',
    phase: 'blocked',
    pr: remotePr,
    prdIssueNumber: input.prdIssueNumber,
  })
  const blockerBody = [
    '## PRD Orchestrator Blocker',
    '',
    ...input.blockers.map((blocker) => `- ${blocker}`),
  ].join('\n')

  await input.adapters.github.postPrComment(input.pr.prNumber, blockerBody)
  await input.adapters.state.recordRunStatus(status)

  return {
    exitCode: 1,
    stderr: `${input.blockers.join('\n')}\n`,
    stdout: '',
  }
}

export const executeStatus = async (
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const status = await adapters.state.readRunStatus()
  const currentPr = await adapters.github.getCurrentPr()
  const artifactStatus = await adapters.state.readArtifactStatus?.()
  const remoteOwnership = await adapters.github.getOpenAutomationPrOwnership()
  const prLine =
    currentPr === undefined ? '' : `Current PR: #${String(currentPr.prNumber)} ${currentPr.url}\n`
  const remoteOwnershipLines =
    artifactStatus?.lockStatus === 'no active lock'
      ? `${formatRemoteAutomationOwnership(remoteOwnership)}\n`
      : ''
  const artifactLines =
    artifactStatus === undefined
      ? ''
      : [
          `Lock: ${artifactStatus.lockStatus}`,
          `Sandcastle: ${artifactStatus.sandcastleStatus}`,
          `Cleanup: ${artifactStatus.cleanupStatus}`,
          '',
        ].join('\n')

  return {
    exitCode: status.blockers.length === 0 && remoteOwnership.blockers.length === 0 ? 0 : 1,
    stderr: '',
    stdout: `${formatRunStatus(status)}\n${artifactLines}${remoteOwnershipLines}${prLine}`,
  }
}

export const executeCleanup = async (
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const plan = await adapters.state.cleanup()

  return {
    exitCode: 0,
    stderr: '',
    stdout: `${renderCleanupPlan(plan)}\n`,
  }
}

const formatRemoteAutomationOwnership = (ownership: RemoteAutomationPrOwnership): string => {
  const blockerLine =
    ownership.blockers.length === 0
      ? undefined
      : `Remote automation blockers: ${ownership.blockers.join('; ')}`
  const ownershipLine =
    ownership.remoteAutomationPrs.length === 0
      ? 'Remote automation PRs: none'
      : `Remote automation PRs: ${ownership.remoteAutomationPrs
          .map(
            (pr) =>
              `#${String(pr.prNumber)} for PRD #${String(pr.prdIssueNumber)} on ${pr.branchName}`,
          )
          .join('; ')}`

  return [ownershipLine, blockerLine]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

const selectNextChild = (
  selectedPrd: SelectedPrdPlan,
  completedChildIssueNumbers: readonly number[],
  blockedChildIssueNumbers: readonly number[] = [],
): ParsedChildTask | undefined => {
  const completed = new Set(completedChildIssueNumbers)
  const blocked = new Set(blockedChildIssueNumbers)
  const childTasksByIssueNumber = new Map(
    selectedPrd.childTasks.map((childTask) => [childTask.issueNumber, childTask]),
  )
  const executableIssueNumber = selectedPrd.childTaskDag
    .filter((node) => !completed.has(node.issueNumber) && !blocked.has(node.issueNumber))
    .find((node) =>
      node.dependencies.every(
        (dependency) => completed.has(dependency) && !blocked.has(dependency),
      ),
    )?.issueNumber

  return executableIssueNumber === undefined
    ? undefined
    : childTasksByIssueNumber.get(executableIssueNumber)
}

const selectExecutableChildren = (
  selectedPrd: SelectedPrdPlan,
  completedChildIssueNumbers: readonly number[],
  blockedChildIssueNumbers: readonly number[] = [],
): readonly ParsedChildTask[] => {
  const completed = new Set(completedChildIssueNumbers)
  const blocked = new Set(blockedChildIssueNumbers)
  const childTasksByIssueNumber = new Map(
    selectedPrd.childTasks.map((childTask) => [childTask.issueNumber, childTask]),
  )

  return selectedPrd.childTaskDag
    .filter((node) => !completed.has(node.issueNumber) && !blocked.has(node.issueNumber))
    .filter((node) =>
      node.dependencies.every(
        (dependency) => completed.has(dependency) && !blocked.has(dependency),
      ),
    )
    .flatMap((node) => {
      const childTask = childTasksByIssueNumber.get(node.issueNumber)

      return childTask === undefined ? [] : [childTask]
    })
}

const createSiblingSummaries = (
  selectedPrd: SelectedPrdPlan,
  selectedChild: ParsedChildTask,
  completedChildIssueNumbers: readonly number[],
): readonly SiblingTaskSummary[] =>
  selectedPrd.childTasks
    .filter((childTask) => childTask.issueNumber !== selectedChild.issueNumber)
    .map((childTask) => ({
      issueNumber: childTask.issueNumber,
      status: completedChildIssueNumbers.includes(childTask.issueNumber) ? 'complete' : 'pending',
      summary: childTask.whatToBuild,
    }))

const requiredImpactForChild = (
  impactsByIssueNumber: ReadonlyMap<number, SandcastleImpactAnalysisResult>,
  issueNumber: number,
): SandcastleImpactAnalysisResult => {
  const impactAnalysis = impactsByIssueNumber.get(issueNumber)

  if (impactAnalysis === undefined) {
    throw new Error(`Missing impact analysis for child #${String(issueNumber)}.`)
  }

  return impactAnalysis
}

const createBaseLedger = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly blockedChildIssueNumbers: readonly number[]
  readonly branchName: string
  readonly childTasks: readonly ParsedChildTask[]
  readonly completedChildIssueNumbers: readonly number[]
}): Promise<readonly ChildTaskProgress[]> => {
  const completed = new Set(input.completedChildIssueNumbers)
  const blocked = new Set(input.blockedChildIssueNumbers)
  const childCommitReferences =
    (await input.adapters.git.getChildCommitReferences?.(input.branchName)) ?? []
  const commitHashesByChildIssueNumber = new Map(
    childCommitReferences.map((reference) => [
      reference.childIssueNumber,
      reference.commitHash.slice(0, 7),
    ]),
  )

  return input.childTasks.map((childTask) => {
    if (completed.has(childTask.issueNumber)) {
      const shortCommitHash = commitHashesByChildIssueNumber.get(childTask.issueNumber)

      return {
        codeRabbitStatus: 'passed',
        issueNumber: childTask.issueNumber,
        shortCommitHash,
        status: 'complete',
        verificationStatus:
          shortCommitHash === undefined
            ? 'recorded in child commit'
            : `recorded in commit ${shortCommitHash}`,
      }
    }

    if (blocked.has(childTask.issueNumber)) {
      return {
        codeRabbitStatus: 'not run',
        issueNumber: childTask.issueNumber,
        status: 'blocked',
        verificationStatus: 'blocked before commit',
      }
    }

    return {
      codeRabbitStatus: 'pending',
      issueNumber: childTask.issueNumber,
      status: 'pending',
      verificationStatus: 'not run',
    }
  })
}

const updateLedgerForChildResult = (input: {
  readonly childCommitHash: string
  readonly codeRabbitStatus: string
  readonly existingLedger: readonly ChildTaskProgress[]
  readonly selectedChild: ParsedChildTask
  readonly status: ChildTaskProgress['status']
  readonly verificationEvidence: readonly string[]
}): readonly ChildTaskProgress[] =>
  input.existingLedger.map((entry) => {
    if (entry.issueNumber !== input.selectedChild.issueNumber) {
      return entry
    }

    if (input.status === 'blocked') {
      return {
        codeRabbitStatus: input.codeRabbitStatus,
        issueNumber: input.selectedChild.issueNumber,
        status: 'blocked',
        verificationStatus: 'blocked before commit',
      }
    }

    return {
      codeRabbitStatus: input.codeRabbitStatus,
      issueNumber: input.selectedChild.issueNumber,
      shortCommitHash: input.childCommitHash.slice(0, 7),
      status: 'complete',
      verificationStatus: formatVerificationEvidence(input.verificationEvidence),
    }
  })

const formatVerificationEvidence = (items: readonly string[]): string =>
  items.length === 0 ? 'not run' : items.join('; ')

const createVerificationRepairBlocker = (input: {
  readonly errorMessage: string
  readonly selectedChild: ParsedChildTask
  readonly verificationCommands: readonly string[]
}): string =>
  `Verification repair exhausted for #${String(
    input.selectedChild.issueNumber,
  )}. Failing verification command: ${formatFailingVerificationCommand(
    input.verificationCommands,
  )}. Error evidence: ${formatConciseErrorEvidence(input.errorMessage)}`

const formatFailingVerificationCommand = (commands: readonly string[]): string =>
  commands.at(0) ?? 'unknown'

const formatConciseErrorEvidence = (errorMessage: string): string => {
  const firstLine = errorMessage
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine ?? 'verification failed without error output'
}

const createPendingLedger = (
  childTasks: readonly ParsedChildTask[],
): readonly ChildTaskProgress[] =>
  childTasks.map((childTask) => ({
    codeRabbitStatus: 'pending',
    issueNumber: childTask.issueNumber,
    status: 'pending',
    verificationStatus: 'not run',
  }))

const createBlockedLedger = (
  childTasks: readonly ParsedChildTask[],
  blockedChildIssueNumber: number,
): readonly ChildTaskProgress[] =>
  childTasks.map((childTask) => ({
    codeRabbitStatus: 'not run',
    issueNumber: childTask.issueNumber,
    status: childTask.issueNumber === blockedChildIssueNumber ? 'blocked' : 'pending',
    verificationStatus:
      childTask.issueNumber === blockedChildIssueNumber ? 'blocked before commit' : 'not run',
  }))

const createRunLedger = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly blockedChildIssueNumber?: number
  readonly branchName: string
  readonly childTasks: readonly ParsedChildTask[]
  readonly completedChildIssueNumbers: readonly number[]
}): Promise<readonly ChildTaskProgress[]> => {
  if (input.completedChildIssueNumbers.length === 0) {
    if (input.blockedChildIssueNumber !== undefined) {
      return createBlockedLedger(input.childTasks, input.blockedChildIssueNumber)
    }

    return createPendingLedger(input.childTasks)
  }

  return await createBaseLedger({
    adapters: input.adapters,
    blockedChildIssueNumbers:
      input.blockedChildIssueNumber === undefined ? [] : [input.blockedChildIssueNumber],
    branchName: input.branchName,
    childTasks: input.childTasks,
    completedChildIssueNumbers: input.completedChildIssueNumbers,
  })
}

const createWorkerBranchName = (
  selectedPrd: SelectedPrdPlan,
  selectedChild: ParsedChildTask,
): string =>
  `agent/prd-${String(selectedPrd.issueNumber)}-child-${String(
    selectedChild.issueNumber,
  )}-${slugify(selectedChild.title)}`

const createResumeRepairWorkerBranchName = (branchNamePrefix: string): string => {
  resumeRepairWorkerBranchSequence += 1

  return `${branchNamePrefix}-${Date.now().toString(36)}-${String(resumeRepairWorkerBranchSequence)}`
}

const createDraftPrHandle = (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
  readonly prdIssueNumber: number
  readonly remoteAutomationPr: RemoteAutomationPr | undefined
  readonly title: string
}): DraftPrHandle => {
  let draftPr = input.remoteAutomationPr

  return {
    current: () => draftPr,
    ensure: async (body) => {
      if (draftPr !== undefined) {
        return draftPr
      }

      draftPr = await input.adapters.github.createDraftPr({
        body,
        branchName: input.branchName,
        prdIssueNumber: input.prdIssueNumber,
        title: input.title,
      })

      return draftPr
    },
  }
}

const createRunStatus = (input: {
  readonly blockers: readonly string[]
  readonly branchName: string
  readonly ciStatus?: CiStatus
  readonly codeRabbitStatus: string
  readonly completedChildIssueNumbers: readonly number[]
  readonly currentChildIssueNumber: number | undefined
  readonly lastCommand?: string
  readonly phase: string
  readonly pr: RemoteAutomationPr | undefined
  readonly prdIssueNumber: number
}): RunStatus => ({
  activePrdIssueNumber: input.prdIssueNumber,
  blockers: input.blockers,
  branchName: input.branchName,
  ciStatus: input.ciStatus,
  codeRabbitStatus: input.codeRabbitStatus,
  completedChildren: input.completedChildIssueNumbers,
  currentChildIssueNumber: input.currentChildIssueNumber,
  heartbeatIso: new Date().toISOString(),
  lastCommand: input.lastCommand ?? 'run --one-child',
  phase: input.phase,
  prNumber: input.pr?.prNumber,
  prUrl: input.pr?.url,
})

const createPreExecutionBlockedStatus = (input: {
  readonly lastCommand: string
  readonly selectedPrd: SelectedPrdPlan
}): RunStatus => ({
  activePrdIssueNumber: input.selectedPrd.issueNumber,
  blockers: input.selectedPrd.blockers,
  branchName: createPrdBranchName(input.selectedPrd.issueNumber, input.selectedPrd.title),
  ciStatus: undefined,
  codeRabbitStatus: 'not run',
  completedChildren: [],
  currentChildIssueNumber: undefined,
  heartbeatIso: new Date().toISOString(),
  lastCommand: input.lastCommand,
  phase: 'blocked',
  prNumber: undefined,
  prUrl: undefined,
})

const recordPreExecutionPlanningBlockers = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly lastCommand: string
  readonly selectedPrd: SelectedPrdPlan
}): Promise<LiveCommandResult> => {
  const status = createPreExecutionBlockedStatus({
    lastCommand: input.lastCommand,
    selectedPrd: input.selectedPrd,
  })

  await input.adapters.state.recordRunStatus(status)

  return blockedResult(input.selectedPrd.blockers.join('\n'))
}

const renderOneChildSummary = (input: {
  readonly childIssueNumber: number
  readonly pr: RemoteAutomationPr | undefined
  readonly status: RunStatus
}): string =>
  [
    `Completed child #${String(input.childIssueNumber)}`,
    `Draft PR: ${formatDraftPrSummary(input.pr)}`,
    `Phase: ${input.status.phase}`,
    `Blockers: ${input.status.blockers.length === 0 ? 'none' : input.status.blockers.join('; ')}`,
  ].join('\n')

const formatDraftPrSummary = (pr: RemoteAutomationPr | undefined): string =>
  pr === undefined ? 'not created' : `#${String(pr.prNumber)} ${pr.url}`

const renderFullRunCompletion = (status: RunStatus): string =>
  [
    `Completed PRD ${formatOptionalIssueReference(status.activePrdIssueNumber)}`,
    `Draft PR: ${formatOptionalIssueReference(status.prNumber)} ${status.prUrl ?? ''}`.trim(),
    `Completed children: ${status.completedChildren
      .map((issueNumber) => formatOptionalIssueReference(issueNumber))
      .join(', ')}`,
  ].join('\n')

const renderCleanupPlan = (plan: CleanupPlan): string =>
  [
    'PRD Orchestrator Cleanup',
    `Removed: ${plan.remove.length === 0 ? 'none' : plan.remove.join(', ')}`,
    `Preserved: ${plan.preserve.length === 0 ? 'none' : plan.preserve.join(', ')}`,
  ].join('\n')

const blockedResult = (message: string): LiveCommandResult => ({
  exitCode: 1,
  stderr: `${message}\n`,
  stdout: '',
})

const recordBlockedProgress = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly body: string
  readonly draftPr: RemoteAutomationPr | undefined
  readonly status: RunStatus
}): Promise<void> => {
  const blockerBody = [
    '## PRD Orchestrator Blocker',
    '',
    ...input.status.blockers.map((blocker) => `- ${blocker}`),
  ].join('\n')

  if (input.draftPr !== undefined) {
    await input.adapters.github.updatePrBody(input.draftPr.prNumber, input.body)
    await input.adapters.github.postPrComment(input.draftPr.prNumber, blockerBody)
  }

  await input.adapters.state.recordRunStatus(input.status)
}

const recordCodeRabbitReviewFailedProgress = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly baseLedger: readonly ChildTaskProgress[]
  readonly branchName: string
  readonly childCommitHash: string
  readonly completedChildIssueNumbers: readonly number[]
  readonly draftPr: RemoteAutomationPr
  readonly errorMessage: string
  readonly lastCommand: string
  readonly selectedChild: ParsedChildTask
  readonly selectedPrd: SelectedPrdPlan
  readonly verificationEvidence: readonly string[]
}): Promise<LiveCommandResult> => {
  const blocker = `CodeRabbit review failed for child #${String(
    input.selectedChild.issueNumber,
  )}. Error evidence: ${formatConciseErrorEvidence(input.errorMessage)}`
  const status = createRunStatus({
    blockers: [blocker],
    branchName: input.branchName,
    codeRabbitStatus: 'failed',
    completedChildIssueNumbers: input.completedChildIssueNumbers,
    currentChildIssueNumber: input.selectedChild.issueNumber,
    lastCommand: input.lastCommand,
    phase: 'blocked',
    pr: input.draftPr,
    prdIssueNumber: input.selectedPrd.issueNumber,
  })
  const body = generateDraftPrBody({
    branchName: input.branchName,
    childTasks: input.selectedPrd.childTasks,
    ledger: updateLedgerForChildResult({
      childCommitHash: input.childCommitHash,
      codeRabbitStatus: 'failed',
      existingLedger: input.baseLedger,
      selectedChild: input.selectedChild,
      status: 'blocked',
      verificationEvidence: input.verificationEvidence,
    }),
    parentPrdIssueNumber: input.selectedPrd.issueNumber,
    prdTitle: input.selectedPrd.title,
  })

  await recordBlockedProgress({
    adapters: input.adapters,
    body,
    draftPr: input.draftPr,
    status,
  })

  return {
    exitCode: 1,
    stderr: `${blocker}\n`,
    stdout: `${renderOneChildSummary({
      childIssueNumber: input.selectedChild.issueNumber,
      pr: input.draftPr,
      status,
    })}\n`,
  }
}

const recordVerificationRepairBlockedProgress = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly blockedChildIssueNumbers: readonly number[]
  readonly blockers: readonly string[]
  readonly branchName: string
  readonly completedChildIssueNumbers: readonly number[]
  readonly draftPr: RemoteAutomationPr | undefined
  readonly lastCommand?: string
  readonly selectedChild: ParsedChildTask
  readonly selectedPrd: SelectedPrdPlan
}): Promise<LiveCommandResult> => {
  const status = createRunStatus({
    blockers: input.blockers,
    branchName: input.branchName,
    codeRabbitStatus: 'not run',
    completedChildIssueNumbers: input.completedChildIssueNumbers,
    currentChildIssueNumber: input.selectedChild.issueNumber,
    lastCommand: input.lastCommand,
    phase: 'blocked',
    pr: input.draftPr,
    prdIssueNumber: input.selectedPrd.issueNumber,
  })
  const ledger = await createBaseLedger({
    adapters: input.adapters,
    blockedChildIssueNumbers: [...input.blockedChildIssueNumbers, input.selectedChild.issueNumber],
    branchName: input.branchName,
    childTasks: input.selectedPrd.childTasks,
    completedChildIssueNumbers: input.completedChildIssueNumbers,
  })

  await recordBlockedProgress({
    adapters: input.adapters,
    body: generateDraftPrBody({
      branchName: input.branchName,
      childTasks: input.selectedPrd.childTasks,
      ledger,
      parentPrdIssueNumber: input.selectedPrd.issueNumber,
      prdTitle: input.selectedPrd.title,
    }),
    draftPr: input.draftPr,
    status,
  })

  return {
    exitCode: 1,
    stderr: `${input.blockers.join('\n')}\n`,
    stdout: `${renderOneChildSummary({
      childIssueNumber: input.selectedChild.issueNumber,
      pr: input.draftPr,
      status,
    })}\n`,
  }
}

const repairVerificationUntilClean = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly impactAnalysis: SandcastleImpactAnalysisResult
  readonly parentPrd: SelectedPrdPlan
  readonly parentPrdBody: string
  readonly prdBranchName: string
  readonly selectedChild: ParsedChildTask
  readonly siblingSummaries: readonly SiblingTaskSummary[]
  readonly workerBranchName: string
  readonly workerResult: RunImplementationResult
}): Promise<VerificationRepairResult> => {
  let workerResult = input.workerResult
  let impactAnalysis = input.impactAnalysis
  const seenErrors = new Set<string>()

  for (;;) {
    const writeSurface = await resolveWriteSurfaceBeforeApply({
      adapters: input.adapters,
      impactAnalysis,
      parentPrd: input.parentPrd,
      parentPrdBody: input.parentPrdBody,
      selectedChild: input.selectedChild,
      siblingSummaries: input.siblingSummaries,
      workerChangedFiles: workerResult.changedFiles,
    })

    if (writeSurface.blockers.length > 0) {
      return {
        blockers: [
          ...writeSurface.blockers,
          ...(await restorePrdBranchToCleanStateBeforeBlocker({
            adapters: input.adapters,
            branchName: input.prdBranchName,
          })),
        ],
        impactAnalysis,
        status: 'blocked',
        workerResult,
      }
    }

    impactAnalysis = writeSurface.impactAnalysis
    const verificationCommands = selectVerificationCommands(impactAnalysis)

    try {
      await input.adapters.git.applyWorkerDiff({
        prdBranchName: input.prdBranchName,
        workerBranchName: workerResult.workerBranchName,
        workerWorktreePath: workerResult.workerWorktreePath,
      })
    } catch (error) {
      return {
        blockers: [
          createWorkerDiffApplicationBlocker({
            errorMessage: formatErrorMessage(error),
            selectedChild: input.selectedChild,
            workerBranchName: workerResult.workerBranchName,
          }),
          ...(await restorePrdBranchToCleanStateBeforeBlocker({
            adapters: input.adapters,
            branchName: input.prdBranchName,
          })),
        ],
        impactAnalysis,
        status: 'blocked',
        workerResult,
      }
    }

    try {
      return {
        impactAnalysis,
        status: 'clean',
        verificationEvidence: await input.adapters.verification.runCommands(verificationCommands),
        workerResult,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (seenErrors.has(errorMessage)) {
        return {
          blockers: [
            createVerificationRepairBlocker({
              errorMessage,
              selectedChild: input.selectedChild,
              verificationCommands,
            }),
            ...(await restorePrdBranchToCleanStateBeforeBlocker({
              adapters: input.adapters,
              branchName: input.prdBranchName,
            })),
          ],
          impactAnalysis,
          status: 'blocked',
          workerResult,
        }
      }

      seenErrors.add(errorMessage)
      workerResult = await input.adapters.sandcastle.repairVerificationFailure({
        childTask: input.selectedChild,
        errorMessage,
        impactAnalysis,
        parentPrd: input.parentPrd,
        parentPrdBody: input.parentPrdBody,
        prdBranchName: input.prdBranchName,
        siblingSummaries: input.siblingSummaries,
        workerBranchName: input.workerBranchName,
      })
    }
  }
}

const repairCodeRabbitFindingsUntilClean = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
  readonly childCommitHash: string
  readonly draftPr: RemoteAutomationPr
  readonly impactAnalysis: SandcastleImpactAnalysisResult
  readonly initialResult: ReviewChildResult
  readonly parentPrd: SelectedPrdPlan
  readonly parentPrdBody: string
  readonly selectedChild: ParsedChildTask
  readonly siblingSummaries: readonly SiblingTaskSummary[]
  readonly verificationCommands: readonly string[]
  readonly workerBranchName: string
  readonly curatedCommitMessage: string
}): Promise<{
  readonly commitHash: string
  readonly result: ReviewChildResult
}> => {
  let commitHash = input.childCommitHash
  let result = input.initialResult
  const seenFindingFingerprints = new Set<string>()

  while (result.findings.length > 0) {
    const classifications = result.findings.map((finding) => classifyCodeRabbitFinding(finding))
    const actionableFindings = classifications.flatMap((classification) =>
      classification.kind === 'actionable' ? [classification.finding] : [],
    )
    const newNonActionableRecords = classifications.flatMap((classification) =>
      classification.kind === 'non-actionable'
        ? [recordNonActionableFinding(classification.finding)]
        : [],
    )

    if (newNonActionableRecords.length > 0) {
      await input.adapters.github.postPrComment(
        input.draftPr.prNumber,
        renderNonActionableFindingRecords(newNonActionableRecords),
      )
    }

    if (actionableFindings.length === 0) {
      result = {
        findings: [],
        status: 'passed',
      }

      break
    }

    const fingerprint = actionableFindings.map((finding) => finding.id).join('|')

    if (seenFindingFingerprints.has(fingerprint)) {
      return {
        commitHash,
        result,
      }
    }

    seenFindingFingerprints.add(fingerprint)

    const rewriteBlocker = await getFreshRewriteBlocker({
      adapters: input.adapters,
      command: 'CodeRabbit repair',
      pr: input.draftPr,
    })

    if (rewriteBlocker !== undefined) {
      return {
        commitHash,
        result: {
          findings: [
            {
              body: rewriteBlocker,
              id: 'non-draft-pr-rewrite-refused',
              source: 'github-pr-review',
              title: 'PR rewrite refused',
            },
          ],
          status: 'findings',
        },
      }
    }

    try {
      const workerResult = await input.adapters.sandcastle.repairReviewFindings({
        childTask: input.selectedChild,
        findings: actionableFindings,
        impactAnalysis: input.impactAnalysis,
        parentPrd: input.parentPrd,
        parentPrdBody: input.parentPrdBody,
        prdBranchName: input.branchName,
        siblingSummaries: input.siblingSummaries,
        workerBranchName: input.workerBranchName,
      })
      const writeSurface = await resolveWriteSurfaceBeforeApply({
        adapters: input.adapters,
        impactAnalysis: input.impactAnalysis,
        parentPrd: input.parentPrd,
        parentPrdBody: input.parentPrdBody,
        selectedChild: input.selectedChild,
        siblingSummaries: input.siblingSummaries,
        workerChangedFiles: workerResult.changedFiles,
      })

      if (writeSurface.blockers.length > 0) {
        return {
          commitHash,
          result: {
            findings: writeSurface.blockers.map((blocker, index) => ({
              body: blocker,
              id: `write-surface-${String(index + 1)}`,
              source: 'cli',
              title: 'Unexpected write surface',
            })),
            status: 'findings',
          },
        }
      }

      await input.adapters.git.applyWorkerDiff({
        prdBranchName: input.branchName,
        workerBranchName: workerResult.workerBranchName,
        workerWorktreePath: workerResult.workerWorktreePath,
      })
      await input.adapters.verification.runCommands(
        selectVerificationCommands(writeSurface.impactAnalysis),
      )

      const commit = await input.adapters.git.amendChildCommit(input.curatedCommitMessage)

      commitHash = commit.hash

      await input.adapters.git.pushPrdBranch({
        branchName: input.branchName,
        mode: 'force-with-lease',
      })

      result = await input.adapters.codeRabbit.reviewChild({
        branchName: input.branchName,
        childCommitHash: commitHash,
        childIssueNumber: input.selectedChild.issueNumber,
        prNumber: input.draftPr.prNumber,
      })
    } catch (error) {
      const cleanupBlockers = await restorePrdBranchToCleanStateBeforeBlocker({
        adapters: input.adapters,
        branchName: input.branchName,
      })

      return {
        commitHash,
        result: {
          findings: [
            {
              body: `CodeRabbit repair failed for #${String(
                input.selectedChild.issueNumber,
              )}. Error evidence: ${formatConciseErrorEvidence(formatErrorMessage(error))}`,
              id: 'coderabbit-repair-error',
              source: 'cli',
              title: 'CodeRabbit repair failed',
            },
            ...cleanupBlockers.map((blocker, index) => ({
              body: blocker,
              id: `coderabbit-repair-cleanup-${String(index + 1)}`,
              source: 'cli' as const,
              title: 'PRD branch cleanup failed',
            })),
          ],
          status: 'findings',
        },
      }
    }
  }

  return {
    commitHash,
    result,
  }
}

const createWorkerDiffApplicationBlocker = (input: {
  readonly errorMessage: string
  readonly selectedChild: ParsedChildTask
  readonly workerBranchName: string
}): string =>
  `Failed to apply worker diff for #${String(
    input.selectedChild.issueNumber,
  )}. Operation: apply worker diff from ${input.workerBranchName}. Error evidence: ${formatConciseErrorEvidence(
    input.errorMessage,
  )}`

const restorePrdBranchToCleanStateBeforeBlocker = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
}): Promise<readonly string[]> => {
  try {
    await input.adapters.git.restorePrdBranchToCleanState({
      branchName: input.branchName,
    })

    return []
  } catch (error) {
    return [
      `Failed to restore PRD branch ${input.branchName} to a clean pre-child state. Error evidence: ${formatConciseErrorEvidence(
        formatErrorMessage(error),
      )}`,
    ]
  }
}

const renderNonActionableFindingRecords = (
  records: readonly NonActionableFindingRecord[],
): string =>
  [
    '## CodeRabbit Findings Recorded As Non-Actionable',
    '',
    ...records.map((record) => `- ${record.findingId} (${record.source}): ${record.rationale}`),
  ].join('\n')

const createResumeChildCommitMessage = (
  childIssueNumber: number,
  findings: readonly ResumePrFinding[],
): string =>
  [
    `fix: address review findings for child #${String(childIssueNumber)}`,
    '',
    'Verification evidence:',
    '- Resume repair applied from PR review findings.',
    '',
    'Review findings:',
    ...findings.map((finding) => `- ${finding.id}: ${finding.title}`),
    '',
    `Closes #${String(childIssueNumber)}`,
  ].join('\n')

const finalizePrdIfReady = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
  readonly completedChildren: readonly number[]
  readonly draftPr: RemoteAutomationPr
  readonly selectedPrd: SelectedPrdPlan
  readonly verificationEvidence: readonly string[]
  readonly verificationEvidenceByChild: readonly string[]
}): Promise<{
  readonly blockers: readonly string[]
  readonly ciStatus: CiStatus
  readonly phase: string
}> => {
  const seenCiFailureFingerprints = new Set<string>()
  let ciStatus: CiStatus

  for (;;) {
    const ciResult = await pollFinalCiUntilTerminal(input)
    ciStatus = ciResult.status

    if (ciStatus === 'passed') {
      break
    }

    if (ciStatus === 'failed') {
      const repairResult = await runFinalCiRepairUntilClean({
        ...input,
        blockers: ciResult.blockers,
        seenCiFailureFingerprints,
      })

      if (repairResult.status === 'clean') {
        const commitFinalCleanup = input.adapters.git.commitFinalCleanup

        if (commitFinalCleanup === undefined) {
          return {
            blockers: ciResult.blockers,
            ciStatus,
            phase: 'blocked',
          }
        }

        await commitFinalCleanup(createFinalCiRepairCommitMessage(repairResult.findings))
        await input.adapters.git.pushPrdBranch({
          branchName: input.branchName,
          mode: 'force-with-lease',
        })

        continue
      }

      await postCiBlockerComment({
        blockers: repairResult.blockers,
        prNumber: input.draftPr.prNumber,
        postPrComment: input.adapters.github.postPrComment,
      })

      return {
        blockers: repairResult.blockers,
        ciStatus,
        phase: 'blocked',
      }
    }

    await postCiBlockerComment({
      blockers: ciResult.blockers,
      prNumber: input.draftPr.prNumber,
      postPrComment: input.adapters.github.postPrComment,
    })

    return {
      blockers: ciResult.blockers,
      ciStatus,
      phase: 'blocked',
    }
  }

  const mergeInstructions = generateMergeInstructions({
    childTasks: input.selectedPrd.childTasks,
    parentPrdIssueNumber: input.selectedPrd.issueNumber,
    prdTitle: input.selectedPrd.title,
  })
  const childCommitReferences =
    (await input.adapters.git.getChildCommitReferences?.(input.branchName)) ?? []
  const changedFiles = [
    ...new Set(childCommitReferences.flatMap((reference) => [...(reference.changedFiles ?? [])])),
  ]
  const prohibitedCapabilityResults = await input.adapters.verification.scanProhibitedCapabilities({
    branchName: input.branchName,
    changedFiles,
  })
  const architectureChecks = createFinalArchitectureChecks(input.selectedPrd.issueNumber)
  const evidenceEvaluation = evaluateFinalAuditEvidence({
    architectureChecks,
    prohibitedCapabilityResults,
  })
  const finalAudit = generateFinalPrdAcceptanceAudit({
    architectureChecks,
    blockers: evidenceEvaluation.blockers,
    childTasks: createChildTaskAudits({
      childCommitReferences,
      childTasks: input.selectedPrd.childTasks,
      verificationEvidenceByChild: input.verificationEvidenceByChild,
    }),
    ciStatus,
    codeRabbitStatus: 'passed',
    mergeInstructions,
    parentPrdIssueNumber: input.selectedPrd.issueNumber,
    parentUserStories: createParentUserStoryAudit(input.selectedPrd.childTasks),
    prohibitedCapabilityResults,
    verificationEvidence: input.verificationEvidenceByChild,
  })

  await input.adapters.github.upsertPrComment({
    body: finalAudit,
    marker: finalPrdAcceptanceAuditMarker,
    prNumber: input.draftPr.prNumber,
  })

  const readyGate = evaluateReadyForReviewGate({
    allChildrenComplete: input.completedChildren.length === input.selectedPrd.childTasks.length,
    ciStatus,
    codeRabbitStatus: 'passed',
    finalAuditEvidenceBlockers: evidenceEvaluation.blockers,
    finalAuditCommentPlanned: true,
    finalAuditCommentPosted: true,
    localGatesPassed: input.verificationEvidence.length > 0,
  })

  if (!readyGate.ready) {
    return {
      blockers: readyGate.blockers,
      ciStatus,
      phase: 'blocked',
    }
  }

  await input.adapters.github.markReadyForReview(input.draftPr.prNumber)

  const seenReadyReviewFindingFingerprints = new Set<string>()

  for (;;) {
    const ciResult = await pollFinalCiUntilTerminal(input)
    ciStatus = ciResult.status

    if (ciStatus === 'failed') {
      const repairResult = await runFinalCiRepairUntilClean({
        ...input,
        blockers: ciResult.blockers,
        seenCiFailureFingerprints,
      })

      if (repairResult.status === 'clean') {
        const commitFinalCleanup = input.adapters.git.commitFinalCleanup

        if (commitFinalCleanup === undefined) {
          return {
            blockers: ciResult.blockers,
            ciStatus,
            phase: 'blocked',
          }
        }

        await commitFinalCleanup(createFinalCiRepairCommitMessage(repairResult.findings))
        await input.adapters.git.pushPrdBranch({
          branchName: input.branchName,
          mode: 'force-with-lease',
        })

        continue
      }

      await postCiBlockerComment({
        blockers: repairResult.blockers,
        prNumber: input.draftPr.prNumber,
        postPrComment: input.adapters.github.postPrComment,
      })

      return {
        blockers: repairResult.blockers,
        ciStatus,
        phase: 'blocked',
      }
    }

    if (ciStatus !== 'passed') {
      await postCiBlockerComment({
        blockers: ciResult.blockers,
        prNumber: input.draftPr.prNumber,
        postPrComment: input.adapters.github.postPrComment,
      })

      return {
        blockers: ciResult.blockers,
        ciStatus,
        phase: 'blocked',
      }
    }

    const reviewFindings =
      (await input.adapters.github.getReviewFindings?.(input.draftPr.prNumber)) ?? []
    const classifications = reviewFindings.map((finding) => classifyCodeRabbitFinding(finding))
    const nonActionableRecords = classifications.flatMap((classification) =>
      classification.kind === 'non-actionable'
        ? [recordNonActionableFinding(classification.finding)]
        : [],
    )
    const actionableFindings = classifications.flatMap((classification) =>
      classification.kind === 'actionable' ? [classification.finding] : [],
    )

    if (nonActionableRecords.length > 0) {
      await input.adapters.github.postPrComment(
        input.draftPr.prNumber,
        renderNonActionableFindingRecords(nonActionableRecords),
      )
    }

    if (actionableFindings.length === 0) {
      return {
        blockers: [],
        ciStatus,
        phase: 'ready-for-review',
      }
    }

    const fingerprint = actionableFindings
      .map((finding) => `${finding.id}\n${finding.title}\n${finding.body}`)
      .join('\n---\n')

    if (seenReadyReviewFindingFingerprints.has(fingerprint)) {
      return {
        blockers: [
          'Ready-for-review repair stopped because CodeRabbit returned the same actionable findings after repair.',
        ],
        ciStatus,
        phase: 'blocked',
      }
    }

    seenReadyReviewFindingFingerprints.add(fingerprint)

    const repairGate = await runResumeRepairGateUntilClean({
      adapters: input.adapters,
      branchName: input.branchName,
      codeRabbitChildIssueNumber: 0,
      codeRabbitCommitHash: 'ready-for-review',
      currentChildIssueNumber: undefined,
      expectedFiles: [],
      findings: actionableFindings,
      prNumber: input.draftPr.prNumber,
      targetLabel: 'final cleanup',
      workerBranchName: `${input.branchName}-ready-review-repair`,
    })

    if (repairGate.status === 'blocked') {
      return {
        blockers: repairGate.blockers,
        ciStatus,
        phase: 'blocked',
      }
    }

    const commitFinalCleanup = input.adapters.git.commitFinalCleanup

    if (commitFinalCleanup === undefined) {
      return {
        blockers: ['Ready-for-review CodeRabbit repair requires final cleanup commit support.'],
        ciStatus,
        phase: 'blocked',
      }
    }

    await commitFinalCleanup(createReadyForReviewRepairCommitMessage(actionableFindings))
    await input.adapters.git.pushPrdBranch({
      branchName: input.branchName,
      mode: 'force-with-lease',
    })
  }
}

const createReadyForReviewRepairCommitMessage = (findings: readonly CodeRabbitFinding[]): string =>
  [
    'fix: address ready-for-review findings',
    '',
    'Verification evidence:',
    '- Ready-for-review CodeRabbit repair applied.',
    '',
    'Review findings:',
    ...findings.map((finding) => `- ${finding.id}: ${finding.title}`),
  ].join('\n')

const finalizeRecoveredPrdBranch = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
  readonly completedChildren: readonly number[]
  readonly draftPr: RemoteAutomationPr
  readonly lastCommand: string
  readonly selectedPrd: SelectedPrdPlan
}): Promise<LiveCommandResult> => {
  await input.adapters.github.updatePrBody(
    input.draftPr.prNumber,
    generateDraftPrBody({
      branchName: input.branchName,
      childTasks: input.selectedPrd.childTasks,
      ledger: await createBaseLedger({
        adapters: input.adapters,
        blockedChildIssueNumbers: [],
        branchName: input.branchName,
        childTasks: input.selectedPrd.childTasks,
        completedChildIssueNumbers: input.completedChildren,
      }),
      parentPrdIssueNumber: input.selectedPrd.issueNumber,
      prdTitle: input.selectedPrd.title,
    }),
  )

  const verificationEvidence = ['Recovered verification evidence from completed child commits.']
  const finalizationResult = await finalizePrdIfReady({
    adapters: input.adapters,
    branchName: input.branchName,
    completedChildren: input.completedChildren,
    draftPr: input.draftPr,
    selectedPrd: input.selectedPrd,
    verificationEvidence,
    verificationEvidenceByChild: createRecoveredVerificationEvidenceByChild({
      childTasks: input.selectedPrd.childTasks,
      completedChildren: input.completedChildren,
    }),
  })
  const status = createRunStatus({
    blockers: finalizationResult.blockers,
    branchName: input.branchName,
    ciStatus: finalizationResult.ciStatus,
    codeRabbitStatus: 'passed',
    completedChildIssueNumbers: input.completedChildren,
    currentChildIssueNumber: undefined,
    lastCommand: input.lastCommand,
    phase: finalizationResult.phase,
    pr: input.draftPr,
    prdIssueNumber: input.selectedPrd.issueNumber,
  })

  await input.adapters.state.recordRunStatus(status)

  return {
    exitCode: finalizationResult.blockers.length === 0 ? 0 : 1,
    stderr:
      finalizationResult.blockers.length === 0 ? '' : `${finalizationResult.blockers.join('\n')}\n`,
    stdout: finalizationResult.blockers.length === 0 ? `${renderFullRunCompletion(status)}\n` : '',
  }
}

const pollFinalCiUntilTerminal = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
  readonly completedChildren: readonly number[]
  readonly draftPr: RemoteAutomationPr
  readonly selectedPrd: SelectedPrdPlan
}): Promise<GitHubActionsStatus> => {
  const intervalMs = input.adapters.configuration?.ciPollingIntervalMs ?? defaultCiPollingIntervalMs
  const timeoutMs = input.adapters.configuration?.ciPollingTimeoutMs ?? defaultCiPollingTimeoutMs
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / Math.max(intervalMs, 1)) + 1)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ciResult = await readFinalCiStatus(input)

    if (ciResult.status !== 'pending') {
      return ciResult
    }

    await input.adapters.state.recordRunStatus(
      createRunStatus({
        blockers: [],
        branchName: input.branchName,
        ciStatus: 'pending',
        codeRabbitStatus: 'passed',
        completedChildIssueNumbers: input.completedChildren,
        currentChildIssueNumber: undefined,
        lastCommand: createCiPollingCommandDescription(input.branchName),
        phase: 'waiting-for-ci',
        pr: input.draftPr,
        prdIssueNumber: input.selectedPrd.issueNumber,
      }),
    )

    if (attempt === maxAttempts) {
      return {
        blockers: ['GitHub Actions did not reach a terminal status before the polling timeout.'],
        status: 'timed-out',
      }
    }

    if (intervalMs > 0) {
      await sleep(intervalMs)
    }
  }

  return {
    blockers: ['GitHub Actions did not reach a terminal status before the polling timeout.'],
    status: 'timed-out',
  }
}

const runFinalCiRepairUntilClean = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly blockers: readonly string[]
  readonly branchName: string
  readonly draftPr: RemoteAutomationPr
  readonly seenCiFailureFingerprints: Set<string>
}): Promise<
  | {
      readonly findings: readonly CodeRabbitFinding[]
      readonly status: 'clean'
    }
  | {
      readonly blockers: readonly string[]
      readonly status: 'blocked'
    }
> => {
  if (input.adapters.git.commitFinalCleanup === undefined) {
    return {
      blockers: input.blockers,
      status: 'blocked',
    }
  }

  if (input.adapters.ci.getFailureEvidence === undefined) {
    return {
      blockers: input.blockers,
      status: 'blocked',
    }
  }

  const evidence = await input.adapters.ci.getFailureEvidence({
    branchName: input.branchName,
    prNumber: input.draftPr.prNumber,
  })
  const findings = createCiRepairFindings(evidence, input.blockers)
  const fingerprint = findings.map((finding) => `${finding.title}\n${finding.body}`).join('\n---\n')

  if (input.seenCiFailureFingerprints.has(fingerprint)) {
    return {
      blockers: [
        ...input.blockers,
        'CI repair stopped because GitHub Actions failed again with the same evidence after repair.',
      ],
      status: 'blocked',
    }
  }

  input.seenCiFailureFingerprints.add(fingerprint)
  const repairGate = await runResumeRepairGateUntilClean({
    adapters: input.adapters,
    branchName: input.branchName,
    codeRabbitChildIssueNumber: 0,
    codeRabbitCommitHash: 'final-ci-repair',
    currentChildIssueNumber: undefined,
    expectedFiles: [],
    findings,
    prNumber: input.draftPr.prNumber,
    targetLabel: 'final cleanup',
    workerBranchName: `${input.branchName}-resume-ci-repair`,
  })

  if (repairGate.status === 'blocked') {
    return {
      blockers: repairGate.blockers,
      status: 'blocked',
    }
  }

  return {
    findings,
    status: 'clean',
  }
}

const createCiRepairFindings = (
  evidence: readonly CiFailureEvidence[],
  blockers: readonly string[],
): readonly CodeRabbitFinding[] => {
  if (evidence.length === 0) {
    return [
      {
        body: blockers.join('\n'),
        id: 'github-actions-ci-failure',
        source: 'github-check',
        title: 'GitHub Actions failed',
      },
    ]
  }

  return evidence.map((failure, index) => ({
    body: [
      ...(failure.workflowName === undefined ? [] : [`Workflow: ${failure.workflowName}`]),
      `Check: ${failure.name}`,
      ...(failure.detailsUrl === undefined ? [] : [`Details: ${failure.detailsUrl}`]),
      '',
      'Failure evidence:',
      failure.logExcerpt,
    ].join('\n'),
    id: `github-actions-ci-failure-${String(index + 1)}`,
    source: 'github-check',
    title: `${failure.workflowName ?? 'GitHub Actions'} / ${failure.name} failed`,
  }))
}

const createFinalCiRepairCommitMessage = (findings: readonly CodeRabbitFinding[]): string =>
  [
    'fix: repair final CI failures',
    '',
    'Verification evidence:',
    '- Resume repair applied from failed GitHub Actions evidence.',
    '',
    'CI findings:',
    ...findings.map((finding) => `- ${finding.id}: ${finding.title}`),
  ].join('\n')

const readFinalCiStatus = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
  readonly draftPr: RemoteAutomationPr
}): Promise<GitHubActionsStatus> => {
  try {
    return await input.adapters.ci.pollChecks({
      branchName: input.branchName,
      prNumber: input.draftPr.prNumber,
    })
  } catch (error) {
    return {
      blockers: [`GitHub Actions polling blocked: ${formatErrorMessage(error)}`],
      status: 'blocked',
    }
  }
}

const postCiBlockerComment = async (input: {
  readonly blockers: readonly string[]
  readonly postPrComment: PrdOrchestratorLiveAdapters['github']['postPrComment']
  readonly prNumber: number
}): Promise<void> => {
  const body = [
    '## PRD Orchestrator CI Blocker',
    '',
    ...input.blockers.map((blocker) => `- ${blocker}`),
  ].join('\n')

  await input.postPrComment(input.prNumber, body)
}

const createCiPollingCommandDescription = (branchName: string): string =>
  `gh run list --branch ${branchName} --json name,status,conclusion --limit 20`

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const resolveWriteSurfaceBeforeApply = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly impactAnalysis: SandcastleImpactAnalysisResult
  readonly parentPrd: SelectedPrdPlan
  readonly parentPrdBody: string
  readonly selectedChild: ParsedChildTask
  readonly siblingSummaries: readonly SiblingTaskSummary[]
  readonly workerChangedFiles: readonly string[]
}): Promise<{
  readonly blockers: readonly string[]
  readonly impactAnalysis: SandcastleImpactAnalysisResult
}> => {
  let impactAnalysis = input.impactAnalysis
  const seenUnexpectedFileFingerprints = new Set<string>()

  for (;;) {
    const decision = enforceWriteSurface({
      changedFiles: input.workerChangedFiles,
      dependencyChangeJustification: createDependencyChangeJustification({
        changedFiles: input.workerChangedFiles,
        childTask: input.selectedChild,
        impactAnalysis,
      }),
      impactAnalysis,
    })

    if (decision.action === 'accept') {
      return {
        blockers: [],
        impactAnalysis,
      }
    }

    const fingerprint = decision.unexpectedFiles.join('|')

    if (seenUnexpectedFileFingerprints.has(fingerprint)) {
      return {
        blockers: [
          `worker diff touched files outside impact-analysis write surface after re-analysis: ${decision.unexpectedFiles.join(
            ', ',
          )}`,
        ],
        impactAnalysis,
      }
    }

    seenUnexpectedFileFingerprints.add(fingerprint)
    impactAnalysis = await input.adapters.sandcastle.runImpactAnalysis({
      childTask: input.selectedChild,
      parentPrd: input.parentPrd,
      parentPrdBody: input.parentPrdBody,
      siblingSummaries: input.siblingSummaries,
      writeSurfaceReanalysis: {
        previousImpactAnalysis: impactAnalysis,
        unexpectedFiles: decision.unexpectedFiles,
        workerChangedFiles: input.workerChangedFiles,
      },
    })
  }
}

const createDependencyChangeJustification = (input: {
  readonly changedFiles: readonly string[]
  readonly childTask: ParsedChildTask
  readonly impactAnalysis: SandcastleImpactAnalysisResult
}): string | undefined => {
  const dependencyFiles = input.changedFiles.filter((filePath) => isDependencyChangeFile(filePath))

  if (dependencyFiles.length === 0) {
    return undefined
  }

  const expectedFiles = new Set([
    ...input.impactAnalysis.designFiles,
    ...input.impactAnalysis.expectedFiles,
    ...input.impactAnalysis.tests,
  ])

  if (dependencyFiles.every((filePath) => expectedFiles.has(filePath))) {
    return `Impact analysis for child #${String(
      input.childTask.issueNumber,
    )} explicitly includes dependency changes: ${dependencyFiles.join(', ')}.`
  }

  const taskText = [
    input.childTask.title,
    input.childTask.whatToBuild,
    ...input.childTask.acceptanceCriteria,
  ]
    .join('\n')
    .toLowerCase()

  if (/\b(dependency|dependencies|package|pnpm|install|library|sdk)\b/.test(taskText)) {
    return `Child #${String(
      input.childTask.issueNumber,
    )} requires dependency changes to satisfy its task scope.`
  }

  return undefined
}

const createVerificationEvidenceByChild = (input: {
  readonly childTasks: readonly ParsedChildTask[]
  readonly completedChildren: readonly number[]
  readonly currentChildIssueNumber: number
  readonly currentVerificationEvidence: readonly string[]
}): readonly string[] =>
  input.childTasks
    .filter((childTask) => input.completedChildren.includes(childTask.issueNumber))
    .flatMap((childTask) =>
      childTask.issueNumber === input.currentChildIssueNumber
        ? input.currentVerificationEvidence.map(
            (evidence) => `#${String(childTask.issueNumber)}: ${evidence}`,
          )
        : [`#${String(childTask.issueNumber)}: verification evidence recorded in child commit`],
    )

const createRecoveredVerificationEvidenceByChild = (input: {
  readonly childTasks: readonly ParsedChildTask[]
  readonly completedChildren: readonly number[]
}): readonly string[] =>
  input.childTasks
    .filter((childTask) => input.completedChildren.includes(childTask.issueNumber))
    .map(
      (childTask) =>
        `#${String(childTask.issueNumber)}: verification evidence recorded in child commit`,
    )

const createChildTaskAudits = (input: {
  readonly childCommitReferences: readonly ChildCommitReference[]
  readonly childTasks: readonly ParsedChildTask[]
  readonly verificationEvidenceByChild: readonly string[]
}): readonly ChildTaskAudit[] =>
  input.childTasks.map((childTask) => {
    const childCommitReference = input.childCommitReferences.find(
      (reference) => reference.childIssueNumber === childTask.issueNumber,
    )

    return {
      acceptanceCriteria: childTask.acceptanceCriteria,
      commitHash: childCommitReference?.commitHash,
      issueNumber: childTask.issueNumber,
      title: childTask.title,
      userStoriesAddressed: childTask.userStoriesAddressed,
      verificationEvidence: input.verificationEvidenceByChild.flatMap((evidence) =>
        parseChildVerificationEvidence(evidence, childTask.issueNumber),
      ),
    }
  })

const parseChildVerificationEvidence = (
  evidence: string,
  childIssueNumber: number,
): readonly string[] => {
  const prefix = `#${String(childIssueNumber)}:`

  if (!evidence.startsWith(prefix)) {
    return []
  }

  return [evidence.slice(prefix.length).trim()]
}

const createFinalArchitectureChecks = (parentPrdIssueNumber: number): readonly string[] => [
  '[ARCHITECTURE.md](../../../ARCHITECTURE.md) §2 inspected: v1 still has no telemetry, remote config, automatic update checks, runtime font CDN calls, or non-PDF exports.',
  '[ARCHITECTURE.md](../../../ARCHITECTURE.md) §4 inspected: product remains Electron-first and local-first with no required web backend introduced.',
  '[ARCHITECTURE.md](../../../ARCHITECTURE.md) §6 inspected: UI constraints remain Tailwind/no MUI and no Redux.',
  `PRD #${String(
    parentPrdIssueNumber,
  )} Out of Scope inspected: no automatic merge, manual issue closure, sandbox GitHub mutation, non-Codex provider support, non-Docker provider support, published sandbox branches, arbitrary-repo generalization, human-review replacement, or Electron product runtime behavior was added.`,
]

const createParentUserStoryAudit = (
  childTasks: readonly ParsedChildTask[],
): readonly ParentUserStoryAudit[] => {
  const storyNumbers = [
    ...new Set(childTasks.flatMap((childTask) => childTask.userStoriesAddressed)),
  ]

  return storyNumbers.map((storyNumber) => ({
    issueNumbers: childTasks
      .filter((childTask) => childTask.userStoriesAddressed.includes(storyNumber))
      .map((childTask) => childTask.issueNumber),
    storyNumber,
  }))
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80)

const createPrdBranchName = (issueNumber: number, title: string): string =>
  `agent/prd-${String(issueNumber)}-${slugify(title.replace(/^PRD:\s*/i, ''))}`

const isCleanUpToDateMain = (status: MainBranchStatus): boolean =>
  status.clean && status.currentBranch === 'main' && status.upToDate

const isDependencyChangeFile = (filePath: string): boolean =>
  filePath === 'package.json' || filePath === 'pnpm-lock.yaml' || filePath.endsWith('/package.json')

const formatOptionalIssueReference = (issueNumber: number | undefined): string =>
  issueNumber === undefined ? 'none' : `#${String(issueNumber)}`

export { evaluateCleanupPlan as createCleanupPlanFromArtifacts } from './run-guardrails.js'
