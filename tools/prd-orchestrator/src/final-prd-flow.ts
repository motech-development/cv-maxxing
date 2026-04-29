import {
  recordNonActionableFinding,
  type CodeRabbitFinding,
  type NonActionableFindingRecord,
} from './coderabbit-review.js'

export type CiStatus = 'blocked' | 'failed' | 'passed' | 'pending' | 'timed-out'

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
  readonly commitHash?: string
  readonly issueNumber: number
  readonly title: string
  readonly userStoriesAddressed: readonly number[]
  readonly verificationEvidence?: readonly string[]
}

export type ProhibitedCapabilityId =
  | 'automatic-updates'
  | 'mui'
  | 'non-pdf-exports'
  | 'redux'
  | 'remote-config'
  | 'required-web-backend'
  | 'runtime-font-cdn'
  | 'telemetry'

export type ProhibitedCapabilityScanStatus = 'absent' | 'inconclusive' | 'present'

export interface ProhibitedCapabilityMatch {
  readonly capabilityId: ProhibitedCapabilityId
  readonly evidence: string
}

export interface ProhibitedCapabilityScanResult {
  readonly capabilityId: ProhibitedCapabilityId
  readonly evidence: string
  readonly label: string
  readonly status: ProhibitedCapabilityScanStatus
}

export interface CreateProhibitedCapabilityScanResultsInput {
  readonly matches: readonly ProhibitedCapabilityMatch[]
  readonly scannedFiles: readonly string[]
}

export interface EvaluateFinalAuditEvidenceInput {
  readonly architectureChecks: readonly string[]
  readonly prohibitedCapabilityResults: readonly ProhibitedCapabilityScanResult[]
}

export interface FinalAuditEvidenceEvaluation {
  readonly blockers: readonly string[]
}

export interface GenerateFinalPrdAcceptanceAuditInput {
  readonly architectureChecks: readonly string[]
  readonly blockers?: readonly string[]
  readonly childTasks: readonly ChildTaskAudit[]
  readonly ciStatus: CiStatus
  readonly codeRabbitStatus: string
  readonly mergeInstructions: string
  readonly parentPrdIssueNumber: number
  readonly parentUserStories: readonly ParentUserStoryAudit[]
  readonly prohibitedCapabilityResults?: readonly ProhibitedCapabilityScanResult[]
  readonly verificationEvidence: readonly string[]
}

export interface EvaluateReadyForReviewGateInput {
  readonly allChildrenComplete: boolean
  readonly ciStatus: CiStatus
  readonly codeRabbitStatus: string
  readonly finalAuditEvidenceBlockers?: readonly string[]
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
const prohibitedCapabilityDefinitions = [
  {
    capabilityId: 'telemetry',
    label: 'Telemetry',
  },
  {
    capabilityId: 'remote-config',
    label: 'Remote config',
  },
  {
    capabilityId: 'required-web-backend',
    label: 'Required web backend',
  },
  {
    capabilityId: 'automatic-updates',
    label: 'Automatic updates',
  },
  {
    capabilityId: 'mui',
    label: 'MUI',
  },
  {
    capabilityId: 'redux',
    label: 'Redux',
  },
  {
    capabilityId: 'runtime-font-cdn',
    label: 'Runtime font CDN calls',
  },
  {
    capabilityId: 'non-pdf-exports',
    label: 'Non-PDF exports',
  },
] as const satisfies readonly {
  readonly capabilityId: ProhibitedCapabilityId
  readonly label: string
}[]

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
    command: `gh run list --branch ${shellQuote(input.branchName)} --json status,conclusion`,
    reason: 'Full PRD implementation is pushed; poll CI before final audit.',
    shouldPoll: true,
  }
}

export const interpretGitHubActionsStatus = (
  input: InterpretGitHubActionsStatusInput,
): GitHubActionsStatus => {
  if (input.runs.length === 0) {
    return {
      blockers: [],
      status: 'pending',
    }
  }

  const failedRuns = input.runs.filter(
    (run) => run.status === 'completed' && !isPassingGitHubActionsConclusion(run.conclusion),
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

const isPassingGitHubActionsConclusion = (conclusion: string | undefined): boolean =>
  conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped'

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
    '### Audit Blockers',
    ...formatBulletList(input.blockers ?? []),
    '',
    '### User Story Coverage',
    ...formatParentUserStoryCoverage(input),
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
    '### Prohibited Capability Scan',
    ...formatProhibitedCapabilityResults(input.prohibitedCapabilityResults ?? []),
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
    ...(input.finalAuditEvidenceBlockers ?? []),
    ...(input.finalAuditCommentPlanned ? [] : ['final PRD acceptance audit is not planned']),
    ...(input.finalAuditCommentPosted ? [] : ['final PRD acceptance audit has not been posted']),
  ]

  return {
    blockers,
    ready: blockers.length === 0,
  }
}

export const createProhibitedCapabilityScanResults = (
  input: CreateProhibitedCapabilityScanResultsInput,
): readonly ProhibitedCapabilityScanResult[] =>
  prohibitedCapabilityDefinitions.map((definition) => {
    const capabilityMatches = input.matches.filter(
      (match) => match.capabilityId === definition.capabilityId,
    )

    if (capabilityMatches.length > 0) {
      return {
        capabilityId: definition.capabilityId,
        evidence: capabilityMatches.map((match) => match.evidence).join('; '),
        label: definition.label,
        status: 'present',
      }
    }

    if (input.scannedFiles.length === 0) {
      return {
        capabilityId: definition.capabilityId,
        evidence: 'No changed files were available for prohibited-capability scanning.',
        label: definition.label,
        status: 'inconclusive',
      }
    }

    return {
      capabilityId: definition.capabilityId,
      evidence: `Scanned ${String(input.scannedFiles.length)} changed file(s); no ${definition.label.toLowerCase()} indicators found.`,
      label: definition.label,
      status: 'absent',
    }
  })

