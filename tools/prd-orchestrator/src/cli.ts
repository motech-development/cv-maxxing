import {
  createDryRunPlan,
  type DryRunPlan,
  type GitHubIssue,
  renderDryRunPlan,
} from './planning.js'
import {
  planOneChildTransaction,
  renderOneChildTransactionPlan,
  type MainBranchStatus,
} from './one-child-transaction.js'
import type { ChildTaskProgress } from './draft-pr-state.js'
import type { RemoteAutomationPr } from './run-guardrails.js'
import type { SandcastleImpactAnalysisResult } from './sandcastle-impact-analysis.js'

export interface PrdOrchestratorCliInput {
  readonly arguments_: readonly string[]
  readonly stdin: string
}

export interface PrdOrchestratorCliResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export const runPrdOrchestratorCli = (input: PrdOrchestratorCliInput): PrdOrchestratorCliResult => {
  const [command, subcommand] = input.arguments_

  if (command === 'plan') {
    return runPlanCommand(input.stdin)
  }

  if (command === 'run' && subcommand === '--one-child') {
    return runOneChildCommand(input.stdin)
  }

  {
    return {
      exitCode: 1,
      stderr: 'Unsupported command. Supported commands: `plan`, `run --one-child`.\n',
      stdout: '',
    }
  }
}

const runPlanCommand = (stdin: string): PrdOrchestratorCliResult => {
  const issues = parseIssueJson(stdin)
  const plan = createDryRunPlan(issues)

  return {
    exitCode: plan.selectedPrd === undefined ? 1 : 0,
    stderr: '',
    stdout: `${renderDryRunPlan(plan)}\n`,
  }
}

const runOneChildCommand = (stdin: string): PrdOrchestratorCliResult => {
  const input = parseOneChildCommandInput(stdin)
  const plan = planOneChildTransaction(input)

  return {
    exitCode: plan.status === 'blocked' ? 1 : 0,
    stderr: '',
    stdout: `${renderOneChildTransactionPlan(plan)}\n`,
  }
}

const parseIssueJson = (stdin: string): readonly GitHubIssue[] => {
  const parsedJson: unknown = JSON.parse(stdin)

  if (Array.isArray(parsedJson)) {
    return parsedJson.map((issue) => parseGitHubIssue(issue))
  }

  if (isRecord(parsedJson) && Array.isArray(parsedJson.issues)) {
    return parsedJson.issues.map((issue) => parseGitHubIssue(issue))
  }

  throw new TypeError('Expected stdin to contain a GitHub issue array or an object with `issues`.')
}

const parseOneChildCommandInput = (
  stdin: string,
): Parameters<typeof planOneChildTransaction>[0] => {
  const parsedJson: unknown = JSON.parse(stdin)

  if (!isRecord(parsedJson) || !Array.isArray(parsedJson.issues)) {
    throw new TypeError('Expected stdin to contain an object with `issues` and `transaction`.')
  }

  if (!isRecord(parsedJson.transaction)) {
    throw new TypeError('Expected `transaction` to contain run --one-child planning inputs.')
  }

  const transaction = parsedJson.transaction

  return {
    childCommitHash: parseOptionalString(transaction.childCommitHash),
    codeRabbitStatus: parseRequiredString(transaction.codeRabbitStatus, 'codeRabbitStatus'),
    completedChildIssueNumbers: parseNumberArray(
      transaction.completedChildIssueNumbers,
      'completedChildIssueNumbers',
    ),
    dependencyChangeJustification: parseOptionalString(transaction.dependencyChangeJustification),
    existingLedger: parseChildTaskProgressArray(transaction.existingLedger),
    impactAnalysis: parseImpactAnalysis(transaction.impactAnalysis),
    issues: parsedJson.issues.map((issue) => parseGitHubIssue(issue)),
    mainBranchStatus: parseMainBranchStatus(transaction.mainBranchStatus),
    remoteAutomationPr: parseOptionalRemoteAutomationPr(transaction.remoteAutomationPr),
    verificationEvidence: parseStringArray(
      transaction.verificationEvidence,
      'verificationEvidence',
    ),
    workerChangedFiles: parseStringArray(transaction.workerChangedFiles, 'workerChangedFiles'),
  }
}

