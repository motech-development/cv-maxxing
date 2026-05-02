import {
  createChildCommitMessage,
  generateDraftPrBody,
  generatePrdConventionalCommitTitle,
  type ChildTaskProgress,
} from './draft-pr-state.js'
import {
  createDryRunPlan,
  type GitHubIssue,
  type ParsedChildTask,
  type SelectedPrdPlan,
} from './planning.js'
import type { RemoteAutomationPr } from './run-guardrails.js'
import {
  getPencilRequiredDesignFiles,
  type SandcastleImpactAnalysisResult,
} from './sandcastle-impact-analysis.js'

export type OneChildTransactionStatus = 'blocked' | 'ready-to-commit'

export interface MainBranchStatus {
  readonly clean: boolean
  readonly currentBranch: string
  readonly upToDate: boolean
}

export interface PlanOneChildTransactionInput {
  readonly childCommitHash: string | undefined
  readonly codeRabbitStatus: string
  readonly completedChildIssueNumbers: readonly number[]
  readonly dependencyChangeJustification: string | undefined
  readonly existingLedger: readonly ChildTaskProgress[]
  readonly impactAnalysis: SandcastleImpactAnalysisResult
  readonly issues: readonly GitHubIssue[]
  readonly mainBranchStatus: MainBranchStatus
  readonly remoteAutomationPr: RemoteAutomationPr | undefined
  readonly verificationEvidence: readonly string[]
  readonly workerChangedFiles: readonly string[]
}

export interface WorkerRunPlan {
  readonly branchName: string
  readonly pushToRemote: false
  readonly receivesGitHubMutationCredentials: false
}

export type DraftPullRequestTransaction =
  | {
      readonly action: 'create'
      readonly body: string
      readonly branchName: string
      readonly draft: true
      readonly title: string
    }
  | {
      readonly action: 'resume'
      readonly body: string
      readonly branchName: string
      readonly draft: true
      readonly prNumber: number
      readonly title: string
      readonly url: string
    }

export interface HostApplicationPlan {
  readonly applyWorkerDiffOnBranch: string
  readonly startsFromCleanUpToDateMain: boolean
}

export interface PushPlan {
  readonly branchName: string
  readonly mode: 'force-with-lease'
}

export interface OneChildTransactionPlan {
  readonly blockers: readonly string[]
  readonly commitMessage: string
  readonly draftPullRequest: DraftPullRequestTransaction
  readonly hostApplication: HostApplicationPlan
  readonly pencilVerificationDecision: PencilVerificationDecision
  readonly prBodyAfterChildUpdate: string
  readonly prdBranchName: string
  readonly push: PushPlan
  readonly selectedChild: ParsedChildTask | undefined
  readonly status: OneChildTransactionStatus
  readonly verificationCommands: readonly string[]
  readonly workerRun: WorkerRunPlan | undefined
  readonly writeSurfaceDecision: WriteSurfaceDecision
}

export interface EnforceWriteSurfaceInput {
  readonly changedFiles: readonly string[]
  readonly dependencyChangeJustification: string | undefined
  readonly impactAnalysis: SandcastleImpactAnalysisResult
}

export type WriteSurfaceAction = 'accept' | 'reanalyse'

export interface WriteSurfaceDecision {
  readonly action: WriteSurfaceAction
  readonly allowedFiles: readonly string[]
  readonly dependencyChanges: readonly string[]
  readonly unexpectedFiles: readonly string[]
}

export interface ValidatePencilVerificationEvidenceInput {
  readonly changedFiles: readonly string[]
  readonly impactAnalysis: SandcastleImpactAnalysisResult
  readonly verificationEvidence: readonly string[]
}

export interface PencilVerificationDecision {
  readonly missingEvidenceFiles: readonly string[]
  readonly requiredFiles: readonly string[]
  readonly satisfied: boolean
}

export type RecoverableFailure =
  | 'external-blocker'
  | 'unexpected-write-surface'
  | 'verification-failed'

export type FailureRecoveryAction =
  | 'reanalyse-write-surface'
  | 'record-blocker'
  | 'repair-worker-output'

export interface PlanFailureRecoveryInput {
  readonly failure: RecoverableFailure
}

export interface FailureRecoveryPlan {
  readonly action: FailureRecoveryAction
  readonly reason: string
}

