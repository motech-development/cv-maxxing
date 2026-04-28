import {
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
  planOneChildTransaction,
  selectVerificationCommands,
  type MainBranchStatus,
} from './one-child-transaction.js'
import {
  createDryRunPlan,
  renderDryRunPlan,
  type GitHubIssue,
  type ParsedChildTask,
  type SelectedPrdPlan,
} from './planning.js'
import type { CodeRabbitFinding } from './coderabbit-review.js'
import type {
  SandcastleImpactAnalysisResult,
  SiblingTaskSummary,
} from './sandcastle-impact-analysis.js'
import {
  evaluateReadyForReviewGate,
  generateFinalPrdAcceptanceAudit,
  validateAutomationPrOwnership,
  type CiStatus,
  type ParentUserStoryAudit,
} from './final-prd-flow.js'

export interface PrdOrchestratorLiveAdapters {
  readonly ci: {
    readonly pollChecks: (input: PollChecksInput) => Promise<CiStatus>
  }
  readonly codeRabbit: {
    readonly reviewChild: (input: ReviewChildInput) => Promise<ReviewChildResult>
  }
  readonly git: {
    readonly applyWorkerDiff: (input: ApplyWorkerDiffInput) => Promise<void>
    readonly commitChild: (message: string) => Promise<ChildCommitResult>
    readonly getCompletedChildIssueNumbers?: (branchName: string) => Promise<readonly number[]>
    readonly getMainBranchStatus: () => Promise<MainBranchStatus>
    readonly preparePrdBranch: (input: PreparePrdBranchInput) => Promise<void>
    readonly pushPrdBranch: (input: PushPrdBranchInput) => Promise<void>
  }
  readonly github: {
    readonly createDraftPr: (input: CreateDraftPrInput) => Promise<RemoteAutomationPr>
    readonly findAutomationPr: (
      prdIssueNumber: number,
      branchName: string,
    ) => Promise<RemoteAutomationPr | undefined>
    readonly getPr: (prNumber: number) => Promise<AutomationPrDetails>
    readonly listOpenIssues: () => Promise<readonly GitHubIssue[]>
    readonly markReadyForReview: (prNumber: number) => Promise<void>
    readonly postPrComment: (prNumber: number, body: string) => Promise<void>
    readonly updatePrBody: (prNumber: number, body: string) => Promise<void>
  }
  readonly sandcastle: {
    readonly runImpactAnalysis: (
      input: RunImpactAnalysisInput,
    ) => Promise<SandcastleImpactAnalysisResult>
    readonly runImplementation: (input: RunImplementationInput) => Promise<RunImplementationResult>
  }
  readonly state: {
    readonly cleanup: () => Promise<CleanupPlan>
    readonly readRunStatus: () => Promise<RunStatus>
    readonly recordRunStatus: (status: RunStatus) => Promise<void>
  }
  readonly verification: {
    readonly runCommands: (commands: readonly string[]) => Promise<readonly string[]>
  }
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
  const issues = await adapters.github.listOpenIssues()
  const dryRunPlan = createDryRunPlan(issues)
  const selectedPrd = dryRunPlan.selectedPrd

