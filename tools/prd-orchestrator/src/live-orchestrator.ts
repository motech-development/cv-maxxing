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
  evaluateReadyForReviewGate,
  generateFinalPrdAcceptanceAudit,
  planResumePrRepair,
  validateAutomationPrOwnership,
  type ChildCommitReference,
  type CiStatus,
  type GitHubActionsStatus,
  type ParentUserStoryAudit,
  type ResumePrFinding,
} from './final-prd-flow.js'
import { groupRunnableTasksByImpactSurface } from './full-run-scheduler.js'

export interface PrdOrchestratorLiveAdapters {
  readonly configuration?: PrdOrchestratorLiveConfiguration
  readonly ci: {
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
  }
  readonly github: {
    readonly createDraftPr: (input: CreateDraftPrInput) => Promise<RemoteAutomationPr>
    readonly convertPrToDraft?: (prNumber: number) => Promise<void>
    readonly findAutomationPr: (
      prdIssueNumber: number,
      branchName: string,
    ) => Promise<RemoteAutomationPr | undefined>
    readonly getReviewFindings?: (prNumber: number) => Promise<readonly ResumePrFinding[]>
    readonly getPr: (prNumber: number) => Promise<AutomationPrDetails>
    readonly getCurrentPr: () => Promise<AutomationPrDetails | undefined>
    readonly listOpenIssues: () => Promise<readonly GitHubIssue[]>
    readonly markReadyForReview: (prNumber: number) => Promise<void>
    readonly postPrComment: (prNumber: number, body: string) => Promise<void>
    readonly updatePrBody: (prNumber: number, body: string) => Promise<void>
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
}

export interface PushPrdBranchInput {
  readonly branchName: string
  readonly mode: 'force-with-lease'
}

export interface ChildCommitResult {
  readonly hash: string
}

export interface RunImpactAnalysisInput {
  readonly childTask: ParsedChildTask
  readonly parentPrd: SelectedPrdPlan
  readonly parentPrdBody: string
  readonly siblingSummaries: readonly SiblingTaskSummary[]
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
}

export interface RepairReviewFindingsInput extends RunImplementationInput {
  readonly findings: readonly CodeRabbitFinding[]
}

export interface RepairResumeFindingsInput {
  readonly branchName: string
  readonly findings: readonly ResumePrFinding[]
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

type VerificationRepairResult =
  | {
      readonly impactAnalysis: SandcastleImpactAnalysisResult
      readonly status: 'clean'
      readonly verificationEvidence: readonly string[]
      readonly workerResult: RunImplementationResult
    }
  | {
      readonly blocker: string
      readonly impactAnalysis: SandcastleImpactAnalysisResult
      readonly status: 'blocked'
      readonly workerResult: RunImplementationResult
    }

export interface PollChecksInput {
  readonly branchName: string
  readonly prNumber: number
}

export interface AutomationPrDetails {
  readonly body: string
  readonly branchName: string
  readonly isDraft: boolean
  readonly prNumber: number
  readonly url: string
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

export const executeLiveOneChild = async (
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
    return await executeLiveOneChildWithLock(adapters)
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

  const lock = await adapters.state.acquireRunLock()

  if (!lock.ready) {
    return blockedResult(lock.blockers.join('\n'))
  }

  try {
    return await executeLiveRunWithLock(adapters)
  } finally {
    await adapters.state.releaseRunLock()
  }
}

const executeLiveRunWithLock = async (
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const issues = await adapters.github.listOpenIssues()
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

  const remoteAutomationPr = await adapters.github.findAutomationPr(
    selectedPrd.issueNumber,
    branchSeedPlan.prdBranchName,
  )
  const parentPrdBody = issues.find((issue) => issue.number === selectedPrd.issueNumber)?.body ?? ''

  await adapters.git.preparePrdBranch({
    branchName: branchSeedPlan.prdBranchName,
    remoteAutomationPr,
  })

  const initialCompletedChildIssueNumbers =
    (await adapters.git.getCompletedChildIssueNumbers?.(branchSeedPlan.prdBranchName)) ?? []
  const draftPr =
    remoteAutomationPr ??
    (await adapters.github.createDraftPr({
      body: generateDraftPrBody({
        branchName: branchSeedPlan.prdBranchName,
        childTasks: selectedPrd.childTasks,
        ledger: await createBaseLedger({
          adapters,
          blockedChildIssueNumbers: [],
          branchName: branchSeedPlan.prdBranchName,
          childTasks: selectedPrd.childTasks,
          completedChildIssueNumbers: initialCompletedChildIssueNumbers,
        }),
        parentPrdIssueNumber: selectedPrd.issueNumber,
        prdTitle: selectedPrd.title,
      }),
      branchName: branchSeedPlan.prdBranchName,
      prdIssueNumber: selectedPrd.issueNumber,
      title: branchSeedPlan.draftPullRequest.title,
    }))
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
          pr: draftPr,
          prdIssueNumber: selectedPrd.issueNumber,
        })