const prdBranchPrefix = 'agent/prd'
const dependencyChangeFiles = new Set(['package.json', 'pnpm-lock.yaml'])

export const planOneChildTransaction = (
  input: PlanOneChildTransactionInput,
): OneChildTransactionPlan => {
  const dryRunPlan = createDryRunPlan(input.issues)
  const selectedPrd = dryRunPlan.selectedPrd
  const completedChildIssueNumbers = getCompletedChildIssueNumbers(input)
  const selectedChild =
    selectedPrd === undefined ? undefined : selectNextChild(selectedPrd, completedChildIssueNumbers)
  const prdBranchName =
    selectedPrd === undefined
      ? 'agent/prd-unavailable'
      : createPrdBranchName(selectedPrd.issueNumber, selectedPrd.title)
  const resolvedPrdBranchName = input.remoteAutomationPr?.branchName ?? prdBranchName
  const childTasks = selectedPrd?.childTasks ?? []
  const prBodyBeforeChildUpdate = createDraftPrBody({
    branchName: resolvedPrdBranchName,
    ledger: input.existingLedger,
    selectedPrd,
  })
  const draftPullRequest = createDraftPullRequestPlan({
    body: prBodyBeforeChildUpdate,
    branchName: resolvedPrdBranchName,
    remoteAutomationPr: input.remoteAutomationPr,
    selectedPrd,
  })
  const writeSurfaceDecision = enforceWriteSurface({
    changedFiles: input.workerChangedFiles,
    dependencyChangeJustification: input.dependencyChangeJustification,
    impactAnalysis: input.impactAnalysis,
  })
  const pencilVerificationDecision = validatePencilVerificationEvidence({
    changedFiles: input.workerChangedFiles,
    impactAnalysis: input.impactAnalysis,
    verificationEvidence: input.verificationEvidence,
  })
  const mainBranchReady = isCleanUpToDateMain(input.mainBranchStatus)
  const blockers = [
    ...(selectedPrd === undefined ? ['No eligible PRD with child tasks is available'] : []),
    ...(selectedPrd?.blockers ?? []),
    ...(selectedChild === undefined ? ['No unblocked child task is available'] : []),
    ...(mainBranchReady ? [] : ['run --one-child must start from clean, up-to-date main']),
    ...formatWriteSurfaceBlockers(writeSurfaceDecision),
    ...formatPencilVerificationBlockers(pencilVerificationDecision),
  ]
  const status: OneChildTransactionStatus = blockers.length === 0 ? 'ready-to-commit' : 'blocked'
  const verificationCommands = selectVerificationCommands(input.impactAnalysis)
  const commitMessage =
    selectedChild === undefined
      ? ''
      : createChildCommitMessage({
          acceptanceEvidence: selectedChild.acceptanceCriteria,
          childIssueNumber: selectedChild.issueNumber,
          childTitle: selectedChild.title,
          verificationEvidence: input.verificationEvidence,
        })
  const prBodyAfterChildUpdate = createDraftPrBody({
    branchName: resolvedPrdBranchName,
    ledger: createUpdatedLedger({
      childCommitHash: input.childCommitHash,
      childTasks,
      codeRabbitStatus: input.codeRabbitStatus,
      existingLedger: input.existingLedger,
      selectedChild,
      status,
      verificationEvidence: input.verificationEvidence,
    }),
    selectedPrd,
  })

  return {
    blockers,
    commitMessage,
    draftPullRequest,
    hostApplication: {
      applyWorkerDiffOnBranch: resolvedPrdBranchName,
      startsFromCleanUpToDateMain: mainBranchReady,
    },
    pencilVerificationDecision,
    prBodyAfterChildUpdate,
    prdBranchName: resolvedPrdBranchName,
    push: {
      branchName: resolvedPrdBranchName,
      mode: 'force-with-lease',
    },
    selectedChild,
    status,
    verificationCommands,
    workerRun:
      selectedChild === undefined
        ? undefined
        : {
            branchName: createWorkerBranchName(selectedPrd?.issueNumber ?? 0, selectedChild),
            pushToRemote: false,
            receivesGitHubMutationCredentials: false,
          },
    writeSurfaceDecision,
  }
}

