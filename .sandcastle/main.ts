import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { codex, createSandbox, run } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'
import type { PromptArgs, Sandbox, SandboxHooks, SandboxRunResult } from '@ai-hero/sandcastle'
import type { DockerOptions } from '@ai-hero/sandcastle/sandboxes/docker'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 60_000
const GIT_BRANCH_MISSING_EXIT_CODE = 1
const GIT_REMOTE_REF_MISSING_EXIT_CODE = 2
const GIT_REMOTE_NAME = 'origin'
const SANDBOX_CODEX_HOME = '/home/agent/.codex'

export const MAX_ITERATIONS = 10
export const MAX_PARALLEL_CHILDREN = 4

export const PLANNER_PROMPT_FILE = '.sandcastle/prompts/plan-prd.md'
export const IMPLEMENT_PROMPT_FILE = '.sandcastle/prompts/implement-child.md'
export const REVIEW_PROMPT_FILE = '.sandcastle/prompts/review-child.md'
export const MERGE_PROMPT_FILE = '.sandcastle/prompts/merge-children.md'

export const COMPLETION_SIGNAL = '</task>'
export const DEFAULT_CODEX_MODEL = 'gpt-5.5'
export const DEFAULT_CODEX_EFFORT = 'high'
export const PLAN_START_SIGNAL = '<plan>'
export const PLAN_END_SIGNAL = '</plan>'
export const PLAN_SIGNAL = PLAN_END_SIGNAL
export const NO_WORK_SIGNAL = '<no-work />'

export interface PlannedIssue {
  readonly number: number
  readonly title: string
  readonly branchName: string
}

export interface PlannerPlan {
  readonly parentIssue: PlannedIssue
  readonly children: readonly PlannedIssue[]
}

export type PlannerOutput =
  | {
      readonly kind: 'plan'
      readonly plan: PlannerPlan
    }
  | {
      readonly kind: 'no-work'
    }

export interface CommitReference {
  readonly sha: string
}

export type ChildTaskExecutionResult =
  | {
      readonly status: 'fulfilled'
      readonly child: PlannedIssue
      readonly branchName: string
      readonly implementationCommits: readonly CommitReference[]
      readonly reviewCommits: readonly CommitReference[]
      readonly logFilePaths: readonly string[]
    }
  | {
      readonly status: 'failed'
      readonly child: PlannedIssue
      readonly branchName: string
      readonly error: string
      readonly logFilePaths: readonly string[]
    }

export interface ExecuteChildTaskInput {
  readonly parentIssue: PlannedIssue
  readonly child: PlannedIssue
}

export type ChildTaskExecutor = (input: {
  readonly parentIssue: PlannedIssue
  readonly child: PlannedIssue
}) => Promise<ChildTaskExecutionResult>

export interface RunPlannedChildTasksInput {
  readonly plan: PlannerPlan
  readonly maxParallel?: number
  readonly executeChild?: ChildTaskExecutor
}

export interface CompletedChildBranch {
  readonly branchName: string
  readonly issue: PlannedIssue
}

export interface MergePromptInput {
  readonly completedBranches: readonly CompletedChildBranch[]
  readonly parentIssue: PlannedIssue
  readonly promptArgs: PromptArgs
  readonly promptFile: string
}

export interface MergePromptResult {
  readonly branchName: string
  readonly logFilePath?: string
}

export type MergePromptRunner = (input: MergePromptInput) => Promise<MergePromptResult>

export type MergeCompletedBranchesResult =
  | {
      readonly status: 'merged'
      readonly branchName: string
      readonly completedBranches: readonly CompletedChildBranch[]
      readonly logFilePath?: string
    }
  | {
      readonly status: 'skipped'
      readonly completedBranches: readonly CompletedChildBranch[]
    }

export interface RunMergeCompletedBranchesInput {
  readonly plan: PlannerPlan
  readonly childResults: readonly ChildTaskExecutionResult[]
  readonly runMergePrompt?: MergePromptRunner
}

export interface DraftPullRequest {
  readonly number: number
  readonly url: string
  readonly isDraft: boolean
}

export interface CreateDraftPullRequestInput {
  readonly branchName: string
  readonly body: string
  readonly draft: true
  readonly title: string
}

export interface DraftPullRequestGateway {
  readonly ensureParentBranch: (branchName: string) => Promise<void>
  readonly pushParentBranch: (branchName: string) => Promise<void>
  readonly findDraftPullRequest: (branchName: string) => Promise<DraftPullRequest | undefined>
  readonly createDraftPullRequest: (input: CreateDraftPullRequestInput) => Promise<DraftPullRequest>
}

export type DraftPullRequestLifecycleResult =
  | {
      readonly status: 'created'
      readonly pullRequest: DraftPullRequest
    }
  | {
      readonly status: 'reused'
      readonly pullRequest: DraftPullRequest
    }

