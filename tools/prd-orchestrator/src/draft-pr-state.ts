export interface DraftPrChildTask {
  readonly issueNumber: number
  readonly title: string
}

export type ChildTaskProgressStatus = 'blocked' | 'complete' | 'pending'

export interface ChildTaskProgress {
  readonly codeRabbitStatus: string
  readonly issueNumber: number
  readonly shortCommitHash?: string
  readonly status: ChildTaskProgressStatus
  readonly verificationStatus: string
}

export interface GenerateMergeInstructionsInput {
  readonly childTasks: readonly DraftPrChildTask[]
  readonly parentPrdIssueNumber: number
  readonly prdTitle: string
}

export interface GenerateDraftPrBodyInput extends GenerateMergeInstructionsInput {
  readonly branchName: string
  readonly ledger: readonly ChildTaskProgress[]
}

export interface CreateChildCommitMessageInput {
  readonly acceptanceEvidence: readonly string[]
  readonly childIssueNumber: number
  readonly childTitle: string
  readonly verificationEvidence: readonly string[]
}

export interface BranchCommit {
  readonly body: string
  readonly hash: string
  readonly subject: string
}

export interface ReconcileDraftPrStateInput {
  readonly childTasks: readonly DraftPrChildTask[]
  readonly commits: readonly BranchCommit[]
  readonly existingLedger: readonly ChildTaskProgress[]
}

const orchestratorPackageName = '@cv-maxxing/prd-orchestrator'

export const generatePrdConventionalCommitTitle = (prdTitle: string): string =>
  `feat: ${normaliseCommitSubject(stripPrdPrefix(prdTitle))}`

export const generateMergeInstructions = (input: GenerateMergeInstructionsInput): string => {
  const title = generatePrdConventionalCommitTitle(input.prdTitle)
  const closingFooters = [
    input.parentPrdIssueNumber,
    ...input.childTasks.map((childTask) => childTask.issueNumber),
  ]
    .map((issueNumber) => `Closes ${formatIssueReference(issueNumber)}`)
    .join('\n')

  return [
    '## Squash Merge Instructions',
    '',
    'Use this exact squash commit title:',
    '',
    '```text',
    title,
    '```',
    '',
    'Include these closing footers in the squash commit body:',
    '',
    '```text',
    closingFooters,
    '```',
    '',
    'Human review and merge are required. The orchestrator must not merge this PR.',
  ].join('\n')
}

export const generateDraftPrBody = (input: GenerateDraftPrBodyInput): string =>
  [
    `# ${generatePrdConventionalCommitTitle(input.prdTitle)}`,
    '',
    '## Automation',
    '',
    `Managed by \`${orchestratorPackageName}\`.`,
    '',
    `Draft branch \`${input.branchName}\` is automation-owned and may be force-pushed while this PR remains draft.`,
    '',
    'Human review and merge are required. The orchestrator must not merge this PR.',
    '',
    renderProgressLedger(input),
    '',
    generateMergeInstructions(input),
  ].join('\n')

export const createChildCommitMessage = (input: CreateChildCommitMessageInput): string =>
  [
    `feat: ${normaliseCommitSubject(input.childTitle)}`,
    '',
    'Acceptance evidence:',
    ...formatEvidenceLines(input.acceptanceEvidence),
    '',
    'Verification evidence:',
    ...formatEvidenceLines(input.verificationEvidence),
    '',
    `Closes ${formatIssueReference(input.childIssueNumber)}`,
  ].join('\n')

export const reconcileDraftPrStateFromCommits = (
  input: ReconcileDraftPrStateInput,
): readonly ChildTaskProgress[] => {
  const existingLedgerByIssueNumber = new Map(
    input.existingLedger.map((entry) => [entry.issueNumber, entry]),
  )
  const completedCommitsByIssueNumber = new Map(
    input.commits.flatMap((commit) =>
      parseClosedIssueNumbers(commit).map((issueNumber) => [issueNumber, commit] as const),
    ),
  )

  return input.childTasks.map((childTask) => {
    const existingEntry = existingLedgerByIssueNumber.get(childTask.issueNumber)
    const completedCommit = completedCommitsByIssueNumber.get(childTask.issueNumber)

    if (completedCommit === undefined) {
      return (
        existingEntry ?? {
          codeRabbitStatus: 'pending',
          issueNumber: childTask.issueNumber,
          status: 'pending',
          verificationStatus: 'not run',
        }
      )
    }

    const shortCommitHash = shortenCommitHash(completedCommit.hash)

    return {
      codeRabbitStatus: existingEntry?.codeRabbitStatus ?? 'pending',
      issueNumber: childTask.issueNumber,
      shortCommitHash,
      status: 'complete',
      verificationStatus: `recorded in commit ${shortCommitHash}`,
    }
  })
}

const renderProgressLedger = (input: GenerateDraftPrBodyInput): string => {
  const ledgerByIssueNumber = new Map(input.ledger.map((entry) => [entry.issueNumber, entry]))
  const rows = input.childTasks.map((childTask) => {
    const ledgerEntry = ledgerByIssueNumber.get(childTask.issueNumber) ?? {
      codeRabbitStatus: 'pending',
      issueNumber: childTask.issueNumber,
      status: 'pending',
      verificationStatus: 'not run',
    }

    return [
      formatIssueReference(childTask.issueNumber),
      childTask.title,
      ledgerEntry.status,
      ledgerEntry.shortCommitHash === undefined ? '-' : `\`${ledgerEntry.shortCommitHash}\``,
      ledgerEntry.verificationStatus,
      ledgerEntry.codeRabbitStatus,
    ]
  })

  return [
    '## Child Task Progress',
    '',
    '| Issue | Title | Status | Commit | Verification | CodeRabbit |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

const formatEvidenceLines = (evidence: readonly string[]): readonly string[] =>
  evidence.length === 0 ? ['- Not recorded.'] : evidence.map((entry) => `- ${entry}`)

const parseClosedIssueNumbers = (commit: BranchCommit): readonly number[] =>
  [...`${commit.subject}\n${commit.body}`.matchAll(/Closes\s+#(\d+)/gi)]
    .map((match) => Number.parseInt(match[1] ?? '', 10))
    .filter((issueNumber) => Number.isInteger(issueNumber))

const stripPrdPrefix = (prdTitle: string): string => prdTitle.replace(/^PRD:\s*/i, '')

const normaliseCommitSubject = (subject: string): string => {
  const trimmedSubject = subject.trim()

  if (trimmedSubject.length === 0) {
    return 'implement PRD'
  }

  return `${trimmedSubject.charAt(0).toLowerCase()}${trimmedSubject.slice(1)}`
}

const formatIssueReference = (issueNumber: number): string => `#${String(issueNumber)}`

const shortenCommitHash = (hash: string): string => hash.slice(0, 7)
