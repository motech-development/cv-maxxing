import { describe, expect, it } from 'vitest'

import { runPrdOrchestratorCli, runPrdOrchestratorCliAsync } from '../cli.js'
import { createDefaultPrdOrchestratorLiveAdapters } from '../default-live-adapters.js'
import type { CodeRabbitFinding, PrdOrchestratorLiveAdapters, GitHubIssue } from '../index.js'
import type { RemoteAutomationPr, RunStatus } from '../run-guardrails.js'

const issueObjects = [
  {
    body: `## User Stories

1. As a maintainer, I want planning.
`,
    number: 80,
    state: 'OPEN',
    title: 'PRD: Automate PRD implementation',
  },
  {
    body: `## Parent PRD

#80

## What to build

Plan one child.

## Acceptance criteria

- [ ] A dry-run plan command prints planning details.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
`,
    number: 82,
    state: 'OPEN',
    title: 'Build PRD and child-task planning from GitHub Markdown',
  },
] as const

const issueJson = JSON.stringify(issueObjects)

const multiChildIssueObjects = [
  issueObjects[0],
  issueObjects[1],
  {
    body: `## Parent PRD

#80

## What to build

Generate the PR state.

## Acceptance criteria

- [ ] Draft PR state is generated.

## Blocked by

- Blocked by #82

## User stories addressed

- User story 1
`,
    number: 83,
    state: 'OPEN',
    title: 'Generate PRD draft PR state, ledger, and merge instructions',
  },
] as const

const independentMultiChildIssueObjects = [
  issueObjects[0],
  issueObjects[1],
  {
    body: `## Parent PRD

#80

## What to build

Generate the PR state.

## Acceptance criteria

- [ ] Draft PR state is generated.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
`,
    number: 84,
    state: 'OPEN',
    title: 'Generate PRD draft PR state, ledger, and merge instructions',
  },
] as const

const parentPrdWithTwoStories = {
  body: `## User Stories

1. As a maintainer, I want planning.
2. As a maintainer, I want safe dependency ordering.
`,
  number: 80,
  state: 'OPEN',
  title: 'PRD: Automate PRD implementation',
} as const

const childWithAcceptance = {
  body: `## Parent PRD

#80

## What to build

Plan one child.

## Acceptance criteria

- [ ] A dry-run plan command prints planning details.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
- User story 2
`,
  number: 82,
  state: 'OPEN',
  title: 'Build PRD and child-task planning from GitHub Markdown',
} as const

const blockedPlanningCases = [
  {
    blockers: ['#82 has no acceptance criteria'],
    issues: [
      issueObjects[0],
      {
        ...issueObjects[1],
        body: issueObjects[1].body.replace(
          /## Acceptance criteria[\S\s]*?## Blocked by/,
          '## Blocked by',
        ),
      },
    ],
    name: 'missing acceptance criteria',
  },
  {
    blockers: ['#82 contains HITL/unresolved-decision markers'],
    issues: [
      issueObjects[0],
      {
        ...issueObjects[1],
        body: issueObjects[1].body.replace('Plan one child.', 'HITL: choose the child scope.'),
      },
    ],
    name: 'HITL markers',
  },
  {
    blockers: ['User story 2 is not covered by child tasks'],
    issues: [parentPrdWithTwoStories, issueObjects[1]],
    name: 'uncovered user stories',
  },
  {
    blockers: ['#82 depends on unknown child issue #999'],
    issues: [
      issueObjects[0],
      {
        ...issueObjects[1],
        body: issueObjects[1].body.replace('None - can start immediately.', '- Blocked by #999'),
      },
    ],
    name: 'unknown dependency graph references',
  },
  {
    blockers: ['Child task dependencies contain a cycle'],
    issues: [
      parentPrdWithTwoStories,
      {
        ...childWithAcceptance,
        body: childWithAcceptance.body.replace('None - can start immediately.', '- Blocked by #83'),
      },
      {
        ...childWithAcceptance,
        body: childWithAcceptance.body
          .replace('Plan one child.', 'Plan a second child.')
          .replace('None - can start immediately.', '- Blocked by #82')
          .replace('- User story 1\n- User story 2', '- User story 2'),
        number: 83,
        title: 'Generate PRD draft PR state, ledger, and merge instructions',
      },
    ],
    name: 'cyclic dependency graphs',
  },
] as const