export interface CreateOrReusePrdDraftPullRequestInput {
  readonly plan: PlannerPlan
  readonly completedBranches?: readonly CompletedChildBranch[]
  readonly gateway?: DraftPullRequestGateway
}

export type PlannerPromptRunner = () => Promise<PlannerOutput>

export interface WorkflowIterationResult {
  readonly plannerOutput: Extract<PlannerOutput, { readonly kind: 'plan' }>
  readonly childResults: readonly ChildTaskExecutionResult[]
  readonly mergeResult: MergeCompletedBranchesResult
  readonly draftPullRequestResult: DraftPullRequestLifecycleResult
}

export interface WorkflowResult {
  readonly status: 'no-work' | 'iteration-limit-reached'
  readonly iterations: readonly WorkflowIterationResult[]
}

export interface WorkflowReport {
  readonly mode: 'dry-run' | 'live'
  readonly status: WorkflowResult['status']
  readonly iterations: number
  readonly completedBranches: readonly string[]
  readonly failedBranches: readonly WorkflowFailedBranchReport[]
  readonly mergeResults: readonly WorkflowMergeReport[]
  readonly draftPullRequests: readonly WorkflowDraftPullRequestReport[]
  readonly logFilePaths: readonly string[]
}

export interface WorkflowFailedBranchReport {
  readonly branchName: string
  readonly error: string
  readonly issueNumber: number
  readonly logFilePaths: readonly string[]
}

export type WorkflowMergeReport =
  | {
      readonly status: 'merged'
      readonly branchName: string
      readonly completedBranches: readonly string[]
      readonly logFilePath?: string
    }
  | {
      readonly status: 'skipped'
      readonly completedBranches: readonly string[]
    }

export interface WorkflowDraftPullRequestReport {
  readonly status: DraftPullRequestLifecycleResult['status']
  readonly number: number
  readonly url: string
  readonly isDraft: boolean
}

export interface RunWorkflowInput {
  readonly runPlanner?: PlannerPromptRunner
  readonly executeChild?: ChildTaskExecutor
  readonly runMergePrompt?: MergePromptRunner
  readonly draftPullRequestGateway?: DraftPullRequestGateway
  readonly maxIterations?: number
  readonly maxParallel?: number
}

export interface CreateCodexDockerOptionsInput {
  readonly fileExists?: (path: string) => boolean
  readonly hostCodexHome?: string
}

export interface WorkflowDryRunResult {
  readonly plannerOutput: PlannerOutput
  readonly childResults: readonly ChildTaskExecutionResult[]
  readonly mergeResult: MergeCompletedBranchesResult
  readonly draftPullRequestResult: DraftPullRequestLifecycleResult
  readonly steps: readonly string[]
}

export interface PreflightResult {
  readonly status: 'passed' | 'failed'
  readonly checks: readonly PreflightCheckResult[]
}

export type PreflightCheckResult =
  | {
      readonly status: 'passed'
      readonly name: string
      readonly message: string
    }
  | {
      readonly status: 'failed'
      readonly name: string
      readonly message: string
    }

export const createPrdBranchName = (issueNumber: number, title: string): string =>
  `prd-${String(issueNumber)}-${slugify(title)}`

export const createChildBranchName = (issueNumber: number, title: string): string =>
  `child-${String(issueNumber)}-${slugify(title)}`

export const parsePlannerOutput = (output: string): PlannerOutput => {
  if (output.includes(NO_WORK_SIGNAL)) {
    return {
      kind: 'no-work',
    }
  }

  const payload = extractPlannerPayload(output)
  const parsed: unknown = JSON.parse(payload)

  return {
    kind: 'plan',
    plan: parsePlannerPlan(parsed),
  }
}

export const runWorkflow = async ({
  draftPullRequestGateway = githubCliDraftPullRequestGateway,
  executeChild,
  maxIterations = MAX_ITERATIONS,
  maxParallel = MAX_PARALLEL_CHILDREN,
  runMergePrompt,
  runPlanner = runPlannerPrompt,
}: RunWorkflowInput = {}): Promise<WorkflowResult> => {
  const iterations: WorkflowIterationResult[] = []

  for (let iterationIndex = 0; iterationIndex < maxIterations; iterationIndex += 1) {
    const plannerOutput = await runPlanner()

    if (plannerOutput.kind === 'no-work') {
      return {
        iterations,
        status: 'no-work',
      }
    }

    const plan = plannerOutput.plan
    const childResults = await runPlannedChildTasks({
      executeChild,
      maxParallel,
      plan,
    })
    const mergeResult = await runMergeCompletedBranches({
      childResults,
      plan,
      runMergePrompt,
    })
    const draftPullRequestResult = await createOrReusePrdDraftPullRequest({
      completedBranches: mergeResult.completedBranches,
      gateway: draftPullRequestGateway,
      plan,
    })
    const iteration = {
      childResults,
      draftPullRequestResult,
      mergeResult,
      plannerOutput,
    }

    iterations.push(iteration)
  }

  return {
    iterations,
    status: 'iteration-limit-reached',
  }
}