export const enforceWriteSurface = (input: EnforceWriteSurfaceInput): WriteSurfaceDecision => {
  const expectedFiles = new Set([
    ...input.impactAnalysis.expectedFiles,
    ...input.impactAnalysis.designFiles,
    ...getPencilRequiredDesignFiles(input.impactAnalysis),
    ...input.impactAnalysis.sharedContracts,
    ...input.impactAnalysis.tests,
  ])
  const dependencyChanges = input.changedFiles.filter((filePath) =>
    isDependencyChangeFile(filePath),
  )
  const allowedFiles = input.changedFiles.filter(
    (filePath) =>
      expectedFiles.has(filePath) ||
      (isDependencyChangeFile(filePath) &&
        input.dependencyChangeJustification !== undefined &&
        input.dependencyChangeJustification.trim().length > 0),
  )
  const unexpectedFiles = input.changedFiles.filter((filePath) => !allowedFiles.includes(filePath))

  return {
    action: unexpectedFiles.length === 0 ? 'accept' : 'reanalyse',
    allowedFiles,
    dependencyChanges,
    unexpectedFiles,
  }
}

export const validatePencilVerificationEvidence = (
  input: ValidatePencilVerificationEvidenceInput,
): PencilVerificationDecision => {
  const requiredFiles = getPencilRequiredDesignFiles(input.impactAnalysis)
  const changedRequiredFiles = requiredFiles.filter((filePath) =>
    input.changedFiles.includes(filePath),
  )
  const missingEvidenceFiles = hasPencilVerificationEvidence(input.verificationEvidence)
    ? []
    : changedRequiredFiles

  return {
    missingEvidenceFiles,
    requiredFiles,
    satisfied: missingEvidenceFiles.length === 0,
  }
}

export const selectVerificationCommands = (
  impactAnalysis: SandcastleImpactAnalysisResult,
): readonly string[] => [
  'pnpm lint',
  ...selectAffectedPackageTypechecks(impactAnalysis),
  ...selectDesignVerificationCommands(impactAnalysis),
  ...selectTargetedTestCommands(impactAnalysis),
]

export const planFailureRecovery = (input: PlanFailureRecoveryInput): FailureRecoveryPlan => {
  if (input.failure === 'unexpected-write-surface') {
    return {
      action: 'reanalyse-write-surface',
      reason: 'Unexpected worker changes require fresh impact analysis before application.',
    }
  }

  if (input.failure === 'verification-failed') {
    return {
      action: 'repair-worker-output',
      reason: 'Host verification failed on the PRD branch after applying worker output.',
    }
  }

  return {
    action: 'record-blocker',
    reason: 'No autonomous progress remains; record the blocker in run state and PR ledger.',
  }
}

export const renderOneChildTransactionPlan = (plan: OneChildTransactionPlan): string =>
  [
    'PRD Orchestrator One-Child Transaction',
    `Status: ${plan.status}`,
    `PRD branch: ${plan.prdBranchName}`,
    `Draft PR action: ${plan.draftPullRequest.action}`,
    `Selected child: ${formatSelectedChild(plan.selectedChild)}`,
    `Worker branch: ${plan.workerRun?.branchName ?? 'none'}`,
    `Write surface: ${plan.writeSurfaceDecision.action}`,
    `Verification: ${formatTextList(plan.verificationCommands)}`,
    `Blockers: ${formatTextList(plan.blockers)}`,
  ].join('\n')

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

const getCompletedChildIssueNumbers = (
  input: Pick<PlanOneChildTransactionInput, 'completedChildIssueNumbers' | 'existingLedger'>,
): readonly number[] =>
  uniqueNumbers([
    ...input.completedChildIssueNumbers,
    ...input.existingLedger
      .filter((entry) => entry.status === 'complete')
      .map((entry) => entry.issueNumber),
  ])

const createDraftPullRequestPlan = (input: {
  readonly body: string
  readonly branchName: string
  readonly remoteAutomationPr: RemoteAutomationPr | undefined
  readonly selectedPrd: SelectedPrdPlan | undefined
}): DraftPullRequestTransaction => {
  const title = generatePrdConventionalCommitTitle(input.selectedPrd?.title ?? 'PRD unavailable')

  if (input.remoteAutomationPr !== undefined) {
    return {
      action: 'resume',
      body: input.body,
      branchName: input.remoteAutomationPr.branchName,
      draft: true,
      prNumber: input.remoteAutomationPr.prNumber,
      title,
      url: input.remoteAutomationPr.url,
    }
  }

  return {
    action: 'create',
    body: input.body,
    branchName: input.branchName,
    draft: true,
    title,
  }
}

