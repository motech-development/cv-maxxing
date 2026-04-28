import {
  recordNonActionableFinding,
  type CodeRabbitFinding,
  type NonActionableFindingRecord,
} from './coderabbit-review.js'

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
  readonly changedFiles?: readonly string[]
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
        readonly message: string
        readonly rationales: readonly ResumePrFinalCleanupFinding[]
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
  readonly nonActionableFindings: readonly NonActionableFindingRecord[]
  readonly returnToDraft: boolean
}

export interface ResumePrFinalCleanupFinding {
  readonly findingId: string
  readonly rationale: string
  readonly source: CodeRabbitFinding['source']
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
      nonActionableFindings: [],
      returnToDraft: false,
    }
  }

  const actionableFindings = input.findings.filter((finding) => finding.conflictsWith === undefined)
  const targetBlockers = findChildCommitTargetBlockers({
    ...input,
    findings: actionableFindings,
  })

  if (targetBlockers.length > 0) {
    return {
      action: 'blocked',
      amendChildCommits: [],
      blockers: targetBlockers,
      finalCleanupCommit: undefined,
      forcePush: undefined,
      inspectCi: false,
      inspectCodeRabbit: false,
      nonActionableFindings: [],
      returnToDraft: false,
    }
  }

  const nonActionableFindings = input.findings
    .filter((finding) => finding.conflictsWith !== undefined)
    .map((finding) => recordNonActionableFinding(finding))
  const mappedFindings = mapFindingsToChildCommits({
    childCommits: input.childCommits,
    findings: actionableFindings,
  })
  const mappedFindingIds = new Set(
    mappedFindings.amendChildCommits.flatMap((entry) => [...entry.findingIds]),
  )
  const finalCleanupFindings = actionableFindings
    .filter((finding) => !mappedFindingIds.has(finding.id))
    .map((finding) =>
      createFinalCleanupFinding({
        childCommits: input.childCommits,
        finding,
      }),
    )
  const hasRepairWork =
    mappedFindings.amendChildCommits.length > 0 || finalCleanupFindings.length > 0

  return {
    action: hasRepairWork ? 'repair' : 'clean',
    amendChildCommits: mappedFindings.amendChildCommits,
    blockers: [],
    finalCleanupCommit:
      finalCleanupFindings.length === 0
        ? undefined
        : {
            findingIds: finalCleanupFindings.map((finding) => finding.findingId),
            message: createFinalCleanupCommitMessage(finalCleanupFindings),
            rationales: finalCleanupFindings,
          },
    forcePush: hasRepairWork
      ? {
          branchName: input.ownership.branchName,
          mode: 'force-with-lease',
        }
      : undefined,
    inspectCi: true,
    inspectCodeRabbit: true,
    nonActionableFindings,
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
}): {
  readonly amendChildCommits: ResumePrRepairPlan['amendChildCommits']
} => ({
  amendChildCommits: input.childCommits.flatMap((childCommit) => {
    const findingIds = input.findings.flatMap((finding) => {
      const mapping = mapFindingToChildCommit({
        childCommits: input.childCommits,
        finding,
      })

      return mapping.childIssueNumber === childCommit.childIssueNumber ? [finding.id] : []
    })

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
  }),
})

const mapFindingToChildCommit = (input: {
  readonly childCommits: readonly ChildCommitReference[]
  readonly finding: ResumePrFinding
}): {
  readonly childIssueNumber: number | undefined
} => {
  if (input.finding.childIssueNumber !== undefined) {
    return {
      childIssueNumber: input.finding.childIssueNumber,
    }
  }

  const matchingCommit = input.childCommits.find((childCommit) =>
    commitHashesMatch(childCommit.commitHash, input.finding.commitHash),
  )

  if (matchingCommit !== undefined) {
    return {
      childIssueNumber: matchingCommit.childIssueNumber,
    }
  }

  if (input.finding.filePath !== undefined) {
    const matchingFileCommits = input.childCommits.filter((childCommit) =>
      childCommit.changedFiles?.includes(input.finding.filePath ?? ''),
    )

    if (matchingFileCommits.length === 1) {
      return {
        childIssueNumber: matchingFileCommits[0]?.childIssueNumber,
      }
    }
  }

  return {
    childIssueNumber: undefined,
  }
}

const createFinalCleanupFinding = (input: {
  readonly childCommits: readonly ChildCommitReference[]
  readonly finding: ResumePrFinding
}): ResumePrFinalCleanupFinding => ({
  findingId: input.finding.id,
  rationale: createFinalCleanupRationale(input),
  source: input.finding.source,
})

const createFinalCleanupRationale = (input: {
  readonly childCommits: readonly ChildCommitReference[]
  readonly finding: ResumePrFinding
}): string => {
  if (input.finding.filePath !== undefined) {
    const matchingFileCommits = input.childCommits.filter((childCommit) =>
      childCommit.changedFiles?.includes(input.finding.filePath ?? ''),
    )

    if (matchingFileCommits.length > 1) {
      return `File ${input.finding.filePath} matched multiple child commits: ${matchingFileCommits
        .map((childCommit) => `#${String(childCommit.childIssueNumber)}`)
        .join(', ')}.`
    }

    if (matchingFileCommits.length === 0) {
      return `File ${input.finding.filePath} did not match any child commit changed files.`
    }
  }

  if (input.finding.commitHash !== undefined) {
    return `Commit ${input.finding.commitHash} did not match a known child commit.`
  }

  return 'No child commit mapping context was available.'
}

const createFinalCleanupCommitMessage = (
  findings: readonly ResumePrFinalCleanupFinding[],
): string =>
  [
    finalCleanupCommitMessage,
    '',
    'Final cleanup rationale:',
    ...findings.map((finding) => `- ${finding.findingId}: ${finding.rationale}`),
  ].join('\n')

const commitHashesMatch = (
  childCommitHash: string,
  findingCommitHash: string | undefined,
): boolean =>
  findingCommitHash !== undefined &&
  (childCommitHash.startsWith(findingCommitHash) || findingCommitHash.startsWith(childCommitHash))

const formatChildAcceptanceCriteria = (childTasks: readonly ChildTaskAudit[]): readonly string[] =>
  childTasks.flatMap((childTask) => [
    `- #${String(childTask.issueNumber)} ${childTask.title}`,
    ...childTask.acceptanceCriteria.map((criterion) => `  - ${criterion}`),
  ])

const formatBulletList = (items: readonly string[]): readonly string[] =>
  items.length === 0 ? ['- None recorded.'] : items.map((item) => `- ${item}`)

const formatIssueReferences = (issueNumbers: readonly number[]): string =>
  issueNumbers.map((issueNumber) => `#${String(issueNumber)}`).join(', ')

const findChildCommitTargetBlockers = (input: PlanResumePrRepairInput): readonly string[] =>
  input.findings.flatMap((finding) => {
    const childIssueNumber = finding.childIssueNumber

    if (childIssueNumber === undefined) {
      return []
    }

    const matchingChildCommits = input.childCommits.filter(
      (childCommit) => childCommit.childIssueNumber === childIssueNumber,
    )

    if (matchingChildCommits.length === 0) {
      return [
        `Cannot safely find child commit for #${String(
          childIssueNumber,
        )} while repairing finding ${finding.id}`,
      ]
    }

    if (matchingChildCommits.length > 1) {
      return [
        `Cannot safely choose between ${String(
          matchingChildCommits.length,
        )} child commits for #${String(childIssueNumber)} while repairing finding ${finding.id}`,
      ]
    }

    return []
  })