export const runPlannerPrompt: PlannerPromptRunner = async () => {
  const result = await run({
    agent: codex(process.env.SANDCASTLE_CODEX_MODEL ?? DEFAULT_CODEX_MODEL, {
      effort: DEFAULT_CODEX_EFFORT,
    }),
    completionSignal: [PLAN_END_SIGNAL, NO_WORK_SIGNAL],
    maxIterations: MAX_ITERATIONS,
    name: 'planner',
    promptFile: PLANNER_PROMPT_FILE,
    sandbox: createCodexDockerSandbox(),
  })

  return parsePlannerOutput(result.stdout)
}

export const runPlannedChildTasks = async ({
  executeChild = ({ child, parentIssue }) => executeChildTask({ child, parentIssue }),
  maxParallel = MAX_PARALLEL_CHILDREN,
  plan,
}: RunPlannedChildTasksInput): Promise<readonly ChildTaskExecutionResult[]> => {
  const results: (ChildTaskExecutionResult | undefined)[] = Array.from({
    length: plan.children.length,
  })
  let nextChildIndex = 0
  const workerCount = Math.min(maxParallel, plan.children.length)

  const runNextChild = async (): Promise<void> => {
    const childIndex = nextChildIndex
    nextChildIndex += 1

    const child = plan.children[childIndex]

    if (child !== undefined) {
      results[childIndex] = await executeChild({
        child,
        parentIssue: plan.parentIssue,
      })
      await runNextChild()
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await runNextChild()
    }),
  )

  return results.filter(isDefined)
}

export const executeChildTask = async ({
  child,
  parentIssue,
}: ExecuteChildTaskInput): Promise<ChildTaskExecutionResult> => {
  let branchName = child.branchName
  let collectedLogFilePaths: readonly string[] = []
  let sandbox: Sandbox | undefined

  try {
    sandbox = await createSandbox({
      branch: child.branchName,
      hooks: createSandboxSetupHooks(),
      sandbox: createCodexDockerSandbox(),
    })
    branchName = sandbox.branch

    const implementationResult = await runChildPromptInSandbox({
      child,
      parentIssue,
      promptFile: IMPLEMENT_PROMPT_FILE,
      sandbox,
      taskKind: 'implement',
    })

    const implementationLogFilePaths = compactOptionalString([implementationResult.logFilePath])
    collectedLogFilePaths = implementationLogFilePaths

    if (implementationResult.commits.length === 0) {
      return {
        branchName,
        child,
        implementationCommits: [],
        logFilePaths: implementationLogFilePaths,
        reviewCommits: [],
        status: 'fulfilled',
      }
    }

    const reviewResult = await runChildPromptInSandbox({
      child,
      parentIssue,
      promptFile: REVIEW_PROMPT_FILE,
      sandbox,
      taskKind: 'review',
    })
    collectedLogFilePaths = compactOptionalString([
      implementationResult.logFilePath,
      reviewResult.logFilePath,
    ])

    return {
      branchName,
      child,
      implementationCommits: implementationResult.commits,
      logFilePaths: collectedLogFilePaths,
      reviewCommits: reviewResult.commits,
      status: 'fulfilled',
    }
  } catch (error: unknown) {
    collectedLogFilePaths = compactOptionalString([
      ...collectedLogFilePaths,
      extractLogFilePath(error),
    ])

    return {
      branchName,
      child,
      error: formatErrorMessage(error),
      logFilePaths: collectedLogFilePaths,
      status: 'failed',
    }
  } finally {
    await sandbox?.close()
  }
}

const runChildPromptInSandbox = async ({
  child,
  parentIssue,
  promptFile,
  sandbox,
  taskKind,
}: {
  readonly child: PlannedIssue
  readonly parentIssue: PlannedIssue
  readonly promptFile: string
  readonly sandbox: Sandbox
  readonly taskKind: 'implement' | 'review'
}): Promise<SandboxRunResult> =>
  await sandbox.run({
    agent: codex(process.env.SANDCASTLE_CODEX_MODEL ?? DEFAULT_CODEX_MODEL, {
      effort: DEFAULT_CODEX_EFFORT,
    }),
    completionSignal: COMPLETION_SIGNAL,
    maxIterations: MAX_ITERATIONS,
    name: `${taskKind}-${String(child.number)}`,
    promptArgs: createChildPromptArguments({
      child,
      parentIssue,
    }),
    promptFile,
  })

