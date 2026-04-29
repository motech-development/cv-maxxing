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
import { createDefaultPrdOrchestratorLiveAdapters } from './default-live-adapters.js'
import {
  executeCleanup,
  executeLiveOneChild,
  executeLivePlan,
  executeLiveRun,
  executeResumePr,
  executeStatus,
  type PrdOrchestratorLiveConfiguration,
  type PrdOrchestratorLiveAdapters,
} from './live-orchestrator.js'

export interface PrdOrchestratorCliInput {
  readonly arguments_: readonly string[]
  readonly stdin: string
}

export interface PrdOrchestratorCliAsyncInput extends PrdOrchestratorCliInput {
  readonly adapters?: PrdOrchestratorLiveAdapters
}

export interface PrdOrchestratorCliResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export const runPrdOrchestratorCli = (input: PrdOrchestratorCliInput): PrdOrchestratorCliResult => {
  const [command, subcommand] = input.arguments_

  if (command === 'plan') {
    return runCliValidation(() => runPlanCommand(input.stdin))
  }

  if (command === 'run' && subcommand === '--one-child') {
    return runCliValidation(() => runOneChildCommand(input.stdin))
  }

  return {
    exitCode: 1,
    stderr: 'Unsupported command. Supported commands: `plan`, `run --one-child`.\n',
    stdout: '',
  }
}

export const runPrdOrchestratorCliAsync = async (
  input: PrdOrchestratorCliAsyncInput,
): Promise<PrdOrchestratorCliResult> => {
  const parsedArguments = parseLiveCliArguments(input.arguments_)
  const [command, subcommand] = parsedArguments.arguments_
  const trimmedStdin = input.stdin.trim()

  if (command === 'plan' && trimmedStdin.length > 0) {
    return runCliValidation(() => runPlanCommand(input.stdin))
  }

  if (command === 'run' && subcommand === '--one-child' && trimmedStdin.length > 0) {
    return runCliValidation(() => runOneChildCommand(input.stdin))
  }

  const adapters =
    input.adapters ??
    createDefaultPrdOrchestratorLiveAdapters(process.cwd(), parsedArguments.configuration)

  if (command === 'plan') {
    return await executeLivePlan(adapters)
  }

  if (command === 'run' && subcommand === '--one-child') {
    return await executeLiveOneChild(adapters)
  }

  if (command === 'run') {
    return await executeLiveRun(adapters)
  }

  if (command === 'resume-pr') {
    let prNumber: number

    try {
      prNumber = parseCommandIssueNumber(subcommand, 'resume-pr')
    } catch (error) {
      return formatCliValidationError(error)
    }

    return await executeResumePr(prNumber, adapters)
  }

  if (command === 'status') {
    return await executeStatus(adapters)
  }

  if (command === 'cleanup') {
    return await executeCleanup(adapters)
  }

  return {
    exitCode: 1,
    stderr:
      'Unsupported command. Supported commands: `plan`, `run`, `run --one-child`, `resume-pr <number>`, `status`, `cleanup`.\n',
    stdout: '',
  }
}

interface ParsedLiveCliArguments {
  readonly arguments_: readonly string[]
  readonly configuration: PrdOrchestratorLiveConfiguration
}

const parseLiveCliArguments = (arguments_: readonly string[]): ParsedLiveCliArguments => {
  const commandArguments: string[] = []
  let codexEffort: string | undefined
  let codexModel: string | undefined

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]

    if (argument === '--model') {
      codexModel = arguments_[index + 1]
      index += 1
      continue
    }

    if (argument === '--effort') {
      codexEffort = arguments_[index + 1]
      index += 1
      continue
    }

    if (argument?.startsWith('--model=') === true) {
      codexModel = argument.slice('--model='.length)
      continue
    }

    if (argument?.startsWith('--effort=') === true) {
      codexEffort = argument.slice('--effort='.length)
      continue
    }

    if (argument !== undefined) {
      commandArguments.push(argument)
    }
  }

  return {
    arguments_: commandArguments,
    configuration: {
      codexEffort,
      codexModel,
    },
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
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(stdin)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'

    throw new TypeError(`Invalid JSON input: ${message}`)
  }

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
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(stdin)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'

    throw new TypeError(`Invalid JSON input: ${message}`)
  }

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
    !isPositiveInteger(value.number) ||
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
    ...(value.pencilRequiredDesignFiles === undefined
      ? {}
      : {
          pencilRequiredDesignFiles: parseStringArray(
            value.pencilRequiredDesignFiles,
            'impactAnalysis.pencilRequiredDesignFiles',
          ),
        }),
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
    typeof value.isDraft !== 'boolean' ||
    !isPositiveInteger(value.prNumber) ||
    !isPositiveInteger(value.prdIssueNumber) ||
    typeof value.url !== 'string'
  ) {
    throw new TypeError(
      'Expected remoteAutomationPr to include branchName, isDraft, prNumber, prdIssueNumber, and url.',
    )
  }

  return {
    branchName: value.branchName,
    isDraft: value.isDraft,
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
      !isPositiveInteger(entry.issueNumber) ||
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
    if (!isPositiveInteger(item)) {
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

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

const parseRiskLevel = (value: unknown): SandcastleImpactAnalysisResult['riskLevel'] => {
  if (value === 'high' || value === 'low' || value === 'medium') {
    return value
  }

  throw new TypeError('Expected impactAnalysis.riskLevel to be low, medium, or high.')
}

const isChildTaskProgressStatus = (value: unknown): value is ChildTaskProgress['status'] =>
  value === 'blocked' || value === 'complete' || value === 'pending'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseCommandIssueNumber = (value: string | undefined, commandName: string): number => {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    throw new TypeError(`Expected ${commandName} to include a positive pull request number.`)
  }

  const parsedValue = Number.parseInt(value, 10)

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new TypeError(`Expected ${commandName} to include a positive pull request number.`)
  }

  return parsedValue
}

const runCliValidation = (operation: () => PrdOrchestratorCliResult): PrdOrchestratorCliResult => {
  try {
    return operation()
  } catch (error) {
    return formatCliValidationError(error)
  }
}

const formatCliValidationError = (error: unknown): PrdOrchestratorCliResult => {
  if (error instanceof TypeError) {
    return {
      exitCode: 1,
      stderr: `${error.message}\n`,
      stdout: '',
    }
  }

  throw error
}

export const createPlanFromIssueJson = (issueJson: string): DryRunPlan =>
  createDryRunPlan(parseIssueJson(issueJson))