describe('PRD orchestrator CLI', () => {
  it('prints a dry-run plan from issue JSON on stdin', () => {
    const result = runPrdOrchestratorCli({
      arguments_: ['plan'],
      stdin: issueJson,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Selected PRD: #80 PRD: Automate PRD implementation')
    expect(result.stdout).toContain('Writes: none')
    expect(result.stdout).toContain('Next executable tasks: #82')
  })

  it('prints a run --one-child transaction preview from issue and transaction JSON', () => {
    const result = runPrdOrchestratorCli({
      arguments_: ['run', '--one-child'],
      stdin: JSON.stringify({
        issues: issueObjects,
        transaction: {
          childCommitHash: 'abc123456789',
          codeRabbitStatus: 'passed',
          completedChildIssueNumbers: [],
          existingLedger: [],
          impactAnalysis: {
            designFiles: [],
            expectedFiles: ['tools/prd-orchestrator/src/cli.ts'],
            expectedModules: ['@cv-maxxing/prd-orchestrator'],
            riskLevel: 'low',
            sharedContracts: [],
            tests: ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
          },
          mainBranchStatus: {
            clean: true,
            currentBranch: 'main',
            upToDate: true,
          },
          verificationEvidence: ['pnpm lint'],
          workerChangedFiles: ['tools/prd-orchestrator/src/cli.ts'],
        },
      }),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('PRD Orchestrator One-Child Transaction')
    expect(result.stdout).toContain(
      'Selected child: #82 Build PRD and child-task planning from GitHub Markdown',
    )
    expect(result.stdout).toContain('Write surface: accept')
  })

  it('rejects unsupported commands without mutating state', () => {
    expect(
      runPrdOrchestratorCli({
        arguments_: ['resume-pr', '12'],
        stdin: issueJson,
      }),
    ).toEqual({
      exitCode: 1,
      stderr: 'Unsupported command. Supported commands: `plan`, `run --one-child`.\n',
      stdout: '',
    })
  })

  it('reports malformed issue JSON with a controlled parser error', () => {
    expect(() =>
      runPrdOrchestratorCli({
        arguments_: ['plan'],
        stdin: '{',
      }),
    ).toThrow(TypeError)
    expect(() =>
      runPrdOrchestratorCli({
        arguments_: ['plan'],
        stdin: '{',
      }),
    ).toThrow('Invalid JSON input:')
  })

  it('runs every child task in dependency order for the full live run command', async () => {
    const adapters = createLiveAdapters({
      issues: multiChildIssueObjects,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Completed PRD #80')
    expect(adapters.completedChildIssueNumbers).toEqual([82, 83])
    expect(adapters.events.filter((event) => event === 'git:commit-child')).toHaveLength(2)
    expect(adapters.events.filter((event) => event === 'coderabbit:review')).toHaveLength(2)
    expect(adapters.events).toContain('github:mark-ready-for-review')
    expect(adapters.events).toContain('lock:release')
  })

  it('schedules all currently executable children as one parallel-safe live batch', async () => {
    const adapters = createLiveAdapters({
      issues: independentMultiChildIssueObjects,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })
    const firstImplementationIndex = adapters.events.indexOf('sandcastle:implementation')
    const firstApplyIndex = adapters.events.indexOf('git:apply-worker-diff')

    expect(result.exitCode).toBe(0)
    expect(adapters.completedChildIssueNumbers).toEqual([82, 84])
    expect(adapters.events.filter((event) => event === 'sandcastle:impact-analysis')).toHaveLength(
      2,
    )
    expect(adapters.events.filter((event) => event === 'sandcastle:implementation')).toHaveLength(2)
    expect(adapters.events.lastIndexOf('sandcastle:impact-analysis')).toBeLessThan(
      firstImplementationIndex,
    )
    expect(adapters.events.lastIndexOf('sandcastle:implementation')).toBeLessThan(firstApplyIndex)
    expect(new Set(adapters.workerBranchNames).size).toBe(2)
    expect(adapters.recordedStatuses.some((status) => status.phase.includes('2 executable'))).toBe(
      true,
    )
  })

  it('serializes live full-run batches when impact surfaces overlap', async () => {
    const adapters = createLiveAdapters({
      impactAnalyses: [
        {
          designFiles: [],
          expectedFiles: ['tools/prd-orchestrator/src/shared.ts'],
          expectedModules: ['@cv-maxxing/prd-orchestrator'],
          riskLevel: 'medium',
          sharedContracts: [],
          tests: ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
        },
        {
          designFiles: [],
          expectedFiles: ['tools/prd-orchestrator/src/shared.ts'],
          expectedModules: ['@cv-maxxing/prd-orchestrator'],
          riskLevel: 'medium',
          sharedContracts: [],
          tests: ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
        },
      ],
      issues: independentMultiChildIssueObjects,
      workerChangedFilesByChildIssueNumber: new Map([
        [82, ['tools/prd-orchestrator/src/shared.ts']],
        [84, ['tools/prd-orchestrator/src/shared.ts']],
      ]),
    })

    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['run'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
    })

    expect(adapters.events.indexOf('git:commit-child')).toBeLessThan(
      adapters.events.lastIndexOf('sandcastle:implementation'),
    )
  })

  it('records a blocked full-run child while continuing independent executable children', async () => {
    const adapters = createLiveAdapters({
      blockedImplementationChildIssueNumbers: new Set([82]),
      issues: independentMultiChildIssueObjects,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })
    const latestPrBody = adapters.updatedPrBodies.at(-1) ?? ''

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('Full run blocked after continuing independent child work.\n')
    expect(adapters.completedChildIssueNumbers).toEqual([84])
    expect(latestPrBody).toContain(
      '| #82 | Build PRD and child-task planning from GitHub Markdown | blocked |',
    )
    expect(latestPrBody).toContain(
      '| #84 | Generate PRD draft PR state, ledger, and merge instructions | complete |',
    )
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: ['Child #82 is blocked.'],
      completedChildren: [84],
      phase: 'blocked',
    })
  })

  it('fetches live issues for plan when stdin is empty', async () => {
    const adapters = createLiveAdapters()
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['plan'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Selected PRD: #80 PRD: Automate PRD implementation')
    expect(adapters.events).toEqual(['github:list-open-issues'])
  })

  it('runs one child end to end through the live adapter boundary', async () => {
    const adapters = createLiveAdapters()
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Completed child #82')
    expect(result.stdout).toContain('Draft PR: #123')
    expect(adapters.events).toEqual([
      'preflight:run',
      'lock:acquire',
      'github:list-open-issues',
      'git:get-main-branch-status',
      'git:get-completed-children',
      'github:find-automation-pr',
      'git:prepare-prd-branch',
      'github:create-draft-pr',
      'sandcastle:impact-analysis',
      'sandcastle:implementation',
      'git:apply-worker-diff',
      'verification:run',
      'git:commit-child',
      'git:push-prd-branch',
      'coderabbit:review',
      'github:update-pr-body',
      'ci:poll-checks',
      'github:post-pr-comment',
      'github:mark-ready-for-review',
      'state:record-run-status',
      'lock:release',
    ])
  })

  it.each(blockedPlanningCases)(
    'blocks run --one-child before live mutations for $name',
    async ({ blockers, issues }) => {
      const adapters = createLiveAdapters({
        issues,
      })
      const result = await runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['run', '--one-child'],
        stdin: '',
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe(`${blockers.join('\n')}\n`)
      expect(result.stdout).toBe('')
      expect(adapters.events).toEqual([
        'preflight:run',
        'lock:acquire',
        'github:list-open-issues',
        'state:record-run-status',
        'lock:release',
      ])
      expect(adapters.recordedStatuses.at(-1)).toMatchObject({
        activePrdIssueNumber: 80,
        blockers,
        completedChildren: [],
        currentChildIssueNumber: undefined,
        phase: 'blocked',
        prNumber: undefined,
        prUrl: undefined,
      })
    },
  )

  it('blocks full run before branch, PR, Sandcastle, commit, push, or PR-body mutation', async () => {
    const blockers = ['#82 has no acceptance criteria']
    const adapters = createLiveAdapters({
      issues: blockedPlanningCases[0].issues,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(`${blockers.join('\n')}\n`)
    expect(adapters.events).toEqual([
      'preflight:run',
      'lock:acquire',
      'github:list-open-issues',
      'state:record-run-status',
      'lock:release',
    ])
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers,
      completedChildren: [],
      currentChildIssueNumber: undefined,
      phase: 'blocked',
    })
  })

  it('blocks resume continuation before repair or PR mutation when planning blockers exist', async () => {
    const blockers = ['#82 has no acceptance criteria']
    const adapters = createLiveAdapters({
      issues: blockedPlanningCases[0].issues,
      resumePrFindings: [
        {
          body: 'Fix the child commit.',
          childIssueNumber: 82,
          id: 'resume-child-finding',
          source: 'github-pr-review',
          title: 'Child issue regression',
        },
      ],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(`${blockers.join('\n')}\n`)
    expect(adapters.events).toEqual([
      'github:get-pr',
      'github:list-open-issues',
      'state:record-run-status',
    ])
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers,
      completedChildren: [],
      currentChildIssueNumber: undefined,
      phase: 'blocked',
      prNumber: undefined,
      prUrl: undefined,
    })
  })

  it('repairs CodeRabbit findings by amending the child commit and rerunning review', async () => {
    const adapters = createLiveAdapters({
      codeRabbitFindingsBeforeClean: 1,
    })

    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['run', '--one-child'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
    })

    expect(adapters.events).toContain('sandcastle:repair-review')
    expect(adapters.events).toContain('git:amend-child-commit')
    expect(adapters.amendedCommitMessages.at(0)).toContain('Acceptance evidence:')
    expect(adapters.amendedCommitMessages.at(0)).toContain('Verification evidence:')
    expect(adapters.amendedCommitMessages.at(0)).toContain('Closes #82')
    expect(adapters.events.filter((event) => event === 'coderabbit:review')).toHaveLength(2)
  })

  it('records non-actionable CodeRabbit findings without sending them to repair workers', async () => {
    const adapters = createLiveAdapters({
      codeRabbitFindings: [
        {
          body: 'Use Redux for this state flow.',
          conflictsWith: 'project-instructions',
          id: 'finding-conflict',
          rationale: 'Project instructions explicitly forbid Redux.',
          source: 'github-pr-review',
          title: 'Use Redux',
        },
      ],
    })

    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['run', '--one-child'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
    })

    expect(adapters.events).not.toContain('sandcastle:repair-review')
    expect(adapters.events).toContain('github:post-pr-comment')
    expect(adapters.postedComments.join('\n')).toContain(
      'Project instructions explicitly forbid Redux.',
    )
  })

  it('repairs verification failures before committing the child task', async () => {
    const adapters = createLiveAdapters({
      verificationFailuresBeforeClean: 1,
    })

    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['run', '--one-child'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
    })

    expect(adapters.events).toContain('sandcastle:repair-verification')
    expect(adapters.events.filter((event) => event === 'verification:run')).toHaveLength(2)
  })

  it('re-analyses unexpected worker write surfaces before applying the diff', async () => {
    const adapters = createLiveAdapters({
      impactAnalyses: [
        {
          designFiles: [],
          expectedFiles: ['tools/prd-orchestrator/src/cli.ts'],
          expectedModules: ['@cv-maxxing/prd-orchestrator'],
          riskLevel: 'low',
          sharedContracts: [],
          tests: ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
        },
        {
          designFiles: [],
          expectedFiles: ['apps/desktop/src/main.ts'],
          expectedModules: ['@cv-maxxing/desktop'],
          riskLevel: 'medium',
          sharedContracts: [],
          tests: ['apps/desktop/src/__tests__/main.test.ts'],
        },
      ],
      workerChangedFiles: ['apps/desktop/src/main.ts'],
    })

    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['run', '--one-child'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
    })

    expect(adapters.events).toEqual(
      expect.arrayContaining([
        'sandcastle:impact-analysis',
        'sandcastle:implementation',
        'sandcastle:impact-analysis',
        'git:apply-worker-diff',
      ]),
    )
    expect(adapters.events.filter((event) => event === 'sandcastle:impact-analysis')).toHaveLength(
      2,
    )
    expect(adapters.events.lastIndexOf('sandcastle:impact-analysis')).toBeLessThan(
      adapters.events.indexOf('git:apply-worker-diff'),
    )
  })

  it('records unrecoverable blockers in the draft PR before stopping', async () => {
    const adapters = createLiveAdapters({
      workerChangedFiles: ['apps/desktop/src/main.ts'],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(adapters.events).toContain('github:update-pr-body')
    expect(adapters.events).toContain('github:post-pr-comment')
    expect(adapters.events).toContain('state:record-run-status')
    expect(adapters.events).toContain('lock:release')
  })

  it('resumes an automation PR by validating ownership and continuing the live run', async () => {
    const adapters = createLiveAdapters()
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events).toContain('github:get-pr')
    expect(adapters.events).toContain('state:recover-run-status')
    expect(adapters.events).toContain('github:list-open-issues')
  })

  it('resumes by repairing PR findings before returning to the full live run', async () => {
    const adapters = createLiveAdapters({
      resumePrFindings: [
        {
          body: 'Fix the child commit.',
          childIssueNumber: 82,
          id: 'resume-child-finding',
          source: 'github-pr-review',
          title: 'Child issue regression',
        },
        {
          body: 'Tighten final audit wording.',
          id: 'resume-final-finding',
          source: 'github-check',
          title: 'Final cleanup',
        },
      ],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events).toEqual(
      expect.arrayContaining([
        'github:get-pr',
        'github:convert-pr-to-draft',
        'git:checkout-child-commit',
        'sandcastle:repair-resume-findings',
        'git:apply-worker-diff',
        'git:amend-child-commit',
        'git:commit-final-cleanup',
        'git:push-prd-branch',
        'state:recover-run-status',
        'github:list-open-issues',
      ]),
    )
    expect(adapters.amendedCommitMessages.at(0)).toContain('Closes #82')
  })

  it('supports resume-pr, status, and cleanup commands', async () => {
    const adapters = createLiveAdapters()

    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['resume-pr', '123'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
    })
    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['status'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
    })
    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['cleanup'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
    })

    expect(adapters.events).toContain('github:get-pr')
    expect(adapters.events).toContain('github:get-current-pr')
    expect(adapters.events).toContain('state:read-run-status')
    expect(adapters.events).toContain('state:read-artifact-status')
    expect(adapters.events).toContain('state:cleanup')
  })

  it('passes CLI model and effort flags to the default live adapter factory', () => {
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', {
      codexEffort: 'xhigh',
      codexModel: 'gpt-5.5',
    })

    expect(adapters.configuration).toEqual({
      codexEffort: 'xhigh',
      codexModel: 'gpt-5.5',
    })
  })
})