export const collectCompletedChildBranches = (
  childResults: readonly ChildTaskExecutionResult[],
): readonly CompletedChildBranch[] =>
  childResults.filter(isFulfilledChildWithCommits).map(({ branchName, child }) => ({
    branchName,
    issue: child,
  }))

export const runMergeCompletedBranches = async ({
  childResults,
  plan,
  runMergePrompt = runMergePromptWithSandcastle,
}: RunMergeCompletedBranchesInput): Promise<MergeCompletedBranchesResult> => {
  const completedBranches = collectCompletedChildBranches(childResults)

  if (completedBranches.length === 0) {
    return {
      completedBranches,
      status: 'skipped',
    }
  }

  const result = await runMergePrompt({
    completedBranches,
    parentIssue: plan.parentIssue,
    promptArgs: createMergePromptArguments({
      completedBranches,
    }),
    promptFile: MERGE_PROMPT_FILE,
  })

  return {
    branchName: result.branchName,
    completedBranches,
    logFilePath: result.logFilePath,
    status: 'merged',
  }
}

export const runMergePromptWithSandcastle: MergePromptRunner = async ({
  parentIssue,
  promptArgs,
  promptFile,
}) => {
  const result = await run({
    agent: codex(process.env.SANDCASTLE_CODEX_MODEL ?? DEFAULT_CODEX_MODEL, {
      effort: DEFAULT_CODEX_EFFORT,
    }),
    branchStrategy: {
      branch: parentIssue.branchName,
      type: 'branch',
    },
    completionSignal: COMPLETION_SIGNAL,
    maxIterations: MAX_ITERATIONS,
    name: `merge-${String(parentIssue.number)}`,
    promptArgs,
    promptFile,
    sandbox: createCodexDockerSandbox(),
  })

  return {
    branchName: result.branch,
    logFilePath: result.logFilePath,
  }
}

export const createOrReusePrdDraftPullRequest = async ({
  completedBranches = [],
  gateway = githubCliDraftPullRequestGateway,
  plan,
}: CreateOrReusePrdDraftPullRequestInput): Promise<DraftPullRequestLifecycleResult> => {
  await gateway.ensureParentBranch(plan.parentIssue.branchName)
  await gateway.pushParentBranch(plan.parentIssue.branchName)

  const existingPullRequest = await gateway.findDraftPullRequest(plan.parentIssue.branchName)

  if (existingPullRequest !== undefined) {
    return {
      pullRequest: existingPullRequest,
      status: 'reused',
    }
  }

  const pullRequest = await gateway.createDraftPullRequest({
    body: createDraftPullRequestBody({
      completedBranches,
      plan,
    }),
    branchName: plan.parentIssue.branchName,
    draft: true,
    title: plan.parentIssue.title,
  })

  return {
    pullRequest,
    status: 'created',
  }
}

export const createDraftPullRequestBody = ({
  completedBranches = [],
  plan,
}: {
  readonly plan: PlannerPlan
  readonly completedBranches?: readonly CompletedChildBranch[]
}): string => {
  const childIssueLines = plan.children.map((child) => `- #${String(child.number)} ${child.title}`)
  const completedBranchLines = completedBranches.map(
    ({ branchName, issue }) => `- ${branchName} for #${String(issue.number)}`,
  )

  return [
    `Parent PRD: #${String(plan.parentIssue.number)} ${plan.parentIssue.title}`,
    '',
    'Draft: yes',
    '',
    'Child issues:',
    ...childIssueLines,
    '',
    'Completed branches:',
    ...(completedBranchLines.length > 0 ? completedBranchLines : ['- None yet']),
    '',
    'GitHub issues and this pull request are the durable workflow state.',
  ].join('\n')
}

export const githubCliDraftPullRequestGateway: DraftPullRequestGateway = {
  createDraftPullRequest: async ({ body, branchName, title }) => {
    try {
      const createArguments = [
        'pr',
        'create',
        '--head',
        branchName,
        '--title',
        title,
        '--body',
        body,
        '--draft',
      ]
      const output = await runCommand('gh', createArguments)
      const url = output.trim()

      return await viewPullRequest(url)
    } catch (error: unknown) {
      throw new Error(
        `Unable to create a draft pull request for ${branchName}. Run \`gh auth status\` and confirm GitHub CLI can access this repository. ${formatErrorMessage(error)}`,
      )
    }
  },
  ensureParentBranch: async (branchName) => {
    if (await localBranchExists(branchName)) {
      await runCommand('git', ['switch', branchName])

      return
    }

    if (await remoteBranchExists(branchName)) {
      await runCommand('git', [
        'switch',
        '--track',
        '--create',
        branchName,
        `${GIT_REMOTE_NAME}/${branchName}`,
      ])

      return
    }

    await runCommand('git', ['switch', '--create', branchName])
  },
  findDraftPullRequest: async (branchName) => {
    try {
      const output = await runCommand('gh', [
        'pr',
        'list',
        '--head',
        branchName,
        '--state',
        'open',
        '--json',
        'number,url,isDraft',
      ])
      const pullRequests = parsePullRequestList(output)

      return pullRequests.find(({ isDraft }) => isDraft)
    } catch (error: unknown) {
      throw new Error(
        `Unable to list draft pull requests for ${branchName}. Run \`gh auth status\` and confirm GitHub CLI can access this repository. ${formatErrorMessage(error)}`,
      )
    }
  },
  pushParentBranch: async (branchName) => {
    if (!(await remoteExists(GIT_REMOTE_NAME))) {
      throw new Error(
        `Missing Git remote '${GIT_REMOTE_NAME}'. Configure it before creating Sandcastle PRD draft pull requests.`,
      )
    }

    try {
      await runCommand('git', [
        'push',
        '--set-upstream',
        GIT_REMOTE_NAME,
        `${branchName}:${branchName}`,
      ])
    } catch (error: unknown) {
      throw new Error(
        `Unable to push parent PRD branch ${branchName} to ${GIT_REMOTE_NAME}. Check git credentials and remote permissions. ${formatErrorMessage(error)}`,
      )
    }
  },
}