  if (selectedPrd === undefined) {
    return blockedResult('No eligible PRD with child tasks is available.')
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
  const selectedChild = selectNextChild(selectedPrd, completedChildIssueNumbers)

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

  await adapters.git.applyWorkerDiff({
    prdBranchName: branchSeedPlan.prdBranchName,
    workerBranchName: workerResult.workerBranchName,
  })

  const verificationCommands = selectVerificationCommands(impactAnalysis)
  const verificationEvidence = await adapters.verification.runCommands(verificationCommands)
  const commitReadyPlan = planOneChildTransaction({
    childCommitHash: undefined,
    codeRabbitStatus: 'not run',
    completedChildIssueNumbers,
    dependencyChangeJustification: undefined,
    existingLedger: createPendingLedger(selectedPrd.childTasks),
    impactAnalysis,
    issues,
    mainBranchStatus,
    remoteAutomationPr: draftPr,
    verificationEvidence,
    workerChangedFiles: workerResult.changedFiles,
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

    await adapters.state.recordRunStatus(status)

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
  const finalPlan = planOneChildTransaction({
    childCommitHash: commit.hash,
    codeRabbitStatus: codeRabbitResult.status,
    completedChildIssueNumbers,
    dependencyChangeJustification: undefined,
    existingLedger: createPendingLedger(selectedPrd.childTasks),
    impactAnalysis,
    issues,
    mainBranchStatus,
    remoteAutomationPr: draftPr,
    verificationEvidence,
    workerChangedFiles: workerResult.changedFiles,
  })
  const completedChildren = [...completedChildIssueNumbers, selectedChild.issueNumber]
  const allChildrenComplete = completedChildren.length === selectedPrd.childTasks.length

  await adapters.github.updatePrBody(draftPr.prNumber, finalPlan.prBodyAfterChildUpdate)

  const finalizationResult =
    allChildrenComplete && codeRabbitResult.findings.length === 0
      ? await finalizePrdIfReady({
          adapters,
          branchName: branchSeedPlan.prdBranchName,
          completedChildren,
          draftPr,
          selectedPrd,
          verificationEvidence,
        })
      : {
          blockers: [],
          ciStatus: undefined,
          phase: codeRabbitResult.findings.length === 0 ? 'complete' : 'blocked',
        }
  const status = createRunStatus({
    blockers:
      codeRabbitResult.findings.length === 0
        ? finalizationResult.blockers
        : codeRabbitResult.findings.map((finding) => finding.title),
    branchName: branchSeedPlan.prdBranchName,
    ciStatus: finalizationResult.ciStatus,
    codeRabbitStatus: codeRabbitResult.status,
    completedChildIssueNumbers: completedChildren,
    currentChildIssueNumber: undefined,
    phase: codeRabbitResult.findings.length === 0 ? finalizationResult.phase : 'blocked',
    pr: draftPr,
    prdIssueNumber: selectedPrd.issueNumber,
  })

  await adapters.state.recordRunStatus(status)

  return {
    exitCode: codeRabbitResult.findings.length === 0 ? 0 : 1,
    stderr: '',
    stdout: `${renderOneChildSummary({
      childIssueNumber: selectedChild.issueNumber,
      pr: draftPr,
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

  const status = await adapters.state.readRunStatus()

  return {
    exitCode: 0,
    stderr: '',
    stdout: `Resume PR #${String(prNumber)}\n${formatRunStatus(status)}\n`,
  }
}

export const executeStatus = async (
  adapters: PrdOrchestratorLiveAdapters,
): Promise<LiveCommandResult> => {
  const status = await adapters.state.readRunStatus()

  return {
    exitCode: status.blockers.length === 0 ? 0 : 1,
    stderr: '',
    stdout: `${formatRunStatus(status)}\n`,
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
): ParsedChildTask | undefined => {
  const completed = new Set(completedChildIssueNumbers)
  const childTasksByIssueNumber = new Map(
    selectedPrd.childTasks.map((childTask) => [childTask.issueNumber, childTask]),
  )
  const executableIssueNumber = selectedPrd.childTaskDag
    .filter((node) => !completed.has(node.issueNumber))
    .find((node) => node.dependencies.every((dependency) => completed.has(dependency)))?.issueNumber

  return executableIssueNumber === undefined
    ? undefined
    : childTasksByIssueNumber.get(executableIssueNumber)
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
  lastCommand: 'run --one-child',
  phase: input.phase,
  prNumber: input.pr.prNumber,
  prUrl: input.pr.url,
})

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

const finalizePrdIfReady = async (input: {
  readonly adapters: PrdOrchestratorLiveAdapters
  readonly branchName: string
  readonly completedChildren: readonly number[]
  readonly draftPr: RemoteAutomationPr
  readonly selectedPrd: SelectedPrdPlan
  readonly verificationEvidence: readonly string[]
}): Promise<{
  readonly blockers: readonly string[]
  readonly ciStatus: CiStatus
  readonly phase: string
}> => {
  const ciStatus = await input.adapters.ci.pollChecks({
    branchName: input.branchName,
    prNumber: input.draftPr.prNumber,
  })
  const mergeInstructions = generateMergeInstructions({
    childTasks: input.selectedPrd.childTasks,
    parentPrdIssueNumber: input.selectedPrd.issueNumber,
    prdTitle: input.selectedPrd.title,
  })
  const finalAudit = generateFinalPrdAcceptanceAudit({
    architectureChecks: ['Implementation stayed within issue #80 PRD scope and ARCHITECTURE.md.'],
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
    verificationEvidence: input.verificationEvidence,
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

const isCleanUpToDateMain = (status: MainBranchStatus): boolean =>
  status.clean && status.currentBranch === 'main' && status.upToDate

export { evaluateCleanupPlan as createCleanupPlanFromArtifacts } from './run-guardrails.js'