interface CreateLiveAdaptersOptions {
  readonly blockedImplementationChildIssueNumbers?: ReadonlySet<number>
  readonly codeRabbitFindings?: readonly CodeRabbitFinding[]
  readonly codeRabbitFindingsBeforeClean?: number
  readonly impactAnalyses?: readonly Awaited<
    ReturnType<PrdOrchestratorLiveAdapters['sandcastle']['runImpactAnalysis']>
  >[]
  readonly issues?: readonly GitHubIssue[]
  readonly resumePrFindings?: readonly (CodeRabbitFinding & {
    readonly childIssueNumber?: number
  })[]
  readonly verificationFailuresBeforeClean?: number
  readonly workerChangedFiles?: readonly string[]
  readonly workerChangedFilesByChildIssueNumber?: ReadonlyMap<number, readonly string[]>
}

const createLiveAdapters = (
  options: CreateLiveAdaptersOptions = {},
): PrdOrchestratorLiveAdapters & {
  readonly events: string[]
  readonly amendedCommitMessages: string[]
  readonly completedChildIssueNumbers: number[]
  readonly postedComments: string[]
  readonly recordedStatuses: RunStatus[]
  readonly updatedPrBodies: string[]
  readonly workerBranchNames: string[]
} => {
  const events: string[] = []
  const amendedCommitMessages: string[] = []
  const recordedStatuses: RunStatus[] = []
  const postedComments: string[] = []
  const completedChildIssueNumbers: number[] = []
  const updatedPrBodies: string[] = []
  const workerBranchNames: string[] = []
  let codeRabbitReviewCount = 0
  let impactAnalysisCount = 0
  let lastRecordedStatus:
    | Awaited<ReturnType<PrdOrchestratorLiveAdapters['state']['readRunStatus']>>
    | undefined
  let verificationRunCount = 0
  let activeChildIssueNumber: number | undefined

  return {
    ci: {
      pollChecks: () => {
        events.push('ci:poll-checks')

        return Promise.resolve('passed')
      },
    },
    amendedCommitMessages,
    completedChildIssueNumbers,
    codeRabbit: {
      reviewChild: () => {
        events.push('coderabbit:review')
        codeRabbitReviewCount += 1
        const findings =
          options.codeRabbitFindings ??
          (codeRabbitReviewCount <= (options.codeRabbitFindingsBeforeClean ?? 0)
            ? [
                {
                  body: 'Repair this finding.',
                  id: `finding-${String(codeRabbitReviewCount)}`,
                  source: 'github-pr-review' as const,
                  title: 'CodeRabbit finding',
                },
              ]
            : [])

        return Promise.resolve({
          findings,
          status: findings.length === 0 ? 'passed' : 'findings',
        })
      },
    },
    events,
    updatedPrBodies,
    workerBranchNames,
    recordedStatuses,
    git: {
      applyWorkerDiff: () => {
        events.push('git:apply-worker-diff')

        return Promise.resolve()
      },
      commitChild: (message) => {
        events.push('git:commit-child')
        const issueNumber = Number.parseInt(/Closes #(\d+)/.exec(message)?.[1] ?? '', 10)

        if (Number.isInteger(issueNumber)) {
          completedChildIssueNumbers.push(issueNumber)
        }

        return Promise.resolve({
          hash: 'abc123456789',
        })
      },
      amendChildCommit: (message) => {
        events.push('git:amend-child-commit')
        amendedCommitMessages.push(message)

        return Promise.resolve({
          hash: 'def456789012',
        })
      },
      checkoutChildCommit: () => {
        events.push('git:checkout-child-commit')

        return Promise.resolve()
      },
      commitFinalCleanup: () => {
        events.push('git:commit-final-cleanup')

        return Promise.resolve({
          hash: 'fed789012345',
        })
      },
      getChildCommitReferences: () => {
        events.push('git:get-child-commit-references')

        return Promise.resolve(
          (completedChildIssueNumbers.length === 0 ? [82] : completedChildIssueNumbers).map(
            (childIssueNumber) => ({
              childIssueNumber,
              commitHash: `abc${String(childIssueNumber)}3456789`,
            }),
          ),
        )
      },
      getMainBranchStatus: () => {
        events.push('git:get-main-branch-status')

        return Promise.resolve({
          clean: true,
          currentBranch: 'main',
          upToDate: true,
        })
      },
      getCompletedChildIssueNumbers: () => {
        events.push('git:get-completed-children')

        return Promise.resolve([...completedChildIssueNumbers])
      },
      preparePrdBranch: () => {
        events.push('git:prepare-prd-branch')

        return Promise.resolve()
      },
      pushPrdBranch: () => {
        events.push('git:push-prd-branch')

        return Promise.resolve()
      },
    },
    github: {
      createDraftPr: () => {
        events.push('github:create-draft-pr')

        return Promise.resolve({
          branchName: 'agent/prd-80-automate-prd-implementation',
          prNumber: 123,
          prdIssueNumber: 80,
          url: 'https://github.com/motech-development/cv-maxxing/pull/123',
        })
      },
      findAutomationPr: () => {
        events.push('github:find-automation-pr')
        const automationPr = undefined as RemoteAutomationPr | undefined

        return Promise.resolve(automationPr)
      },
      getPr: () => {
        events.push('github:get-pr')

        return Promise.resolve({
          body: '## Automation\n\nManaged by `@cv-maxxing/prd-orchestrator`.',
          branchName: 'agent/prd-80-automate-prd-implementation',
          isDraft: options.resumePrFindings === undefined,
          prNumber: 123,
          url: 'https://github.com/motech-development/cv-maxxing/pull/123',
        })
      },
      convertPrToDraft: () => {
        events.push('github:convert-pr-to-draft')

        return Promise.resolve()
      },
      getReviewFindings: () => {
        events.push('github:get-review-findings')

        return Promise.resolve(options.resumePrFindings ?? [])
      },
      getCurrentPr: () => {
        events.push('github:get-current-pr')

        return Promise.resolve({
          body: '## Automation\n\nManaged by `@cv-maxxing/prd-orchestrator`.',
          branchName: 'agent/prd-80-automate-prd-implementation',
          isDraft: true,
          prNumber: 123,
          url: 'https://github.com/motech-development/cv-maxxing/pull/123',
        })
      },
      listOpenIssues: () => {
        events.push('github:list-open-issues')

        return Promise.resolve(options.issues ?? issueObjects)
      },
      markReadyForReview: () => {
        events.push('github:mark-ready-for-review')

        return Promise.resolve()
      },
      postPrComment: (_prNumber, body) => {
        events.push('github:post-pr-comment')
        postedComments.push(body)

        return Promise.resolve()
      },
      updatePrBody: (_prNumber, body) => {
        events.push('github:update-pr-body')
        updatedPrBodies.push(body)

        return Promise.resolve()
      },
    },
    sandcastle: {
      repairResumeFindings: () => {
        events.push('sandcastle:repair-resume-findings')

        return Promise.resolve({
          changedFiles: ['tools/prd-orchestrator/src/cli.ts'],
          stdout: 'repaired resume findings',
          workerBranchName:
            'agent/prd-80-child-82-build-prd-and-child-task-planning-from-github-markdown',
        })
      },
      repairReviewFindings: () => {
        events.push('sandcastle:repair-review')

        return Promise.resolve({
          changedFiles: ['tools/prd-orchestrator/src/cli.ts'],
          stdout: 'repaired review',
          workerBranchName:
            'agent/prd-80-child-82-build-prd-and-child-task-planning-from-github-markdown',
        })
      },
      repairVerificationFailure: () => {
        events.push('sandcastle:repair-verification')

        return Promise.resolve({
          changedFiles: ['tools/prd-orchestrator/src/cli.ts'],
          stdout: 'repaired verification',
          workerBranchName:
            'agent/prd-80-child-82-build-prd-and-child-task-planning-from-github-markdown',
        })
      },
      runImpactAnalysis: (input) => {
        events.push('sandcastle:impact-analysis')
        activeChildIssueNumber = input.childTask.issueNumber
        const impactAnalysis = options.impactAnalyses?.[impactAnalysisCount]
        impactAnalysisCount += 1

        if (impactAnalysis !== undefined) {
          return Promise.resolve(impactAnalysis)
        }

        const expectedFile =
          activeChildIssueNumber === 83 || activeChildIssueNumber === 84
            ? 'tools/prd-orchestrator/src/draft-pr-state.ts'
            : 'tools/prd-orchestrator/src/cli.ts'

        return Promise.resolve({
          designFiles: [],
          expectedFiles: [expectedFile],
          expectedModules:
            activeChildIssueNumber === 83 || activeChildIssueNumber === 84
              ? ['@cv-maxxing/prd-orchestrator/draft-pr-state']
              : ['@cv-maxxing/prd-orchestrator'],
          riskLevel: 'low',
          sharedContracts: [],
          tests:
            activeChildIssueNumber === 83 || activeChildIssueNumber === 84
              ? ['tools/prd-orchestrator/src/__tests__/draft-pr-state.test.ts']
              : ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
        })
      },
      runImplementation: (input) => {
        events.push('sandcastle:implementation')
        workerBranchNames.push(input.workerBranchName)
        const childIssueNumber = input.childTask.issueNumber
        const changedFiles =
          options.blockedImplementationChildIssueNumbers?.has(childIssueNumber) === true
            ? ['unexpected/out-of-scope.ts']
            : (options.workerChangedFilesByChildIssueNumber?.get(childIssueNumber) ??
              options.workerChangedFiles ?? [
                childIssueNumber === 83 || childIssueNumber === 84
                  ? 'tools/prd-orchestrator/src/draft-pr-state.ts'
                  : 'tools/prd-orchestrator/src/cli.ts',
              ])

        return Promise.resolve({
          changedFiles,
          stdout: 'implemented child',
          workerBranchName:
            'agent/prd-80-child-82-build-prd-and-child-task-planning-from-github-markdown',
        })
      },
    },
    state: {
      acquireRunLock: () => {
        events.push('lock:acquire')

        return Promise.resolve({
          blockers: [],
          lockId: 'run-1',
          ready: true,
        })
      },
      cleanup: () => {
        events.push('state:cleanup')

        return Promise.resolve({
          preserve: [],
          remove: ['.git/prd-orchestrator/runs/stale'],
        })
      },
      readRunStatus: () => {
        events.push('state:read-run-status')

        if (lastRecordedStatus !== undefined) {
          return Promise.resolve(lastRecordedStatus)
        }

        const issues = options.issues ?? issueObjects
        const childIssueCount = issues.filter((issue) => issue.number !== 80).length
        const phase =
          completedChildIssueNumbers.length >= childIssueCount ? 'ready-for-review' : 'complete'

        return Promise.resolve({
          activePrdIssueNumber: 80,
          blockers: [],
          branchName: 'agent/prd-80-automate-prd-implementation',
          ciStatus: phase === 'ready-for-review' ? 'passed' : 'unknown',
          codeRabbitStatus: 'passed',
          completedChildren: [...completedChildIssueNumbers],
          currentChildIssueNumber: undefined,
          heartbeatIso: '2026-04-28T17:00:00.000Z',
          lastCommand: phase === 'ready-for-review' ? 'final audit posted' : 'run --one-child',
          phase,
          prNumber: 123,
          prUrl: 'https://github.com/motech-development/cv-maxxing/pull/123',
        })
      },
      readArtifactStatus: () => {
        events.push('state:read-artifact-status')

        return Promise.resolve({
          cleanupStatus: '1 stale artifact eligible for cleanup',
          lockStatus: 'no active lock',
          sandcastleStatus: '0 active worktrees, 0 active containers',
        })
      },
      recoverRunStatusFromPr: () => {
        events.push('state:recover-run-status')

        return Promise.resolve()
      },
      recordRunStatus: (status) => {
        events.push('state:record-run-status')
        lastRecordedStatus = status
        recordedStatuses.push(status)

        return Promise.resolve()
      },
      releaseRunLock: () => {
        events.push('lock:release')

        return Promise.resolve()
      },
      runPreflight: () => {
        events.push('preflight:run')

        return Promise.resolve({
          blockers: [],
          ready: true,
        })
      },
    },
    verification: {
      runCommands: () => {
        events.push('verification:run')
        verificationRunCount += 1

        if (verificationRunCount <= (options.verificationFailuresBeforeClean ?? 0)) {
          return Promise.reject(new Error('verification failed'))
        }

        return Promise.resolve([
          'pnpm lint',
          'pnpm --filter @cv-maxxing/prd-orchestrator typecheck',
        ])
      },
    },
    postedComments,
  }
}
