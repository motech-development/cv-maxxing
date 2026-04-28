export interface PrdOrchestratorCommand {
  readonly name: string
  readonly description: string
  readonly mutatesRepository: boolean
}

export interface PrdOrchestratorLifecycle {
  readonly automationOwner: string
  readonly draftPullRequestPolicy: string
  readonly humanMergeBoundary: boolean
  readonly runStateRoot: string
}

export const prdOrchestratorCommands = [
  {
    description: 'Inspect the first available PRD and print a dry-run execution plan.',
    mutatesRepository: false,
    name: 'plan',
  },
  {
    description: 'Run the first eligible child task through the PRD automation loop.',
    mutatesRepository: true,
    name: 'run --one-child',
  },
  {
    description: 'Resume automation for an existing PRD draft pull request.',
    mutatesRepository: true,
    name: 'resume-pr <number>',
  },
  {
    description: 'Report local lock, run, Sandcastle, and draft pull-request status.',
    mutatesRepository: false,
    name: 'status',
  },
  {
    description: 'Remove stale local orchestrator and Sandcastle artifacts.',
    mutatesRepository: true,
    name: 'cleanup',
  },
] as const satisfies readonly PrdOrchestratorCommand[]

export const prdOrchestratorLifecycle = {
  automationOwner: '@cv-maxxing/prd-orchestrator',
  draftPullRequestPolicy: 'one draft PR per PRD',
  humanMergeBoundary: true,
  runStateRoot: '.git/prd-orchestrator/runs',
} as const satisfies PrdOrchestratorLifecycle

export {
  createDryRunPlan,
  isOpenPrdIssue,
  parseChildTaskIssue,
  renderDryRunPlan,
} from './planning.js'

export { createPlanFromIssueJson, runPrdOrchestratorCli } from './cli.js'

export {
  createChildCommitMessage,
  generateDraftPrBody,
  generateMergeInstructions,
  generatePrdConventionalCommitTitle,
  reconcileDraftPrStateFromCommits,
} from './draft-pr-state.js'

export type { PrdOrchestratorCliInput, PrdOrchestratorCliResult } from './cli.js'

export type {
  BranchCommit,
  ChildTaskProgress,
  ChildTaskProgressStatus,
  CreateChildCommitMessageInput,
  DraftPrChildTask,
  GenerateDraftPrBodyInput,
  GenerateMergeInstructionsInput,
  ReconcileDraftPrStateInput,
} from './draft-pr-state.js'

export type {
  ChildTaskDagNode,
  DryRunPlan,
  GitHubIssue,
  ParsedChildTask,
  SelectedPrdPlan,
  UnavailablePrd,
} from './planning.js'