export const createCodexDockerOptions = ({
  fileExists = existsSync,
  hostCodexHome = getHostCodexHome(),
}: CreateCodexDockerOptionsInput = {}): DockerOptions => {
  const hostAuthPath = path.join(hostCodexHome, 'auth.json')
  const hostConfigPath = path.join(hostCodexHome, 'config.toml')

  if (!fileExists(hostAuthPath)) {
    throw new Error(
      `Codex subscription auth requires ${hostAuthPath}. Run \`codex login\` locally first.`,
    )
  }

  return {
    env: {
      CODEX_HOME: SANDBOX_CODEX_HOME,
    },
    imageName: getSandcastleDockerImageName(),
    mounts: [
      {
        hostPath: hostAuthPath,
        readonly: true,
        sandboxPath: `${SANDBOX_CODEX_HOME}/auth.json`,
      },
      ...(fileExists(hostConfigPath)
        ? [
            {
              hostPath: hostConfigPath,
              readonly: true,
              sandboxPath: `${SANDBOX_CODEX_HOME}/config.toml`,
            },
          ]
        : []),
    ],
  }
}

const createCodexDockerSandbox = () => docker(createCodexDockerOptions())

export const runPreflight = async (): Promise<PreflightResult> => {
  const checks = [
    await checkDockerAvailability(),
    await checkSandcastleDockerImage(),
    checkCodexAuthMounts(),
    await checkGitHubCliAuth(),
    await checkGitBranchReadiness(),
  ]
  const status = checks.every(({ status }) => status === 'passed') ? 'passed' : 'failed'

  return {
    checks,
    status,
  }
}

export const runDryRun = async (): Promise<WorkflowDryRunResult> => {
  let hasPlanned = false
  const workflowResult = await runWorkflow({
    draftPullRequestGateway: createDryRunDraftPullRequestGateway(),
    executeChild: runDryRunChildTask,
    maxIterations: 2,
    maxParallel: 1,
    runMergePrompt: async () => {
      await Promise.resolve()

      return {
        branchName: createDryRunPlan().parentIssue.branchName,
        logFilePath: '.sandcastle/logs/dry-run-merge.log',
      }
    },
    runPlanner: async () => {
      await Promise.resolve()

      if (hasPlanned) {
        return {
          kind: 'no-work',
        }
      }

      hasPlanned = true

      return parsePlannerOutput(
        `${PLAN_START_SIGNAL}${JSON.stringify(createDryRunPlan())}${PLAN_END_SIGNAL}`,
      )
    },
  })
  const iteration = workflowResult.iterations[0]

  if (iteration === undefined) {
    throw new Error('Dry run must produce one workflow iteration.')
  }

  return {
    childResults: iteration.childResults,
    draftPullRequestResult: iteration.draftPullRequestResult,
    mergeResult: iteration.mergeResult,
    plannerOutput: iteration.plannerOutput,
    steps: ['planner', 'implementer', 'reviewer', 'merger', 'draft-pr'],
  }
}