const createDraftPrBody = (input: {
  readonly branchName: string
  readonly ledger: readonly ChildTaskProgress[]
  readonly selectedPrd: SelectedPrdPlan | undefined
}): string =>
  generateDraftPrBody({
    branchName: input.branchName,
    childTasks:
      input.selectedPrd?.childTasks.map((childTask) => ({
        issueNumber: childTask.issueNumber,
        title: childTask.title,
      })) ?? [],
    ledger: input.ledger,
    parentPrdIssueNumber: input.selectedPrd?.issueNumber ?? 0,
    prdTitle: input.selectedPrd?.title ?? 'PRD unavailable',
  })

const createUpdatedLedger = (input: {
  readonly childCommitHash: string | undefined
  readonly childTasks: readonly ParsedChildTask[]
  readonly codeRabbitStatus: string
  readonly existingLedger: readonly ChildTaskProgress[]
  readonly selectedChild: ParsedChildTask | undefined
  readonly status: OneChildTransactionStatus
  readonly verificationEvidence: readonly string[]
}): readonly ChildTaskProgress[] => {
  const existingLedgerByIssueNumber = new Map(
    input.existingLedger.map((entry) => [entry.issueNumber, entry]),
  )

  return input.childTasks.map((childTask) => {
    if (childTask.issueNumber !== input.selectedChild?.issueNumber) {
      return (
        existingLedgerByIssueNumber.get(childTask.issueNumber) ?? {
          codeRabbitStatus: 'pending',
          issueNumber: childTask.issueNumber,
          status: 'pending',
          verificationStatus: 'not run',
        }
      )
    }

    if (input.status === 'blocked') {
      return {
        codeRabbitStatus: input.codeRabbitStatus,
        issueNumber: childTask.issueNumber,
        status: 'blocked',
        verificationStatus: 'blocked before commit',
      }
    }

    return {
      codeRabbitStatus: input.codeRabbitStatus,
      issueNumber: childTask.issueNumber,
      shortCommitHash: input.childCommitHash?.slice(0, 7),
      status: 'complete',
      verificationStatus: formatEvidence(input.verificationEvidence),
    }
  })
}

const selectAffectedPackageTypechecks = (
  impactAnalysis: SandcastleImpactAnalysisResult,
): readonly string[] =>
  selectAffectedPackageNames(impactAnalysis).map((packageName) =>
    formatPackageScriptCommand(packageName, 'typecheck'),
  )

const selectTargetedTestCommands = (
  impactAnalysis: SandcastleImpactAnalysisResult,
): readonly string[] => {
  if (impactAnalysis.tests.length === 0) {
    return []
  }

  const packageNames = selectAffectedPackageNames(impactAnalysis)

  if (packageNames.length === 0) {
    return ['pnpm --filter @cv-maxxing/prd-orchestrator test:unit']
  }

  return packageNames.flatMap((packageName) => {
    const packageTestPathArguments = selectPackageTestPaths({
      packageName,
      testPaths: impactAnalysis.tests,
    })
      .map((testPath) => shellQuote(testPath))
      .join(' ')

    if (packageTestPathArguments.length === 0) {
      return []
    }

    return [
      `${formatPackageScriptCommand(
        packageName,
        selectPackageTestScript(packageName),
      )} -- ${packageTestPathArguments}`,
    ]
  })
}

