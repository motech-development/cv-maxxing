export type CodeRabbitFindingSource = 'cli' | 'github-check' | 'github-pr-review'

export type CodeRabbitFindingConflict =
  | 'acceptance-criteria'
  | 'architecture-decision'
  | 'project-instructions'

export interface CodeRabbitFinding {
  readonly body: string
  readonly commitHash?: string
  readonly conflictsWith?: CodeRabbitFindingConflict
  readonly filePath?: string
  readonly id: string
  readonly lineNumber?: number
  readonly rationale?: string
  readonly source: CodeRabbitFindingSource
  readonly title: string
}

export interface CodeRabbitCommandInput {
  readonly childIssueNumber: number
  readonly hostVerificationPassed: boolean
  readonly prNumber: number
}

export interface CodeRabbitCommandPlan {
  readonly blocker?: string
  readonly command?: 'coderabbit review --agent'
  readonly phase: 'after-host-verification'
  readonly required: true
}

export interface NonActionableFindingRecord {
  readonly findingId: string
  readonly rationale: string
  readonly source: CodeRabbitFindingSource
}

export type CodeRabbitFindingClassification =
  | {
      readonly finding: CodeRabbitFinding
      readonly kind: 'actionable'
      readonly repairPrompt: string
    }
  | {
      readonly finding: CodeRabbitFinding
      readonly kind: 'non-actionable'
      readonly record: NonActionableFindingRecord
    }

export interface PlanChildCodeRabbitReviewInput {
  readonly branchName: string
  readonly childCommitHash: string
  readonly childIssueNumber: number
  readonly cliFindings: readonly CodeRabbitFinding[]
  readonly explicitBlocker: string | undefined
  readonly hostVerificationPassed: boolean
  readonly prIsDraft: boolean
  readonly prNumber: number
  readonly prReviewFindings: readonly CodeRabbitFinding[]
}

export type ChildCodeRabbitReviewAction = 'blocked' | 'clean' | 'repair-and-rerun'

export interface ChildCodeRabbitReviewPlan {
  readonly action: ChildCodeRabbitReviewAction
  readonly amendCommit:
    | {
        readonly commitHash: string
        readonly mode: 'git commit --amend'
      }
    | undefined
  readonly blocker?: string
  readonly command: CodeRabbitCommandPlan
  readonly forcePush:
    | {
        readonly branchName: string
        readonly mode: 'force-with-lease'
      }
    | undefined
  readonly nonActionableFindings: readonly NonActionableFindingRecord[]
  readonly prReviewInspection: {
    readonly prNumber: number
    readonly requiredAfterPush: true
  }
  readonly repairFindings: readonly CodeRabbitFindingClassification[]
  readonly rerun:
    | {
        readonly command: 'coderabbit review --agent'
        readonly until: 'clean-or-explicit-blocker'
      }
    | undefined
}

const coderabbitCommand = 'coderabbit review --agent'

export const planCodeRabbitCommand = (input: CodeRabbitCommandInput): CodeRabbitCommandPlan => {
  if (!input.hostVerificationPassed) {
    return {
      blocker: `CodeRabbit must wait for host-side verification to pass for #${String(
        input.childIssueNumber,
      )}`,
      command: undefined,
      phase: 'after-host-verification',
      required: true,
    }
  }

  return {
    command: coderabbitCommand,
    phase: 'after-host-verification',
    required: true,
  }
}

export const classifyCodeRabbitFinding = (
  finding: CodeRabbitFinding,
): CodeRabbitFindingClassification => {
  if (finding.conflictsWith !== undefined) {
    return {
      finding,
      kind: 'non-actionable',
      record: recordNonActionableFinding(finding),
    }
  }

  return {
    finding,
    kind: 'actionable',
    repairPrompt: `Fix CodeRabbit finding ${finding.id}: ${finding.title}\n\n${finding.body}`,
  }
}

export const recordNonActionableFinding = (
  finding: CodeRabbitFinding,
): NonActionableFindingRecord => ({
  findingId: finding.id,
  rationale:
    finding.rationale ??
    `Finding conflicts with ${formatConflict(finding.conflictsWith)} and has no CLI resolution mechanism.`,
  source: finding.source,
})

export const planChildCodeRabbitReview = (
  input: PlanChildCodeRabbitReviewInput,
): ChildCodeRabbitReviewPlan => {
  const command = planCodeRabbitCommand({
    childIssueNumber: input.childIssueNumber,
    hostVerificationPassed: input.hostVerificationPassed,
    prNumber: input.prNumber,
  })
  const classifications = [...input.cliFindings, ...input.prReviewFindings].map((finding) =>
    classifyCodeRabbitFinding(finding),
  )
  const repairFindings = classifications.filter(isActionableFinding)
  const nonActionableFindings = classifications
    .filter(isNonActionableFinding)
    .map((classification) => classification.record)
  const prReviewInspection = {
    prNumber: input.prNumber,
    requiredAfterPush: true,
  } as const

  if (input.explicitBlocker !== undefined || command.blocker !== undefined) {
    return {
      action: 'blocked',
      amendCommit: undefined,
      blocker: input.explicitBlocker ?? command.blocker,
      command,
      forcePush: undefined,
      nonActionableFindings,
      prReviewInspection,
      repairFindings,
      rerun: undefined,
    }
  }

  if (repairFindings.length === 0) {
    return {
      action: 'clean',
      amendCommit: undefined,
      command,
      forcePush: undefined,
      nonActionableFindings,
      prReviewInspection,
      repairFindings,
      rerun: undefined,
    }
  }

  return {
    action: 'repair-and-rerun',
    amendCommit: input.prIsDraft
      ? {
          commitHash: input.childCommitHash,
          mode: 'git commit --amend',
        }
      : undefined,
    command,
    forcePush: input.prIsDraft
      ? {
          branchName: input.branchName,
          mode: 'force-with-lease',
        }
      : undefined,
    nonActionableFindings,
    prReviewInspection,
    repairFindings,
    rerun: createRerunPlan(),
  }
}

const createRerunPlan = (): NonNullable<ChildCodeRabbitReviewPlan['rerun']> => ({
  command: coderabbitCommand,
  until: 'clean-or-explicit-blocker',
})

const isActionableFinding = (
  classification: CodeRabbitFindingClassification,
): classification is Extract<CodeRabbitFindingClassification, { readonly kind: 'actionable' }> =>
  classification.kind === 'actionable'

const isNonActionableFinding = (
  classification: CodeRabbitFindingClassification,
): classification is Extract<
  CodeRabbitFindingClassification,
  { readonly kind: 'non-actionable' }
> => classification.kind === 'non-actionable'

const formatConflict = (conflict: CodeRabbitFindingConflict | undefined): string => {
  if (conflict === 'acceptance-criteria') {
    return 'acceptance criteria'
  }

  if (conflict === 'architecture-decision') {
    return 'architecture decisions'
  }

  return 'project instructions'
}