export const createWorkflowReport = ({
  mode,
  result,
}: {
  readonly mode: WorkflowReport['mode']
  readonly result: WorkflowResult
}): WorkflowReport => {
  const childResults = result.iterations.flatMap(({ childResults }) => childResults)
  const mergeResults = result.iterations.map(({ mergeResult }) =>
    toWorkflowMergeReport(mergeResult),
  )
  const draftPullRequests = result.iterations.map(({ draftPullRequestResult }) =>
    toWorkflowDraftPullRequestReport(draftPullRequestResult),
  )
  const logFilePaths = [
    ...childResults.flatMap(({ logFilePaths }) => logFilePaths),
    ...result.iterations.flatMap(({ mergeResult }) =>
      mergeResult.status === 'merged' ? compactOptionalString([mergeResult.logFilePath]) : [],
    ),
  ]

  return {
    completedBranches: result.iterations.flatMap(({ mergeResult }) =>
      mergeResult.completedBranches.map(({ branchName }) => branchName),
    ),
    draftPullRequests,
    failedBranches: childResults.filter(isFailedChildResult).map((childResult) => ({
      branchName: childResult.branchName,
      error: childResult.error,
      issueNumber: childResult.child.number,
      logFilePaths: childResult.logFilePaths,
    })),
    iterations: result.iterations.length,
    logFilePaths,
    mergeResults,
    mode,
    status: result.status,
  }
}

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replaceAll(/^-+|-+$/g, '')

  return slug.length > 0 ? slug : 'task'
}

const extractPlannerPayload = (output: string): string => {
  const startIndex = output.indexOf(PLAN_START_SIGNAL)
  const endIndex = output.indexOf(PLAN_END_SIGNAL)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Planner output must include a JSON payload between plan tags.')
  }

  return output.slice(startIndex + PLAN_START_SIGNAL.length, endIndex).trim()
}

const parsePlannerPlan = (value: unknown): PlannerPlan => {
  if (!isRecord(value)) {
    throw new Error('Planner output must be a JSON object.')
  }

  const parentIssue = parsePlannedIssue(value.parentIssue, 'parentIssue')
  const children = parsePlannedIssueList(value.children)

  return {
    parentIssue,
    children,
  }
}

const parsePlannedIssueList = (value: unknown): readonly PlannedIssue[] => {
  if (!Array.isArray(value)) {
    throw new TypeError('Planner output must include a children array.')
  }

  return value.map((child) => parsePlannedIssue(child, 'children[]'))
}