        await adapters.github.updatePrBody(
          draftPr.prNumber,
          generateDraftPrBody({
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
          }),
        )
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
        pr: draftPr,
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
          draftPr,
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
  } = {},
): Promise<LiveCommandResult> => {
  const issues = await adapters.github.listOpenIssues()
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

  const remoteAutomationPr = await adapters.github.findAutomationPr(
    selectedPrd.issueNumber,
    branchSeedPlan.prdBranchName,
  )
  const parentPrdBody = issues.find((issue) => issue.number === selectedPrd.issueNumber)?.body ?? ''

  await adapters.git.preparePrdBranch({
    branchName: branchSeedPlan.prdBranchName,
    remoteAutomationPr,
  })

  const draftPr =
    remoteAutomationPr ??
    (await adapters.github.createDraftPr({
      body: generateDraftPrBody({
        branchName: branchSeedPlan.prdBranchName,
        childTasks: selectedPrd.childTasks,
        ledger: createPendingLedger(selectedPrd.childTasks),
        parentPrdIssueNumber: selectedPrd.issueNumber,
        prdTitle: selectedPrd.title,
      }),
      branchName: branchSeedPlan.prdBranchName,
      prdIssueNumber: selectedPrd.issueNumber,
      title: branchSeedPlan.draftPullRequest.title,
    }))

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
    const status = createRunStatus({
      blockers: writeSurface.blockers,
      branchName: branchSeedPlan.prdBranchName,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers,
      currentChildIssueNumber: selectedChild.issueNumber,
      phase: 'blocked',
      pr: draftPr,
      prdIssueNumber: selectedPrd.issueNumber,
    })

    await recordBlockedProgress({
      adapters,
      body: generateDraftPrBody({
        branchName: branchSeedPlan.prdBranchName,
        childTasks: selectedPrd.childTasks,
        ledger: createBlockedLedger(selectedPrd.childTasks, selectedChild.issueNumber),
        parentPrdIssueNumber: selectedPrd.issueNumber,
        prdTitle: selectedPrd.title,
      }),
      draftPr,
      status,
    })

    return {
      exitCode: 1,
      stderr: `${writeSurface.blockers.join('\n')}\n`,
      stdout: `${renderOneChildSummary({
        childIssueNumber: selectedChild.issueNumber,
        pr: draftPr,
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
      blocker: verifiedWorkerResult.blocker,
      branchName: branchSeedPlan.prdBranchName,
      completedChildIssueNumbers,
      draftPr,
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
    existingLedger: createPendingLedger(selectedPrd.childTasks),
    impactAnalysis: verifiedWorkerResult.impactAnalysis,
    issues,
    mainBranchStatus,
    remoteAutomationPr: draftPr,
    verificationEvidence,
    workerChangedFiles: verifiedWorkerResult.workerResult.changedFiles,
  })

  if (commitReadyPlan.status === 'blocked') {
    const status = createRunStatus({
      blockers: commitReadyPlan.blockers,
      branchName: branchSeedPlan.prdBranchName,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers,
      currentChildIssueNumber: selectedChild.issueNumber,
      phase: 'blocked',
      pr: draftPr,
      prdIssueNumber: selectedPrd.issueNumber,
    })

    await recordBlockedProgress({
      adapters,
      body: commitReadyPlan.prBodyAfterChildUpdate,
      draftPr,
      status,
    })

    return {
      exitCode: 1,
      stderr: `${commitReadyPlan.blockers.join('\n')}\n`,
      stdout: `${renderOneChildSummary({
        childIssueNumber: selectedChild.issueNumber,
        pr: draftPr,
        status,
      })}\n`,
    }
  }

  const commit = await adapters.git.commitChild(commitReadyPlan.commitMessage)

  await adapters.git.pushPrdBranch(commitReadyPlan.push)

  const codeRabbitResult = await adapters.codeRabbit.reviewChild({
    branchName: branchSeedPlan.prdBranchName,
    childCommitHash: commit.hash,
    childIssueNumber: selectedChild.issueNumber,
    prNumber: draftPr.prNumber,
  })
  const cleanReview = await repairCodeRabbitFindingsUntilClean({
    adapters,
    branchName: branchSeedPlan.prdBranchName,
    childCommitHash: commit.hash,
    draftPr,
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
    existingLedger: createPendingLedger(selectedPrd.childTasks),
    impactAnalysis: verifiedWorkerResult.impactAnalysis,
    issues,
    mainBranchStatus,
    remoteAutomationPr: draftPr,
    verificationEvidence,
    workerChangedFiles: verifiedWorkerResult.workerResult.changedFiles,
  })
  const completedChildren = [...completedChildIssueNumbers, selectedChild.issueNumber]
  const allChildrenComplete = completedChildren.length === selectedPrd.childTasks.length

  await adapters.github.updatePrBody(draftPr.prNumber, finalPlan.prBodyAfterChildUpdate)

  const finalizationResult =
    allChildrenComplete && cleanReview.result.findings.length === 0
      ? await finalizePrdIfReady({
          adapters,
          branchName: branchSeedPlan.prdBranchName,
          completedChildren,
          draftPr,
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
    pr: draftPr,
    prdIssueNumber: selectedPrd.issueNumber,
  })

  await adapters.state.recordRunStatus(status)

  return {
    exitCode:
      cleanReview.result.findings.length === 0 && finalizationResult.blockers.length === 0 ? 0 : 1,
    stderr: '',
    stdout: `${renderOneChildSummary({
      childIssueNumber: selectedChild.issueNumber,
      pr: draftPr,
      status,
    })}\n`,
  }
}

const executePreparedChildWithLock = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly blockedChildIssueNumbers: readonly number[]
  readonly branchSeedPlan: OneChildTransactionPlan
  readonly completedChildIssueNumbers: readonly number[]
  readonly draftPr: RemoteAutomationPr
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
      blocker: verifiedWorkerResult.blocker,
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
  const commit = await input.adapters.git.commitChild(commitMessage)

  await input.adapters.git.pushPrdBranch(push)

  const codeRabbitResult = await input.adapters.codeRabbit.reviewChild({
    branchName: input.branchSeedPlan.prdBranchName,
    childCommitHash: commit.hash,
    childIssueNumber: input.selectedChild.issueNumber,
    prNumber: input.draftPr.prNumber,
  })
  const cleanReview = await repairCodeRabbitFindingsUntilClean({
    adapters: input.adapters,
    branchName: input.branchSeedPlan.prdBranchName,
    childCommitHash: commit.hash,
    curatedCommitMessage: commitMessage,
    draftPr: input.draftPr,
    impactAnalysis: verifiedWorkerResult.impactAnalysis,
    initialResult: codeRabbitResult,
    parentPrd: input.selectedPrd,
    parentPrdBody: input.parentPrdBody,
    selectedChild: input.selectedChild,
    siblingSummaries: input.siblingSummaries,
    verificationCommands: selectVerificationCommands(verifiedWorkerResult.impactAnalysis),
    workerBranchName: input.workerBranchName,
  })
  const completedChildren = [...input.completedChildIssueNumbers, input.selectedChild.issueNumber]
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
    input.draftPr.prNumber,
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
          draftPr: input.draftPr,
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
    pr: input.draftPr,
    prdIssueNumber: input.selectedPrd.issueNumber,
  })

  await input.adapters.state.recordRunStatus(status)

  return {
    exitCode:
      cleanReview.result.findings.length === 0 && finalizationResult.blockers.length === 0 ? 0 : 1,
    stderr: '',
    stdout: `${renderOneChildSummary({
      childIssueNumber: input.selectedChild.issueNumber,
      pr: input.draftPr,
      status,
    })}\n`,
  }
}

export const executeResumePr = async (
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
  const selectedPrd = createDryRunPlan(issues).selectedPrd

  if (selectedPrd !== undefined && selectedPrd.blockers.length > 0) {
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

  if (repairPlan.returnToDraft) {
    await adapters.github.convertPrToDraft?.(prNumber)
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
    const workerResult = await adapters.sandcastle.repairResumeFindings?.({
      branchName: pr.branchName,
      findings,
      prNumber,
      targetCommitHash: amendPlan.commitHash,
      workerBranchName: `${pr.branchName}-resume-${String(amendPlan.childIssueNumber)}`,
    })

    if (workerResult !== undefined) {
      await adapters.git.applyWorkerDiff({
        prdBranchName: pr.branchName,
        workerBranchName: workerResult.workerBranchName,
      })
    }

    await adapters.git.amendChildCommit(
      createResumeChildCommitMessage(amendPlan.childIssueNumber, findings),
    )
  }

  if (repairPlan.finalCleanupCommit !== undefined) {
    const findings = reviewFindings.filter((finding) =>
      repairPlan.finalCleanupCommit?.findingIds.includes(finding.id),
    )

    const workerResult = await adapters.sandcastle.repairResumeFindings?.({
      branchName: pr.branchName,
      findings,
      prNumber,
      workerBranchName: `${pr.branchName}-resume-final-cleanup`,
    })

    if (workerResult !== undefined) {
      await adapters.git.applyWorkerDiff({
        prdBranchName: pr.branchName,
        workerBranchName: workerResult.workerBranchName,
      })
    }

    await adapters.git.commitFinalCleanup?.(repairPlan.finalCleanupCommit.message)
  }

  if (repairPlan.forcePush !== undefined) {
    await adapters.git.pushPrdBranch(repairPlan.forcePush)
  }

  await adapters.state.recoverRunStatusFromPr(pr)

  return await executeLiveRun(adapters)
}

export const executeStatus = async (
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const status = await adapters.state.readRunStatus()
  const currentPr = await adapters.github.getCurrentPr()
  const artifactStatus = await adapters.state.readArtifactStatus?.()
  const prLine =
    currentPr === undefined ? '' : `Current PR: #${String(currentPr.prNumber)} ${currentPr.url}\n`
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
    exitCode: status.blockers.length === 0 ? 0 : 1,
    stderr: '',
    stdout: `${formatRunStatus(status)}\n${artifactLines}${prLine}`,
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

const createWorkerBranchName = (
  selectedPrd: SelectedPrdPlan,
  selectedChild: ParsedChildTask,
): string =>
  `agent/prd-${String(selectedPrd.issueNumber)}-child-${String(
    selectedChild.issueNumber,
  )}-${slugify(selectedChild.title)}`

const createRunStatus = (input: {
  readonly blockers: readonly string[]
  readonly branchName: string
  readonly ciStatus?: CiStatus
  readonly codeRabbitStatus: string
  readonly completedChildIssueNumbers: readonly number[]
  readonly currentChildIssueNumber: number | undefined
  readonly lastCommand?: string
  readonly phase: string
  readonly pr: RemoteAutomationPr
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
  prNumber: input.pr.prNumber,
  prUrl: input.pr.url,
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
  readonly pr: RemoteAutomationPr
  readonly status: RunStatus
}): string =>
  [
    `Completed child #${String(input.childIssueNumber)}`,
    `Draft PR: #${String(input.pr.prNumber)} ${input.pr.url}`,
    `Phase: ${input.status.phase}`,
    `Blockers: ${input.status.blockers.length === 0 ? 'none' : input.status.blockers.join('; ')}`,
  ].join('\n')

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
  readonly draftPr: RemoteAutomationPr
  readonly status: RunStatus
}): Promise<void> => {
  const blockerBody = [
    '## PRD Orchestrator Blocker',
    '',
    ...input.status.blockers.map((blocker) => `- ${blocker}`),
  ].join('\n')

  await input.adapters.github.updatePrBody(input.draftPr.prNumber, input.body)
  await input.adapters.github.postPrComment(input.draftPr.prNumber, blockerBody)
  await input.adapters.state.recordRunStatus(input.status)
}