const parseGitHubIssue = (value: unknown): GitHubIssue => {
  if (!isRecord(value)) {
    throw new TypeError('Expected each GitHub issue to be an object.')
  }

  if (
    typeof value.body !== 'string' ||
    typeof value.number !== 'number' ||
    typeof value.state !== 'string' ||
    typeof value.title !== 'string'
  ) {
    throw new TypeError('Expected each GitHub issue to include body, number, state, and title.')
  }

  return {
    body: value.body,
    number: value.number,
    state: value.state,
    title: value.title,
  }
}

const parseMainBranchStatus = (value: unknown): MainBranchStatus => {
  if (
    !isRecord(value) ||
    typeof value.clean !== 'boolean' ||
    typeof value.currentBranch !== 'string' ||
    typeof value.upToDate !== 'boolean'
  ) {
    throw new TypeError('Expected mainBranchStatus to include clean, currentBranch, and upToDate.')
  }

  return {
    clean: value.clean,
    currentBranch: value.currentBranch,
    upToDate: value.upToDate,
  }
}

const parseImpactAnalysis = (value: unknown): SandcastleImpactAnalysisResult => {
  if (!isRecord(value)) {
    throw new TypeError('Expected impactAnalysis to be an object.')
  }

  return {
    designFiles: parseStringArray(value.designFiles, 'impactAnalysis.designFiles'),
    expectedFiles: parseStringArray(value.expectedFiles, 'impactAnalysis.expectedFiles'),
    expectedModules: parseStringArray(value.expectedModules, 'impactAnalysis.expectedModules'),
    riskLevel: parseRiskLevel(value.riskLevel),
    sharedContracts: parseStringArray(value.sharedContracts, 'impactAnalysis.sharedContracts'),
    tests: parseStringArray(value.tests, 'impactAnalysis.tests'),
  }
}

const parseOptionalRemoteAutomationPr = (value: unknown): RemoteAutomationPr | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }

  if (
    !isRecord(value) ||
    typeof value.branchName !== 'string' ||
    typeof value.prNumber !== 'number' ||
    typeof value.prdIssueNumber !== 'number' ||
    typeof value.url !== 'string'
  ) {
    throw new TypeError(
      'Expected remoteAutomationPr to include branchName, prNumber, prdIssueNumber, and url.',
    )
  }

  return {
    branchName: value.branchName,
    prNumber: value.prNumber,
    prdIssueNumber: value.prdIssueNumber,
    url: value.url,
  }
}

const parseChildTaskProgressArray = (value: unknown): readonly ChildTaskProgress[] => {
  if (!Array.isArray(value)) {
    throw new TypeError('Expected existingLedger to be an array.')
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.codeRabbitStatus !== 'string' ||
      typeof entry.issueNumber !== 'number' ||
      !isChildTaskProgressStatus(entry.status) ||
      typeof entry.verificationStatus !== 'string'
    ) {
      throw new TypeError('Expected existingLedger entries to contain child progress fields.')
    }

    return {
      codeRabbitStatus: entry.codeRabbitStatus,
      issueNumber: entry.issueNumber,
      shortCommitHash: parseOptionalString(entry.shortCommitHash),
      status: entry.status,
      verificationStatus: entry.verificationStatus,
    }
  })
}

const parseStringArray = (value: unknown, fieldName: string): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected ${fieldName} to be a string array.`)
  }

  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new TypeError(`Expected ${fieldName} to be a string array.`)
    }

    return item
  })
}

const parseNumberArray = (value: unknown, fieldName: string): readonly number[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected ${fieldName} to be a number array.`)
  }

  return value.map((item) => {
    if (typeof item !== 'number') {
      throw new TypeError(`Expected ${fieldName} to be a number array.`)
    }

    return item
  })
}

const parseRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${fieldName} to be a string.`)
  }

  return value
}

const parseOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const parseRiskLevel = (value: unknown): SandcastleImpactAnalysisResult['riskLevel'] => {
  if (value === 'high' || value === 'low' || value === 'medium') {
    return value
  }

  throw new TypeError('Expected impactAnalysis.riskLevel to be low, medium, or high.')
}

const isChildTaskProgressStatus = (value: unknown): value is ChildTaskProgress['status'] =>
  value === 'blocked' || value === 'complete' || value === 'pending'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const createPlanFromIssueJson = (issueJson: string): DryRunPlan =>
  createDryRunPlan(parseIssueJson(issueJson))