const parsePlannedIssue = (value: unknown, label: string): PlannedIssue => {
  if (!isRecord(value)) {
    throw new Error(`Planner output field ${label} must be an object.`)
  }

  const issueNumber = value.number
  const title = value.title
  const branchName = value.branchName

  if (typeof issueNumber !== 'number' || !Number.isInteger(issueNumber)) {
    throw new TypeError(`Planner output field ${label}.number must be an integer.`)
  }

  if (typeof title !== 'string' || title.length === 0) {
    throw new TypeError(`Planner output field ${label}.title must be a string.`)
  }

  if (typeof branchName !== 'string' || branchName.length === 0) {
    throw new TypeError(`Planner output field ${label}.branchName must be a string.`)
  }

  return {
    number: issueNumber,
    title,
    branchName,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const createChildPromptArguments = ({
  child,
  parentIssue,
}: {
  readonly child: PlannedIssue
  readonly parentIssue: PlannedIssue
}): PromptArgs => ({
  CHILD_BRANCH_NAME: child.branchName,
  CHILD_ISSUE_NUMBER: child.number,
  CHILD_ISSUE_TITLE: child.title,
  PARENT_BRANCH_NAME: parentIssue.branchName,
  PARENT_ISSUE_NUMBER: parentIssue.number,
  PARENT_ISSUE_TITLE: parentIssue.title,
})

const createMergePromptArguments = ({
  completedBranches,
}: {
  readonly completedBranches: readonly CompletedChildBranch[]
}): PromptArgs => ({
  CHILD_ISSUES: JSON.stringify(
    completedBranches.map(({ issue }) => ({
      number: issue.number,
      title: issue.title,
    })),
  ),
  COMPLETED_BRANCHES: JSON.stringify(completedBranches.map(({ branchName }) => branchName)),
})

const createSandboxSetupHooks = (): SandboxHooks => ({
  sandbox: {
    onSandboxReady: [
      {
        command: 'corepack enable pnpm',
      },
      {
        command: 'pnpm install --frozen-lockfile',
      },
    ],
  },
})

const isFulfilledChildWithCommits = (
  result: ChildTaskExecutionResult,
): result is Extract<ChildTaskExecutionResult, { readonly status: 'fulfilled' }> =>
  result.status === 'fulfilled' &&
  result.implementationCommits.length + result.reviewCommits.length > 0

const isFailedChildResult = (
  result: ChildTaskExecutionResult,
): result is Extract<ChildTaskExecutionResult, { readonly status: 'failed' }> =>
  result.status === 'failed'

const toWorkflowMergeReport = (result: MergeCompletedBranchesResult): WorkflowMergeReport => {
  const completedBranches = result.completedBranches.map(({ branchName }) => branchName)

  if (result.status === 'skipped') {
    return {
      completedBranches,
      status: 'skipped',
    }
  }

  return {
    branchName: result.branchName,
    completedBranches,
    logFilePath: result.logFilePath,
    status: 'merged',
  }
}

const toWorkflowDraftPullRequestReport = ({
  pullRequest,
  status,
}: DraftPullRequestLifecycleResult): WorkflowDraftPullRequestReport => ({
  isDraft: pullRequest.isDraft,
  number: pullRequest.number,
  status,
  url: pullRequest.url,
})

const compactOptionalString = (values: readonly (string | undefined)[]): readonly string[] =>
  values.filter(isDefined)

const isDefined = <Value>(value: Value | undefined): value is Value => value !== undefined

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const extractLogFilePath = (error: unknown): string | undefined => {
  if (!isRecord(error)) {
    return undefined
  }

  const logFilePath = error.logFilePath

  return typeof logFilePath === 'string' && logFilePath.length > 0 ? logFilePath : undefined
}

const getSandcastleDockerImageName = (): string =>
  process.env.SANDCASTLE_DOCKER_IMAGE ?? 'sandcastle:cv-maxxing'

const getHostCodexHome = (): string =>
  process.env.SANDCASTLE_HOST_CODEX_HOME ?? path.join(homedir(), '.codex')

const checkDockerAvailability = async (): Promise<PreflightCheckResult> => {
  try {
    await runCommand('docker', ['info', '--format', '{{json .ServerVersion}}'])

    return {
      message: 'Docker daemon is available.',
      name: 'docker',
      status: 'passed',
    }
  } catch (error: unknown) {
    return {
      message: `Docker is unavailable. Start Docker Desktop or a compatible Docker daemon, then rerun preflight. ${formatErrorMessage(error)}`,
      name: 'docker',
      status: 'failed',
    }
  }
}

const checkSandcastleDockerImage = async (): Promise<PreflightCheckResult> => {
  const imageName = getSandcastleDockerImageName()

  try {
    await runCommand('docker', ['image', 'inspect', imageName])

    return {
      message: `Sandcastle image ${imageName} exists locally.`,
      name: 'sandcastle-image',
      status: 'passed',
    }
  } catch (error: unknown) {
    return {
      message: `Sandcastle image ${imageName} is missing. Build it with \`pnpm exec sandcastle docker build-image --image-name ${imageName}\`. ${formatErrorMessage(error)}`,
      name: 'sandcastle-image',
      status: 'failed',
    }
  }
}

const checkCodexAuthMounts = (): PreflightCheckResult => {
  const hostCodexHome = getHostCodexHome()
  const hostAuthPath = path.join(hostCodexHome, 'auth.json')
  const hostConfigPath = path.join(hostCodexHome, 'config.toml')

  if (!existsSync(hostAuthPath)) {
    return {
      message: `Codex auth file ${hostAuthPath} is missing. Run \`codex login\` locally or set SANDCASTLE_HOST_CODEX_HOME.`,
      name: 'codex-auth',
      status: 'failed',
    }
  }

  const configMessage = existsSync(hostConfigPath)
    ? ` Optional config ${hostConfigPath} will also be mounted.`
    : ''

  return {
    message: `Codex auth file ${hostAuthPath} can be mounted into the sandbox.${configMessage}`,
    name: 'codex-auth',
    status: 'passed',
  }
}

const checkGitHubCliAuth = async (): Promise<PreflightCheckResult> => {
  try {
    await runCommand('gh', ['auth', 'status', '--hostname', 'github.com'])

    return {
      message: 'GitHub CLI authentication is usable.',
      name: 'github-cli',
      status: 'passed',
    }
  } catch (error: unknown) {
    return {
      message: `GitHub CLI authentication is not usable. Run \`gh auth login\` or fix \`gh auth status\` before running the workflow. ${formatErrorMessage(error)}`,
      name: 'github-cli',
      status: 'failed',
    }
  }
}

const checkGitBranchReadiness = async (): Promise<PreflightCheckResult> => {
  try {
    await runCommand('git', ['rev-parse', '--is-inside-work-tree'])
    await runCommand('git', ['rev-parse', '--verify', 'HEAD'])
    await runCommand('git', ['check-ref-format', 'refs/heads/prd-0-sandcastle-preflight'])
    await runCommand('git', ['check-ref-format', 'refs/heads/child-0-sandcastle-preflight'])

    return {
      message: 'Git repository and branch ref operations are available.',
      name: 'git-branch-operations',
      status: 'passed',
    }
  } catch (error: unknown) {
    return {
      message: `Git branch operations are not ready. Run from a valid repository with a checked-out HEAD before starting the workflow. ${formatErrorMessage(error)}`,
      name: 'git-branch-operations',
      status: 'failed',
    }
  }
}

const createDryRunPlan = (): PlannerPlan => {
  const parentIssue: PlannedIssue = {
    branchName: createPrdBranchName(100, 'PRD: Automate PRD issue workflow'),
    number: 100,
    title: 'PRD: Automate PRD issue workflow',
  }
  const child: PlannedIssue = {
    branchName: createChildBranchName(101, 'Implement the first workflow slice'),
    number: 101,
    title: 'Implement the first workflow slice',
  }

  return {
    children: [child],
    parentIssue,
  }
}

const runDryRunChildTask: ChildTaskExecutor = async ({ child }) => {
  await Promise.resolve()

  return {
    branchName: child.branchName,
    child,
    implementationCommits: [{ sha: 'dry-run-implementation' }],
    logFilePaths: [
      `.sandcastle/logs/dry-run-implement-${String(child.number)}.log`,
      `.sandcastle/logs/dry-run-review-${String(child.number)}.log`,
    ],
    reviewCommits: [{ sha: 'dry-run-review' }],
    status: 'fulfilled',
  }
}

const createDryRunDraftPullRequestGateway = (): DraftPullRequestGateway => ({
  createDraftPullRequest: async ({ branchName }) => {
    await Promise.resolve()

    return {
      isDraft: true,
      number: 1,
      url: `https://github.com/motech-development/cv-maxxing/pull/dry-run-${branchName}`,
    }
  },
  ensureParentBranch: async () => {
    await Promise.resolve()
  },
  findDraftPullRequest: async () => {
    const pullRequests: readonly DraftPullRequest[] = []
    await Promise.resolve()

    return pullRequests.find(({ isDraft }) => isDraft)
  },
  pushParentBranch: async () => {
    await Promise.resolve()
  },
})

const localBranchExists = async (branchName: string): Promise<boolean> => {
  try {
    await runCommand('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`])

    return true
  } catch (error: unknown) {
    if (isCommandExitCode(error, GIT_BRANCH_MISSING_EXIT_CODE)) {
      return false
    }

    throw error
  }
}

const remoteExists = async (remoteName: string): Promise<boolean> => {
  try {
    await runCommand('git', ['remote', 'get-url', remoteName])

    return true
  } catch {
    return false
  }
}

const remoteBranchExists = async (branchName: string): Promise<boolean> => {
  if (!(await remoteExists(GIT_REMOTE_NAME))) {
    return false
  }

  try {
    await runCommand('git', ['ls-remote', '--exit-code', '--heads', GIT_REMOTE_NAME, branchName])

    return true
  } catch (error: unknown) {
    if (isCommandExitCode(error, GIT_REMOTE_REF_MISSING_EXIT_CODE)) {
      return false
    }

    throw error
  }
}

const runCommand = async (
  command: string,
  commandArguments: readonly string[],
): Promise<string> => {
  const { stdout } = await execFileAsync(command, [...commandArguments], {
    timeout: COMMAND_TIMEOUT_MS,
  })

  return stdout
}

const isCommandExitCode = (error: unknown, exitCode: number): boolean =>
  isRecord(error) && error.code === exitCode

const viewPullRequest = async (url: string): Promise<DraftPullRequest> => {
  const output = await runCommand('gh', ['pr', 'view', url, '--json', 'number,url,isDraft'])
  const parsed: unknown = JSON.parse(output)

  return parseDraftPullRequest(parsed)
}

const parsePullRequestList = (output: string): readonly DraftPullRequest[] => {
  const parsed: unknown = JSON.parse(output)

  if (!Array.isArray(parsed)) {
    throw new TypeError('GitHub PR list output must be an array.')
  }

  return parsed.map((value) => parseDraftPullRequest(value))
}

const parseDraftPullRequest = (value: unknown): DraftPullRequest => {
  if (!isRecord(value)) {
    throw new TypeError('GitHub PR output must be an object.')
  }

  const number = value.number
  const url = value.url
  const isDraft = value.isDraft

  if (typeof number !== 'number' || !Number.isInteger(number)) {
    throw new TypeError('GitHub PR number must be an integer.')
  }

  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('GitHub PR URL must be a string.')
  }

  if (typeof isDraft !== 'boolean') {
    throw new TypeError('GitHub PR draft state must be a boolean.')
  }

  return {
    isDraft,
    number,
    url,
  }
}

const main = async (): Promise<void> => {
  if (process.argv.includes('--dry-run')) {
    const result = await runDryRun()

    console.info(JSON.stringify(result, null, 2))

    return
  }

  if (process.argv.includes('--preflight')) {
    const result = await runPreflight()

    console.info(JSON.stringify(result, null, 2))

    if (result.status === 'failed') {
      process.exitCode = 1
    }

    return
  }

  const result = await runWorkflow()
  const report = createWorkflowReport({
    mode: 'live',
    result,
  })

  console.info(JSON.stringify(report, null, 2))
}

if (process.argv[1]?.endsWith('/.sandcastle/main.ts') === true) {
  try {
    await main()
  } catch (error: unknown) {
    console.error(formatErrorMessage(error))
    process.exitCode = 1
  }
}