const recordVerificationRepairBlockedProgress = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly blockedChildIssueNumbers: readonly number[]
  readonly blocker: string
  readonly branchName: string
  readonly completedChildIssueNumbers: readonly number[]
  readonly draftPr: RemoteAutomationPr
  readonly lastCommand?: string
  readonly selectedChild: ParsedChildTask
  readonly selectedPrd: SelectedPrdPlan
}): Promise<LiveCommandResult> => {
  const status = createRunStatus({
    blockers: [input.blocker],
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
    stderr: `${input.blocker}\n`,
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
      throw new Error(writeSurface.blockers.join('\n'))
    }

    impactAnalysis = writeSurface.impactAnalysis
    const verificationCommands = selectVerificationCommands(impactAnalysis)

    await input.adapters.git.applyWorkerDiff({
      prdBranchName: input.prdBranchName,
      workerBranchName: workerResult.workerBranchName,
    })

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
          blocker: createVerificationRepairBlocker({
            errorMessage,
            selectedChild: input.selectedChild,
            verificationCommands,
          }),
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
  }

  return {
    commitHash,
    result,
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
  const ciResult = await pollFinalCiUntilTerminal(input)
  const ciStatus = ciResult.status

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

  const mergeInstructions = generateMergeInstructions({
    childTasks: input.selectedPrd.childTasks,
    parentPrdIssueNumber: input.selectedPrd.issueNumber,
    prdTitle: input.selectedPrd.title,
  })
  const finalAudit = generateFinalPrdAcceptanceAudit({
    architectureChecks: [
      `Implementation stayed within PRD #${String(
        input.selectedPrd.issueNumber,
      )} scope and ARCHITECTURE.md.`,
    ],
    childTasks: input.selectedPrd.childTasks.map((childTask) => ({
      acceptanceCriteria: childTask.acceptanceCriteria,
      issueNumber: childTask.issueNumber,
      title: childTask.title,
      userStoriesAddressed: childTask.userStoriesAddressed,
    })),
    ciStatus,
    codeRabbitStatus: 'passed',
    mergeInstructions,
    parentPrdIssueNumber: input.selectedPrd.issueNumber,
    parentUserStories: createParentUserStoryAudit(input.selectedPrd.childTasks),
    verificationEvidence: input.verificationEvidenceByChild,
  })

  await input.adapters.github.postPrComment(input.draftPr.prNumber, finalAudit)

  const readyGate = evaluateReadyForReviewGate({
    allChildrenComplete: input.completedChildren.length === input.selectedPrd.childTasks.length,
    ciStatus,
    codeRabbitStatus: 'passed',
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

  return {
    blockers: [],
    ciStatus,
    phase: 'ready-for-review',
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
  const seenFingerprints = new Set<string>()

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

    const fingerprint = `${decision.unexpectedFiles.join('|')}::${JSON.stringify(impactAnalysis)}`

    if (seenFingerprints.has(fingerprint)) {
      return {
        blockers: [
          `worker diff touched files outside impact-analysis write surface after re-analysis: ${decision.unexpectedFiles.join(
            ', ',
          )}`,
        ],
        impactAnalysis,
      }
    }

    seenFingerprints.add(fingerprint)
    impactAnalysis = await input.adapters.sandcastle.runImpactAnalysis({
      childTask: input.selectedChild,
      parentPrd: input.parentPrd,
      parentPrdBody: input.parentPrdBody,
      siblingSummaries: input.siblingSummaries,
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
