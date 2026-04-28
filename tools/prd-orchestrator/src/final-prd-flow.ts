import type { CodeRabbitFinding } from './coderabbit-review.js'

export type CiStatus = 'failed' | 'passed' | 'pending'

export interface AutomationPrOwnershipInput {
  readonly body: string
  readonly branchName: string
  readonly prNumber: number
}

export interface AutomationPrOwnership {
  readonly blockers: readonly string[]
  readonly valid: boolean
}

export interface PlanGitHubActionsPollingInput {
  readonly allChildrenComplete: boolean
  readonly branchName?: string
  readonly prdBranchPushed: boolean
  readonly prNumber: number
}

export interface GitHubActionsPollingPlan {
  readonly command: string | undefined
  readonly reason: string
  readonly shouldPoll: boolean
}

export interface GitHubActionsRun {
  readonly conclusion: string | undefined
  readonly name: string
  readonly status: string
}

export interface InterpretGitHubActionsStatusInput {
  readonly runs: readonly GitHubActionsRun[]
}

export interface GitHubActionsStatus {
  readonly blockers: readonly string[]
  readonly status: CiStatus
}

export interface ChildCommitReference {
  readonly childIssueNumber: number
  readonly commitHash: string
}

export interface ResumePrFinding extends CodeRabbitFinding {
  readonly childIssueNumber?: number
}

export interface PlanResumePrRepairInput {
  readonly childCommits: readonly ChildCommitReference[]
  readonly findings: readonly ResumePrFinding[]
  readonly ownership: AutomationPrOwnershipInput
  readonly prIsDraft: boolean
}

export interface ResumePrRepairPlan {
  readonly action: 'blocked' | 'clean' | 'repair'
  readonly amendChildCommits: readonly {
    readonly childIssueNumber: number
    readonly commitHash: string
    readonly findingIds: readonly string[]
  }[]
  readonly blockers: readonly string[]
  readonly finalCleanupCommit:
    | {
        readonly findingIds: readonly string[]
        readonly message: 'chore: address final PRD review findings'
      }
    | undefined
  readonly forcePush:
    | {
        readonly branchName: string
        readonly mode: 'force-with-lease'
      }
    | undefined
  readonly inspectCi: boolean
  readonly inspectCodeRabbit: boolean
  readonly returnToDraft: boolean
}

export interface ParentUserStoryAudit {
  readonly issueNumbers: readonly number[]
  readonly storyNumber: number
}

export interface ChildTaskAudit {
  readonly acceptanceCriteria: readonly string[]
  readonly issueNumber: number
  readonly title: string
  readonly userStoriesAddressed: readonly number[]
}

export interface GenerateFinalPrdAcceptanceAuditInput {
  readonly architectureChecks: readonly string[]
  readonly childTasks: readonly ChildTaskAudit[]
  readonly ciStatus: CiStatus
  readonly codeRabbitStatus: string
  readonly mergeInstructions: string
  readonly parentPrdIssueNumber: number
  readonly parentUserStories: readonly ParentUserStoryAudit[]
  readonly verificationEvidence: readonly string[]
}

export interface EvaluateReadyForReviewGateInput {
  readonly allChildrenComplete: boolean
  readonly ciStatus: CiStatus
  readonly codeRabbitStatus: string
  readonly finalAuditCommentPlanned: boolean
  readonly finalAuditCommentPosted: boolean
  readonly localGatesPassed: boolean
}

export interface ReadyForReviewGate {
  readonly blockers: readonly string[]
  readonly ready: boolean
}

const orchestratorBranchPrefix = 'agent/prd-'
const automationOwnerLine = 'Managed by `@cv-maxxing/prd-orchestrator`.'
const finalCleanupCommitMessage = 'chore: address final PRD review findings'

export const validateAutomationPrOwnership = (
  input: AutomationPrOwnershipInput,
): AutomationPrOwnership => {
  const blockers = [
    ...(input.branchName.startsWith(orchestratorBranchPrefix)
      ? []
      : [
          `PR #${String(input.prNumber)} branch ${
            input.branchName
          } is not an orchestrator PRD branch`,
        ]),
    ...(input.body.includes('## Automation') && input.body.includes(automationOwnerLine)
      ? []
      : [`PR #${String(input.prNumber)} body is missing the orchestrator Automation section`]),
  ]

  return {
    blockers,
    valid: blockers.length === 0,
  }
}

export const planGitHubActionsPolling = (
  input: PlanGitHubActionsPollingInput,
): GitHubActionsPollingPlan => {
  if (!input.allChildrenComplete || !input.prdBranchPushed) {
    return {
      command: undefined,
      reason: 'GitHub Actions are deferred until all child tasks are complete and pushed.',
      shouldPoll: false,
    }
  }

  if (input.branchName === undefined) {
    return {
      command: undefined,
      reason: 'GitHub Actions polling requires the pushed PRD branch name.',
      shouldPoll: false,
    }
  }

  return {
    command: `gh run list --branch ${input.branchName} --json status,conclusion`,
    reason: 'Full PRD implementation is pushed; poll CI before final audit.',
    shouldPoll: true,
  }
}