const selectDesignVerificationCommands = (
  impactAnalysis: SandcastleImpactAnalysisResult,
): readonly string[] =>
  getPencilRequiredDesignFiles(impactAnalysis).length > 0
    ? ['pnpm --filter @cv-maxxing/desktop test:visual']
    : []

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`

const selectAffectedPackageNames = (
  impactAnalysis: SandcastleImpactAnalysisResult,
): readonly string[] =>
  uniqueStrings(
    impactAnalysis.expectedModules.flatMap((moduleName) => parsePackageName(moduleName)),
  )

const parsePackageName = (moduleName: string): readonly string[] => {
  const scopedPackageMatch = /^(@cv-maxxing\/[a-z0-9][a-z0-9-]*)\b/.exec(moduleName)

  if (scopedPackageMatch?.[1] !== undefined) {
    return [scopedPackageMatch[1]]
  }

  const packageMatch = /^([a-z0-9][a-z0-9-]*)\b/.exec(moduleName)

  if (packageMatch?.[1] !== undefined) {
    return [packageMatch[1]]
  }

  return []
}

const selectPackageTestScript = (packageName: string): string =>
  packageName === '@cv-maxxing/desktop' || packageName === '@cv-maxxing/prd-orchestrator'
    ? 'test:unit'
    : 'test'

const selectPackageTestPaths = (input: {
  readonly packageName: string
  readonly testPaths: readonly string[]
}): readonly string[] => {
  const packageRoot = getWorkspacePackageRoot(input.packageName)

  return input.testPaths.flatMap((testPath) => {
    if (packageRoot === undefined) {
      return [testPath]
    }

    if (testPath === packageRoot) {
      return []
    }

    const packagePathPrefix = `${packageRoot}/`

    return testPath.startsWith(packagePathPrefix) ? [testPath.slice(packagePathPrefix.length)] : []
  })
}

const getWorkspacePackageRoot = (packageName: string): string | undefined => {
  if (packageName === '@cv-maxxing/desktop') {
    return 'apps/desktop'
  }

  if (packageName === '@cv-maxxing/prd-orchestrator') {
    return 'tools/prd-orchestrator'
  }

  const workspacePackageName = /^@cv-maxxing\/([a-z0-9][a-z0-9-]*)$/.exec(packageName)?.[1]

  return workspacePackageName === undefined ? undefined : `packages/${workspacePackageName}`
}

const formatPackageScriptCommand = (packageName: string, scriptName: string): string =>
  `pnpm --filter ${packageName} ${scriptName}`

const uniqueNumbers = (items: readonly number[]): readonly number[] => [...new Set(items)]

const uniqueStrings = (items: readonly string[]): readonly string[] => [...new Set(items)]

const isCleanUpToDateMain = (status: MainBranchStatus): boolean =>
  status.currentBranch === 'main' && status.clean && status.upToDate

const formatWriteSurfaceBlockers = (decision: WriteSurfaceDecision): readonly string[] =>
  decision.unexpectedFiles.length === 0
    ? []
    : [
        `worker diff touched files outside impact-analysis write surface: ${decision.unexpectedFiles.join(
          ', ',
        )}`,
      ]

const formatPencilVerificationBlockers = (
  decision: PencilVerificationDecision,
): readonly string[] =>
  decision.missingEvidenceFiles.length === 0
    ? []
    : [
        `Pencil verification evidence missing for .pen design changes: ${decision.missingEvidenceFiles.join(
          ', ',
        )}. Provide Pencil screenshot evidence or saved persistence evidence before committing.`,
      ]

const hasPencilVerificationEvidence = (verificationEvidence: readonly string[]): boolean =>
  verificationEvidence.some((evidence) => {
    const normalizedEvidence = evidence.toLowerCase()

    return (
      normalizedEvidence.includes('pencil') &&
      (normalizedEvidence.includes('screenshot') ||
        normalizedEvidence.includes('persistence') ||
        normalizedEvidence.includes('saved') ||
        normalizedEvidence.includes('disk') ||
        normalizedEvidence.includes('git diff'))
    )
  })

const createPrdBranchName = (issueNumber: number, title: string): string =>
  `${prdBranchPrefix}-${String(issueNumber)}-${slugify(stripPrdPrefix(title))}`

const createWorkerBranchName = (prdIssueNumber: number, childTask: ParsedChildTask): string =>
  `${prdBranchPrefix}-${String(prdIssueNumber)}-child-${String(childTask.issueNumber)}-${slugify(
    childTask.title,
  )}`

const stripPrdPrefix = (title: string): string => title.replace(/^PRD:\s*/i, '')

const slugify = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replaceAll(/^-+|-+$/g, '')

  return slug.length === 0 ? 'untitled' : slug
}

const isDependencyChangeFile = (filePath: string): boolean => {
  if (dependencyChangeFiles.has(filePath)) {
    return true
  }

  return filePath.endsWith('/package.json')
}

const formatSelectedChild = (childTask: ParsedChildTask | undefined): string =>
  childTask === undefined ? 'none' : `#${String(childTask.issueNumber)} ${childTask.title}`

const formatTextList = (items: readonly string[]): string =>
  items.length === 0 ? 'none' : items.join('; ')

const formatEvidence = (items: readonly string[]): string =>
  items.length === 0 ? 'not run' : items.join('; ')