export const evaluateFinalAuditEvidence = (
  input: EvaluateFinalAuditEvidenceInput,
): FinalAuditEvidenceEvaluation => {
  const architectureEvidenceCitesSource = input.architectureChecks.some((check) =>
    architectureEvidenceCitationPattern.test(check),
  )
  const expectedCapabilityIds = new Set(
    prohibitedCapabilityDefinitions.map((definition) => definition.capabilityId),
  )
  const resultCapabilityIds = new Set(
    input.prohibitedCapabilityResults.map((result) => result.capabilityId),
  )
  const missingCapabilityLabels = prohibitedCapabilityDefinitions
    .filter((definition) => !resultCapabilityIds.has(definition.capabilityId))
    .map((definition) => definition.label)
  const prohibitedCapabilityBlockers = input.prohibitedCapabilityResults.flatMap((result) => {
    if (!expectedCapabilityIds.has(result.capabilityId)) {
      return []
    }

    if (result.status === 'present') {
      return [`Prohibited capability scan found ${result.label} evidence: ${result.evidence}`]
    }

    if (result.status === 'inconclusive') {
      return [`Prohibited capability scan for ${result.label} is inconclusive.`]
    }

    return []
  })
  const missingCapabilityBlockers =
    missingCapabilityLabels.length === 0
      ? []
      : [`Prohibited capability scan did not include: ${missingCapabilityLabels.join(', ')}.`]

  return {
    blockers: [
      ...(architectureEvidenceCitesSource
        ? []
        : [
            'Architecture evidence must cite ARCHITECTURE.md decisions or PRD out-of-scope constraints.',
          ]),
      ...missingCapabilityBlockers,
      ...prohibitedCapabilityBlockers,
    ],
  }
}

const architectureEvidenceCitationPattern = new RegExp(
  String.raw`\[ARCHITECTURE\.md\]\([^)]+\)|\bPRD\s+#\d+\s+Out of Scope\b`,
  'i',
)

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`

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

  const matchingCommits = input.childCommits.filter((childCommit) =>
    commitHashesMatch(childCommit.commitHash, input.finding.commitHash),
  )

  if (matchingCommits.length === 1) {
    return {
      childIssueNumber: matchingCommits[0]?.childIssueNumber,
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
    const matchingCommits = input.childCommits.filter((childCommit) =>
      commitHashesMatch(childCommit.commitHash, input.finding.commitHash),
    )

    if (matchingCommits.length > 1) {
      return `Commit ${input.finding.commitHash} matched multiple child commits: ${matchingCommits
        .map((childCommit) => `#${String(childCommit.childIssueNumber)}`)
        .join(', ')}.`
    }

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

const formatParentUserStoryCoverage = (
  input: GenerateFinalPrdAcceptanceAuditInput,
): readonly string[] =>
  input.parentUserStories.map((story) => {
    const childEvidence = story.issueNumbers
      .map((issueNumber) =>
        input.childTasks.find((childTask) => childTask.issueNumber === issueNumber),
      )
      .map((childTask, index) =>
        childTask === undefined
          ? formatIssueReference(story.issueNumbers[index] ?? 0)
          : formatChildEvidenceReference(childTask),
      )
      .join(', ')

    return `- User story ${String(story.storyNumber)}: ${childEvidence}`
  })

const formatChildAcceptanceCriteria = (childTasks: readonly ChildTaskAudit[]): readonly string[] =>
  childTasks.flatMap((childTask) => {
    const commitReference = formatCommitHash(childTask.commitHash)
    const verificationEvidence = formatInlineEvidence(childTask.verificationEvidence ?? [])

    return [
      `- #${String(childTask.issueNumber)} ${childTask.title} (commit ${commitReference})`,
      ...childTask.acceptanceCriteria.map(
        (criterion) =>
          `  - ${criterion} Evidence: commit ${commitReference}; ${verificationEvidence}`,
      ),
    ]
  })

const formatProhibitedCapabilityResults = (
  results: readonly ProhibitedCapabilityScanResult[],
): readonly string[] =>
  results.length === 0
    ? ['- No prohibited-capability scan was recorded.']
    : results.map((result) => `- ${result.label}: ${result.status} - ${result.evidence}`)

const formatBulletList = (items: readonly string[]): readonly string[] =>
  items.length === 0 ? ['- None recorded.'] : items.map((item) => `- ${item}`)

const formatIssueReference = (issueNumber: number): string => `#${String(issueNumber)}`

const formatChildEvidenceReference = (childTask: ChildTaskAudit): string =>
  `${formatIssueReference(childTask.issueNumber)} (${formatCommitHash(
    childTask.commitHash,
  )}; ${formatInlineEvidence(childTask.verificationEvidence ?? [])})`

const formatCommitHash = (commitHash: string | undefined): string =>
  commitHash === undefined ? 'missing' : `\`${commitHash.slice(0, 7)}\``

const formatInlineEvidence = (evidence: readonly string[]): string =>
  evidence.length === 0 ? 'verification evidence missing' : evidence.join('; ')

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