export const interpretGitHubActionsStatus = (
  input: InterpretGitHubActionsStatusInput,
): GitHubActionsStatus => {
  const failedRuns = input.runs.filter(
    (run) => run.status === 'completed' && run.conclusion !== 'success',
  )

  if (failedRuns.length > 0) {
    return {
      blockers: failedRuns.map(
        (run) =>
          `GitHub Actions run ${run.name} failed with conclusion ${run.conclusion ?? 'unknown'}`,
      ),
      status: 'failed',
    }
  }

  if (input.runs.some((run) => run.status !== 'completed')) {
    return {
      blockers: [],
      status: 'pending',
    }
  }

  return {
    blockers: [],
    status: 'passed',
  }
}

export const planResumePrRepair = (input: PlanResumePrRepairInput): ResumePrRepairPlan => {
  const ownership = validateAutomationPrOwnership(input.ownership)

  if (!ownership.valid) {
    return {
      action: 'blocked',
      amendChildCommits: [],
      blockers: ownership.blockers,
      finalCleanupCommit: undefined,
      forcePush: undefined,
      inspectCi: false,
      inspectCodeRabbit: false,
      returnToDraft: false,
    }
  }

  const findingsByChild = mapFindingsToChildCommits({
    childCommits: input.childCommits,
    findings: input.findings,
  })
  const mappedFindingIds = new Set(findingsByChild.flatMap((entry) => [...entry.findingIds]))
  const finalCleanupFindingIds = input.findings
    .filter((finding) => !mappedFindingIds.has(finding.id))
    .map((finding) => finding.id)
  const hasRepairWork = findingsByChild.length > 0 || finalCleanupFindingIds.length > 0

  return {
    action: hasRepairWork ? 'repair' : 'clean',
    amendChildCommits: findingsByChild,
    blockers: [],
    finalCleanupCommit:
      finalCleanupFindingIds.length === 0
        ? undefined
        : {
            findingIds: finalCleanupFindingIds,
            message: finalCleanupCommitMessage,
          },
    forcePush: hasRepairWork
      ? {
          branchName: input.ownership.branchName,
          mode: 'force-with-lease',
        }
      : undefined,
    inspectCi: true,
    inspectCodeRabbit: true,
    returnToDraft: !input.prIsDraft && hasRepairWork,
  }
}

export const generateFinalPrdAcceptanceAudit = (
  input: GenerateFinalPrdAcceptanceAuditInput,
): string =>
  [
    '## Final PRD Acceptance Audit',
    '',
    `Parent PRD: #${String(input.parentPrdIssueNumber)}`,
    '',
    '### User Story Coverage',
    ...input.parentUserStories.map(
      (story) =>
        `- User story ${String(story.storyNumber)}: ${formatIssueReferences(story.issueNumbers)}`,
    ),
    '',
    '### Child Acceptance Criteria',
    ...formatChildAcceptanceCriteria(input.childTasks),
    '',
    '### Verification Evidence',
    ...formatBulletList(input.verificationEvidence),
    '',
    '### Architecture And Out-of-Scope Checks',
    ...formatBulletList(input.architectureChecks),
    '',
    '### Review And CI',
    `CodeRabbit: ${input.codeRabbitStatus}`,
    `GitHub Actions: ${input.ciStatus}`,
    '',
    '### Merge Instructions',
    input.mergeInstructions,
  ].join('\n')

export const evaluateReadyForReviewGate = (
  input: EvaluateReadyForReviewGateInput,
): ReadyForReviewGate => {
  const blockers = [
    ...(input.allChildrenComplete ? [] : ['not all child tasks are complete']),
    ...(input.localGatesPassed ? [] : ['local gates have not passed']),
    ...(input.codeRabbitStatus === 'passed'
      ? []
      : [`CodeRabbit status is ${input.codeRabbitStatus}`]),
    ...(input.ciStatus === 'passed' ? [] : [`GitHub Actions status is ${input.ciStatus}`]),
    ...(input.finalAuditCommentPlanned ? [] : ['final PRD acceptance audit is not planned']),
    ...(input.finalAuditCommentPosted ? [] : ['final PRD acceptance audit has not been posted']),
  ]

  return {
    blockers,
    ready: blockers.length === 0,
  }
}

const mapFindingsToChildCommits = (input: {
  readonly childCommits: readonly ChildCommitReference[]
  readonly findings: readonly ResumePrFinding[]
}): ResumePrRepairPlan['amendChildCommits'] =>
  input.childCommits.flatMap((childCommit) => {
    const findingIds = input.findings
      .filter((finding) => finding.childIssueNumber === childCommit.childIssueNumber)
      .map((finding) => finding.id)

    if (findingIds.length === 0) {
      return []
    }

    return [
      {
        childIssueNumber: childCommit.childIssueNumber,
        commitHash: childCommit.commitHash,
        findingIds,
      },
    ]
  })

const formatChildAcceptanceCriteria = (childTasks: readonly ChildTaskAudit[]): readonly string[] =>
  childTasks.flatMap((childTask) => [
    `- #${String(childTask.issueNumber)} ${childTask.title}`,
    ...childTask.acceptanceCriteria.map((criterion) => `  - ${criterion}`),
  ])

const formatBulletList = (items: readonly string[]): readonly string[] =>
  items.length === 0 ? ['- None recorded.'] : items.map((item) => `- ${item}`)

const formatIssueReferences = (issueNumbers: readonly number[]): string =>
  issueNumbers.map((issueNumber) => `#${String(issueNumber)}`).join(', ')
