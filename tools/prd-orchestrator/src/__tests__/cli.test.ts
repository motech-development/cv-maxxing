import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { runPrdOrchestratorCli, runPrdOrchestratorCliAsync } from '../cli.js'
import { readCliStdin } from '../cli-stdin.js'
import { createDefaultPrdOrchestratorLiveAdapters } from '../default-live-adapters.js'
import { createProhibitedCapabilityScanResults } from '../final-prd-flow.js'
import type {
  ChildCommitReference,
  CodeRabbitFinding,
  GitHubActionsStatus,
  GitHubIssue,
  LivePreflightResult,
  LiveRunLockResult,
  PrdOrchestratorLiveAdapters,
  ProhibitedCapabilityMatch,
  ResumePrFinding,
} from '../index.js'
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
  it('treats interactive terminal stdin as empty input instead of waiting for EOF', async () => {
    const stdin = Readable.from([]) as Readable & {
      readonly isTTY: true
      setEncoding: (encoding: BufferEncoding) => void
    }

    Object.defineProperty(stdin, 'isTTY', {
      value: true,
    })

    await expect(readCliStdin(stdin)).resolves.toBe('')
  })

  it('still reads piped stdin content for dry-run JSON previews', async () => {
    const stdin = Readable.from([issueJson]) as Readable & {
      readonly isTTY?: false
      setEncoding: (encoding: BufferEncoding) => void
    }

    await expect(readCliStdin(stdin)).resolves.toBe(issueJson)
  })

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

  it('preserves Pencil-required design files from run --one-child impact analysis JSON', () => {
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
            expectedFiles: ['design/cv.pen'],
            expectedModules: ['@cv-maxxing/prd-orchestrator'],
            pencilRequiredDesignFiles: ['design/cv.pen'],
            riskLevel: 'low',
            sharedContracts: [],
            tests: [],
          },
          mainBranchStatus: {
            clean: true,
            currentBranch: 'main',
            upToDate: true,
          },
          verificationEvidence: ['pnpm lint'],
          workerChangedFiles: ['design/cv.pen'],
        },
      }),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(
      'Pencil verification evidence missing for .pen design changes: design/cv.pen.',
    )
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
    const result = runPrdOrchestratorCli({
      arguments_: ['plan'],
      stdin: '{',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid JSON input:')
    expect(result.stdout).toBe('')
  })

  it('reports malformed run --one-child JSON with a controlled parser error', () => {
    const result = runPrdOrchestratorCli({
      arguments_: ['run', '--one-child'],
      stdin: '{',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid JSON input:')
    expect(result.stdout).toBe('')
  })

  it('rejects fractional and non-positive issue identifiers from CLI JSON', () => {
    const fractionalIssueResult = runPrdOrchestratorCli({
      arguments_: ['plan'],
      stdin: JSON.stringify([
        {
          ...issueObjects[0],
          number: 80.5,
        },
        issueObjects[1],
      ]),
    })

    expect(fractionalIssueResult.exitCode).toBe(1)
    expect(fractionalIssueResult.stderr).toBe(
      'Expected each GitHub issue to include body, number, state, and title.\n',
    )
    expect(fractionalIssueResult.stdout).toBe('')

    const completedChildResult = runPrdOrchestratorCli({
      arguments_: ['run', '--one-child'],
      stdin: JSON.stringify({
        issues: issueObjects,
        transaction: {
          childCommitHash: 'abc123456789',
          codeRabbitStatus: 'passed',
          completedChildIssueNumbers: [82.5],
          existingLedger: [],
          impactAnalysis: {
            designFiles: [],
            expectedFiles: ['tools/prd-orchestrator/src/cli.ts'],
            expectedModules: ['@cv-maxxing/prd-orchestrator'],
            riskLevel: 'low',
            sharedContracts: [],
            tests: [],
          },
          mainBranchStatus: {
            clean: true,
            currentBranch: 'main',
            upToDate: true,
          },
          remoteAutomationPr: {
            branchName: 'agent/prd-80-existing',
            isDraft: true,
            prNumber: 12,
            prdIssueNumber: 80,
            url: 'https://github.com/motech-development/cv-maxxing/pull/12',
          },
          verificationEvidence: ['pnpm lint'],
          workerChangedFiles: ['tools/prd-orchestrator/src/cli.ts'],
        },
      }),
    })

    expect(completedChildResult.exitCode).toBe(1)
    expect(completedChildResult.stderr).toBe(
      'Expected completedChildIssueNumbers to be a number array.\n',
    )
    expect(completedChildResult.stdout).toBe('')

    const ledgerResult = runPrdOrchestratorCli({
      arguments_: ['run', '--one-child'],
      stdin: JSON.stringify({
        issues: issueObjects,
        transaction: {
          childCommitHash: 'abc123456789',
          codeRabbitStatus: 'passed',
          completedChildIssueNumbers: [],
          existingLedger: [
            {
              codeRabbitStatus: 'pending',
              issueNumber: 0,
              status: 'pending',
              verificationStatus: 'not run',
            },
          ],
          impactAnalysis: {
            designFiles: [],
            expectedFiles: ['tools/prd-orchestrator/src/cli.ts'],
            expectedModules: ['@cv-maxxing/prd-orchestrator'],
            riskLevel: 'low',
            sharedContracts: [],
            tests: [],
          },
          mainBranchStatus: {
            clean: true,
            currentBranch: 'main',
            upToDate: true,
          },
          remoteAutomationPr: {
            branchName: 'agent/prd-80-existing',
            isDraft: true,
            prNumber: 12,
            prdIssueNumber: 80,
            url: 'https://github.com/motech-development/cv-maxxing/pull/12',
          },
          verificationEvidence: ['pnpm lint'],
          workerChangedFiles: ['tools/prd-orchestrator/src/cli.ts'],
        },
      }),
    })

    expect(ledgerResult.exitCode).toBe(1)
    expect(ledgerResult.stderr).toBe(
      'Expected existingLedger entries to contain child progress fields.\n',
    )
    expect(ledgerResult.stdout).toBe('')

    const remotePrResult = runPrdOrchestratorCli({
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
            tests: [],
          },
          mainBranchStatus: {
            clean: true,
            currentBranch: 'main',
            upToDate: true,
          },
          remoteAutomationPr: {
            branchName: 'agent/prd-80-existing',
            isDraft: true,
            prNumber: 12.25,
            prdIssueNumber: 80,
            url: 'https://github.com/motech-development/cv-maxxing/pull/12',
          },
          verificationEvidence: ['pnpm lint'],
          workerChangedFiles: ['tools/prd-orchestrator/src/cli.ts'],
        },
      }),
    })

    expect(remotePrResult.exitCode).toBe(1)
    expect(remotePrResult.stderr).toBe(
      'Expected remoteAutomationPr to include branchName, isDraft, prNumber, prdIssueNumber, and url.\n',
    )
    expect(remotePrResult.stdout).toBe('')
  })

  it('returns controlled async parser errors for malformed stdin and resume-pr numbers', async () => {
    const malformedJsonResult = await runPrdOrchestratorCliAsync({
      arguments_: ['plan'],
      stdin: '{',
    })

    expect(malformedJsonResult.exitCode).toBe(1)
    expect(malformedJsonResult.stderr).toContain('Invalid JSON input:')
    expect(malformedJsonResult.stdout).toBe('')

    await expect(
      runPrdOrchestratorCliAsync({
        arguments_: ['resume-pr', '12abc'],
        stdin: '',
      }),
    ).resolves.toEqual({
      exitCode: 1,
      stderr: 'Expected resume-pr to include a positive pull request number.\n',
      stdout: '',
    })
  })

  it('rejects live CLI model and effort flags without real values', async () => {
    await expect(
      runPrdOrchestratorCliAsync({
        arguments_: ['run', '--model', '--one-child'],
        stdin: '',
      }),
    ).resolves.toEqual({
      exitCode: 1,
      stderr: 'Expected --model to include a value.\n',
      stdout: '',
    })

    await expect(
      runPrdOrchestratorCliAsync({
        arguments_: ['run', '--effort='],
        stdin: '',
      }),
    ).resolves.toEqual({
      exitCode: 1,
      stderr: 'Expected --effort to include a value.\n',
      stdout: '',
    })
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

  it('waits for pending final CI to pass before posting the final audit and marking ready', async () => {
    const adapters = createLiveAdapters({
      ciPollingResults: [
        {
          blockers: [],
          status: 'pending',
        },
        {
          blockers: [],
          status: 'passed',
        },
      ],
      issues: multiChildIssueObjects,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events.filter((event) => event === 'ci:poll-checks')).toHaveLength(2)
    expect(adapters.recordedStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ciStatus: 'pending',
          phase: 'waiting-for-ci',
        }),
        expect.objectContaining({
          ciStatus: 'passed',
          phase: 'ready-for-review',
        }),
      ]),
    )
    expect(adapters.events.indexOf('github:mark-ready-for-review')).toBeGreaterThan(
      adapters.events.lastIndexOf('ci:poll-checks'),
    )
  })

  it('records failed final CI blockers in run state and the draft PR without marking ready', async () => {
    const adapters = createLiveAdapters({
      ciPollingResults: [
        {
          blockers: [],
          status: 'pending',
        },
        {
          blockers: ['GitHub Actions run desktop macos-15 failed with conclusion failure'],
          status: 'failed',
        },
      ],
      issues: multiChildIssueObjects,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(adapters.events).not.toContain('github:mark-ready-for-review')
    expect(adapters.postedComments.at(-1)).toContain('## PRD Orchestrator CI Blocker')
    expect(adapters.postedComments.at(-1)).toContain(
      'GitHub Actions run desktop macos-15 failed with conclusion failure',
    )
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: ['GitHub Actions run desktop macos-15 failed with conclusion failure'],
      ciStatus: 'failed',
      phase: 'blocked',
    })
  })

  it('finalizes a full run recovered from all-complete branch commits', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82, 83],
      issues: multiChildIssueObjects,
      recoveredRunStatusPhase: 'complete',
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Completed PRD #80')
    expect(adapters.events).toContain('ci:poll-checks')
    expect(adapters.events).toContain('github:upsert-pr-comment')
    expect(adapters.events).toContain('github:mark-ready-for-review')
    expect(adapters.events).not.toContain('sandcastle:implementation')
    expect(adapters.updatedPrBodies.at(-1)).toContain(
      '| #83 | Generate PRD draft PR state, ledger, and merge instructions | complete |',
    )
    expect(adapters.upsertedComments.at(-1)).toContain('## Final PRD Acceptance Audit')
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      ciStatus: 'passed',
      completedChildren: [82, 83],
      phase: 'ready-for-review',
    })
  })

  it('records recovered all-complete CI blockers without marking ready', async () => {
    const adapters = createLiveAdapters({
      ciPollingResults: [
        {
          blockers: ['GitHub Actions run desktop macos-15 failed with conclusion failure'],
          status: 'failed',
        },
      ],
      initialCompletedChildIssueNumbers: [82, 83],
      issues: multiChildIssueObjects,
      recoveredRunStatusPhase: 'complete',
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(adapters.events).toContain('ci:poll-checks')
    expect(adapters.events).toContain('github:post-pr-comment')
    expect(adapters.events).not.toContain('github:upsert-pr-comment')
    expect(adapters.events).not.toContain('github:mark-ready-for-review')
    expect(adapters.postedComments.at(-1)).toContain('## PRD Orchestrator CI Blocker')
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: ['GitHub Actions run desktop macos-15 failed with conclusion failure'],
      ciStatus: 'failed',
      phase: 'blocked',
    })
  })

  it('stops final CI polling at timeout or an external blocker', async () => {
    const timeoutAdapters = createLiveAdapters({
      ciPollingResults: [
        {
          blockers: [],
          status: 'pending',
        },
        {
          blockers: [],
          status: 'pending',
        },
      ],
      ciPollingTimeoutMs: 1,
      issues: multiChildIssueObjects,
    })
    const blockerAdapters = createLiveAdapters({
      ciPollingResults: [new Error('gh auth expired')],
      issues: multiChildIssueObjects,
    })

    await expect(
      runPrdOrchestratorCliAsync({
        adapters: timeoutAdapters,
        arguments_: ['run'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 1,
    })
    await expect(
      runPrdOrchestratorCliAsync({
        adapters: blockerAdapters,
        arguments_: ['run'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 1,
    })

    expect(timeoutAdapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: ['GitHub Actions did not reach a terminal status before the polling timeout.'],
      ciStatus: 'timed-out',
      phase: 'blocked',
    })
    expect(timeoutAdapters.events).not.toContain('github:mark-ready-for-review')
    expect(blockerAdapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: ['GitHub Actions polling blocked: gh auth expired'],
      ciStatus: 'blocked',
      phase: 'blocked',
    })
    expect(blockerAdapters.events).not.toContain('github:mark-ready-for-review')
  })

  it('does not poll CI after a child commit while sibling tasks remain incomplete', async () => {
    const adapters = createLiveAdapters({
      issues: multiChildIssueObjects,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.completedChildIssueNumbers).toEqual([82])
    expect(adapters.events).not.toContain('ci:poll-checks')
    expect(adapters.events).not.toContain('github:mark-ready-for-review')
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
      'github:list-open-issues',
      'github:scan-automation-prs',
      'lock:acquire',
      'git:get-main-branch-status',
      'git:get-completed-children',
      'git:prepare-prd-branch',
      'github:create-draft-pr',
      'sandcastle:impact-analysis',
      'sandcastle:implementation',
      'git:apply-worker-diff',
      'verification:run',
      'github:get-pr',
      'git:commit-child',
      'git:push-prd-branch',
      'coderabbit:review',
      'github:update-pr-body',
      'ci:poll-checks',
      'git:get-child-commit-references',
      'verification:scan-prohibited-capabilities',
      'github:upsert-pr-comment',
      'github:create-final-audit-comment',
      'github:mark-ready-for-review',
      'state:record-run-status',
      'lock:release',
    ])
  })

  it('allows run --one-child startup when no remote automation PR exists', async () => {
    const adapters = createLiveAdapters({
      openAutomationPrs: [],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events.indexOf('github:scan-automation-prs')).toBeLessThan(
      adapters.events.indexOf('lock:acquire'),
    )
    expect(adapters.events).toContain('git:push-prd-branch')
  })

  it('allows run --one-child startup for the selected PRD automation PR', async () => {
    const adapters = createLiveAdapters({
      automationPr: {
        branchName: 'agent/prd-80-automate-prd-implementation',
        isDraft: true,
        prNumber: 123,
        prdIssueNumber: 80,
        url: 'https://github.com/motech-development/cv-maxxing/pull/123',
      },
      openAutomationPrs: [
        {
          branchName: 'agent/prd-80-automate-prd-implementation',
          isDraft: true,
          prNumber: 123,
          prdIssueNumber: 80,
          url: 'https://github.com/motech-development/cv-maxxing/pull/123',
        },
      ],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events).toContain('git:push-prd-branch')
  })

  it('recovers completed child state from branch history after lock acquisition', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82],
      issues: multiChildIssueObjects,
      runLockResult: {
        blockers: [],
        lockId: 'recovered-stale-lock',
        ready: true,
      },
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Completed child #83')
    expect(adapters.events).toContain('git:get-completed-children')
    expect(adapters.updatedPrBodies.at(-1)).toContain(
      '| #82 | Build PRD and child-task planning from GitHub Markdown | complete |',
    )
    expect(adapters.updatedPrBodies.at(-1)).toContain(
      '| #83 | Generate PRD draft PR state, ledger, and merge instructions | complete |',
    )
  })

  it('preserves recovered completed children when a later one-child run blocks before commit', async () => {
    const adapters = createLiveAdapters({
      impactAnalyses: [
        {
          designFiles: ['design/app.pen'],
          expectedFiles: [],
          expectedModules: ['@cv-maxxing/prd-orchestrator'],
          riskLevel: 'medium',
          sharedContracts: [],
          tests: ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
        },
      ],
      initialCompletedChildIssueNumbers: [82],
      issues: multiChildIssueObjects,
      workerChangedFiles: ['design/app.pen'],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })
    const latestPrBody = adapters.updatedPrBodies.at(-1) ?? ''

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Pencil verification evidence missing')
    expect(latestPrBody).toContain(
      '| #82 | Build PRD and child-task planning from GitHub Markdown | complete |',
    )
    expect(latestPrBody).toContain(
      '| #83 | Generate PRD draft PR state, ledger, and merge instructions | blocked |',
    )
  })

  it('blocks run --one-child before lock or mutation when a different PRD automation PR is active', async () => {
    const adapters = createLiveAdapters({
      openAutomationPrs: [
        {
          branchName: 'agent/prd-91-other-prd',
          isDraft: true,
          prNumber: 456,
          prdIssueNumber: 91,
          url: 'https://github.com/motech-development/cv-maxxing/pull/456',
        },
      ],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Remote automation PR #456 is active for PRD #91')
    expect(adapters.events).toEqual([
      'preflight:run',
      'github:list-open-issues',
      'github:scan-automation-prs',
    ])
  })

  it('blocks full run before lock or mutation when a different PRD automation PR is active', async () => {
    const adapters = createLiveAdapters({
      issues: multiChildIssueObjects,
      openAutomationPrs: [
        {
          branchName: 'agent/prd-91-other-prd',
          isDraft: true,
          prNumber: 456,
          prdIssueNumber: 91,
          url: 'https://github.com/motech-development/cv-maxxing/pull/456',
        },
      ],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Remote automation PR #456 is active for PRD #91')
    expect(adapters.events).toEqual([
      'preflight:run',
      'github:list-open-issues',
      'github:scan-automation-prs',
    ])
  })

  it('blocks startup on malformed remote automation PR body before lock or mutation', async () => {
    const adapters = createLiveAdapters({
      remoteAutomationBlockers: ['PR #456 body is missing the orchestrator Automation section'],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result).toEqual({
      exitCode: 1,
      stderr: 'PR #456 body is missing the orchestrator Automation section\n',
      stdout: '',
    })
    expect(adapters.events).toEqual([
      'preflight:run',
      'github:list-open-issues',
      'github:scan-automation-prs',
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
        'github:list-open-issues',
        'github:scan-automation-prs',
        'lock:acquire',
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
      'github:list-open-issues',
      'github:scan-automation-prs',
      'lock:acquire',
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
      'preflight:run',
      'lock:acquire',
      'github:get-pr',
      'github:list-open-issues',
      'state:record-run-status',
      'lock:release',
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

  it('resumes the PRD matching the automation PR branch instead of the first dry-run PRD', async () => {
    const unrelatedPrdIssue = {
      body: `## User Stories

1. As a maintainer, I want unrelated work.
`,
      number: 70,
      state: 'OPEN',
      title: 'PRD: Earlier unrelated work',
    } as const
    const blockedUnrelatedChildIssue = {
      body: `## Parent PRD

#70

## What to build

Unrelated work.

## Acceptance criteria

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
`,
      number: 71,
      state: 'OPEN',
      title: 'Blocked unrelated child',
    } as const
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82],
      issues: [unrelatedPrdIssue, blockedUnrelatedChildIssue, ...issueObjects],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      activePrdIssueNumber: 80,
      phase: 'ready-for-review',
    })
  })

  it('blocks resume-pr when the automation PR branch no longer matches an open PRD', async () => {
    const adapters = createLiveAdapters({
      prBranchName: 'agent/prd-999-missing-prd',
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(
      'Could not find the parent PRD for automation branch agent/prd-999-missing-prd.\n',
    )
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      activePrdIssueNumber: 999,
      blockers: ['Could not find the parent PRD for automation branch agent/prd-999-missing-prd.'],
      phase: 'blocked',
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

  it('does not mark a child complete while CodeRabbit findings remain', async () => {
    const adapters = createLiveAdapters({
      codeRabbitFindings: [
        {
          body: 'Still broken after repair.',
          id: 'persistent-child-finding',
          source: 'github-pr-review',
          title: 'Persistent child finding',
        },
      ],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: ['Persistent child finding'],
      completedChildren: [],
      phase: 'blocked',
    })
  })

  it('records a blocked child review when repair orchestration throws', async () => {
    const adapters = createLiveAdapters({
      codeRabbitFindingsBeforeClean: 1,
      repairReviewError: new Error('repair worker unavailable'),
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(adapters.events).toContain('git:restore-prd-branch')
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: ['CodeRabbit repair failed'],
      completedChildren: [],
      phase: 'blocked',
    })
  })

  it('refuses run --one-child rewrites when the existing automation PR is ready for review', async () => {
    const adapters = createLiveAdapters({
      automationPr: {
        branchName: 'agent/prd-80-automate-prd-implementation',
        isDraft: false,
        prNumber: 123,
        prdIssueNumber: 80,
        url: 'https://github.com/motech-development/cv-maxxing/pull/123',
      },
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('PR #123 is ready for review')
    expect(result.stderr).toContain('run --one-child will not amend commits or force-push')
    expect(adapters.events).toEqual([
      'preflight:run',
      'github:list-open-issues',
      'github:scan-automation-prs',
      'lock:acquire',
      'git:get-main-branch-status',
      'git:get-completed-children',
      'lock:release',
    ])
  })

  it('allows run --one-child rewrites when the existing automation PR is still draft', async () => {
    const adapters = createLiveAdapters({
      automationPr: {
        branchName: 'agent/prd-80-automate-prd-implementation',
        isDraft: true,
        prNumber: 123,
        prdIssueNumber: 80,
        url: 'https://github.com/motech-development/cv-maxxing/pull/123',
      },
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events).toContain('git:push-prd-branch')
    expect(adapters.events).toContain('github:get-pr')
  })

  it('refuses full run rewrites when the existing automation PR is ready for review', async () => {
    const adapters = createLiveAdapters({
      automationPr: {
        branchName: 'agent/prd-80-automate-prd-implementation',
        isDraft: false,
        prNumber: 123,
        prdIssueNumber: 80,
        url: 'https://github.com/motech-development/cv-maxxing/pull/123',
      },
      issues: multiChildIssueObjects,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('PR #123 is ready for review')
    expect(result.stderr).toContain('run will not amend commits or force-push')
    expect(adapters.events).toEqual([
      'preflight:run',
      'github:list-open-issues',
      'github:scan-automation-prs',
      'lock:acquire',
      'git:get-main-branch-status',
      'lock:release',
    ])
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

  it('records repeated verification failures as a PR and run blocker without committing', async () => {
    const adapters = createLiveAdapters({
      verificationFailuresBeforeClean: 2,
      verificationFailureMessage:
        'pnpm lint failed\nsrc/live-orchestrator.ts: repeated verification error',
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })
    const latestPrBody = adapters.updatedPrBodies.at(-1) ?? ''
    const latestComment = adapters.postedComments.at(-1) ?? ''

    expect(result.exitCode).toBe(1)
    expect(adapters.events).toContain('sandcastle:repair-verification')
    expect(adapters.events.filter((event) => event === 'verification:run')).toHaveLength(2)
    expect(adapters.events).not.toContain('git:commit-child')
    expect(adapters.events).not.toContain('git:amend-child-commit')
    expect(adapters.events.indexOf('git:restore-prd-branch')).toBeLessThan(
      adapters.events.indexOf('github:update-pr-body'),
    )
    expect(latestPrBody).toContain(
      '| #82 | Build PRD and child-task planning from GitHub Markdown | blocked |',
    )
    expect(latestComment).toContain('Failing verification command: pnpm lint')
    expect(latestComment).toContain('Error evidence: pnpm lint failed')
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: [
        'Verification repair exhausted for #82. Failing verification command: pnpm lint. Error evidence: pnpm lint failed',
      ],
      completedChildren: [],
      currentChildIssueNumber: 82,
      phase: 'blocked',
    })
  })

  it('records failed worker diff application as a PR and run blocker after restoring clean state', async () => {
    const adapters = createLiveAdapters({
      applyWorkerDiffError: new Error('git merge --squash failed\nCONFLICT in cli.ts'),
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })
    const latestComment = adapters.postedComments.at(-1) ?? ''

    expect(result.exitCode).toBe(1)
    expect(adapters.events).toContain('git:apply-worker-diff')
    expect(adapters.events).toContain('git:restore-prd-branch')
    expect(adapters.events.indexOf('git:restore-prd-branch')).toBeLessThan(
      adapters.events.indexOf('github:update-pr-body'),
    )
    expect(adapters.events).not.toContain('verification:run')
    expect(adapters.events).not.toContain('git:commit-child')
    expect(latestComment).toContain('Failed to apply worker diff for #82')
    expect(latestComment).toContain('Operation: apply worker diff from')
    expect(latestComment).toContain('Error evidence: git merge --squash failed')
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: [
        expect.stringContaining(
          'Failed to apply worker diff for #82. Operation: apply worker diff',
        ),
      ],
      currentChildIssueNumber: 82,
      phase: 'blocked',
    })
  })

  it('records repeated repair write-surface mismatches as blockers after restoring clean state', async () => {
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
          expectedFiles: ['tools/prd-orchestrator/src/cli.ts'],
          expectedModules: ['@cv-maxxing/prd-orchestrator'],
          riskLevel: 'low',
          sharedContracts: [],
          tests: ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
        },
      ],
      repairVerificationChangedFiles: ['apps/desktop/src/main.ts'],
      verificationFailuresBeforeClean: 1,
      workerChangedFiles: ['tools/prd-orchestrator/src/cli.ts'],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })
    const latestComment = adapters.postedComments.at(-1) ?? ''

    expect(result.exitCode).toBe(1)
    expect(adapters.events).toContain('sandcastle:repair-verification')
    expect(adapters.events).toContain('git:restore-prd-branch')
    expect(adapters.events).not.toContain('git:commit-child')
    expect(latestComment).toContain(
      'worker diff touched files outside impact-analysis write surface after re-analysis',
    )
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: [
        expect.stringContaining(
          'worker diff touched files outside impact-analysis write surface after re-analysis',
        ),
      ],
      currentChildIssueNumber: 82,
      phase: 'blocked',
    })
  })

  it('records missing Pencil evidence as a PR and run blocker before committing .pen changes', async () => {
    const adapters = createLiveAdapters({
      impactAnalyses: [
        {
          designFiles: ['design/app.pen'],
          expectedFiles: [],
          expectedModules: ['@cv-maxxing/prd-orchestrator'],
          riskLevel: 'medium',
          sharedContracts: [],
          tests: ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
        },
      ],
      workerChangedFiles: ['design/app.pen'],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run', '--one-child'],
      stdin: '',
    })
    const latestPrBody = adapters.updatedPrBodies.at(-1) ?? ''

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Pencil verification evidence missing')
    expect(adapters.events).toContain('verification:run')
    expect(adapters.events).toContain('github:update-pr-body')
    expect(adapters.events).toContain('state:record-run-status')
    expect(adapters.events).not.toContain('git:commit-child')
    expect(latestPrBody).toContain(
      '| #82 | Build PRD and child-task planning from GitHub Markdown | blocked |',
    )
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      blockers: [
        'Pencil verification evidence missing for .pen design changes: design/app.pen. Provide Pencil screenshot evidence or saved persistence evidence before committing.',
      ],
      currentChildIssueNumber: 82,
      phase: 'blocked',
    })
  })

  it('continues independent full-run children after verification repair is blocked', async () => {
    const adapters = createLiveAdapters({
      issues: independentMultiChildIssueObjects,
      verificationFailureCountsByChildIssueNumber: new Map([[82, 2]]),
      verificationFailureMessage: 'pnpm lint failed\nsame lint failure',
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
    expect(adapters.events.filter((event) => event === 'git:commit-child')).toHaveLength(1)
    expect(latestPrBody).toContain(
      '| #82 | Build PRD and child-task planning from GitHub Markdown | blocked |',
    )
    expect(latestPrBody).toContain(
      '| #84 | Generate PRD draft PR state, ledger, and merge instructions | complete |',
    )
  })

  it('allows a later full run to continue independent children after a verification block', async () => {
    const adapters = createLiveAdapters({
      issues: independentMultiChildIssueObjects,
      verificationFailureCountsByChildIssueNumber: new Map([[82, 4]]),
      verificationFailureMessage: 'pnpm lint failed\nsame lint failure',
    })

    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['run', '--one-child'],
        stdin: '',
      }),
    ).resolves.toMatchObject({
      exitCode: 1,
    })

    const laterResult = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['run'],
      stdin: '',
    })

    expect(laterResult.exitCode).toBe(1)
    expect(adapters.completedChildIssueNumbers).toEqual([84])
    expect(adapters.events.filter((event) => event === 'git:commit-child')).toHaveLength(1)
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
    expect(adapters.events).toContain('lock:release')
    expect(adapters.events.indexOf('preflight:run')).toBeLessThan(
      adapters.events.indexOf('github:get-pr'),
    )
    expect(adapters.events.indexOf('lock:acquire')).toBeLessThan(
      adapters.events.indexOf('state:recover-run-status'),
    )
    expect(adapters.events.indexOf('lock:release')).toBeGreaterThan(
      adapters.events.lastIndexOf('github:list-open-issues'),
    )
  })

  it('resumes an all-complete automation PR directly into finalization', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82, 83],
      issues: multiChildIssueObjects,
      recoveredRunStatusPhase: 'complete',
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events).toContain('state:recover-run-status')
    expect(adapters.events).toContain('ci:poll-checks')
    expect(adapters.events).toContain('github:upsert-pr-comment')
    expect(adapters.events).toContain('github:mark-ready-for-review')
    expect(adapters.events).not.toContain('git:get-main-branch-status')
    expect(adapters.events).not.toContain('sandcastle:implementation')
    expect(adapters.recordedStatuses.at(-1)).toMatchObject({
      ciStatus: 'passed',
      completedChildren: [82, 83],
      lastCommand: 'resume-pr',
      phase: 'ready-for-review',
    })
  })

  it('updates the existing final audit comment when resuming an already finalized branch', async () => {
    const adapters = createLiveAdapters({
      existingFinalAuditComment: '## Final PRD Acceptance Audit\n\nStale audit.',
      initialCompletedChildIssueNumbers: [82, 83],
      issues: multiChildIssueObjects,
      recoveredRunStatusPhase: 'complete',
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events).toContain('github:upsert-pr-comment')
    expect(adapters.events).toContain('github:update-pr-comment')
    expect(adapters.events).not.toContain('github:create-final-audit-comment')
    expect(adapters.upsertedComments).toHaveLength(1)
    expect(adapters.upsertedComments.at(0)).toContain('## Final PRD Acceptance Audit')
    expect(adapters.upsertedComments.at(0)).toContain(
      '- #82 Build PRD and child-task planning from GitHub Markdown (commit `abc8234`)',
    )
    expect(adapters.upsertedComments.at(0)).toContain(
      'Draft PR state is generated. Evidence: commit `abc8334`; verification evidence recorded in child commit',
    )
    expect(adapters.upsertedComments.at(0)).toContain('[ARCHITECTURE.md]')
    expect(adapters.upsertedComments.at(0)).toContain('- Telemetry: absent')
    expect(adapters.upsertedComments.at(0)).toContain('- Non-PDF exports: absent')
  })

  it('blocks ready-for-review when final audit evidence finds prohibited capabilities', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82, 83],
      issues: multiChildIssueObjects,
      prohibitedCapabilityMatches: [
        {
          capabilityId: 'redux',
          evidence: 'apps/desktop/src/state.ts: import { createStore } from "redux"',
        },
      ],
      recoveredRunStatusPhase: 'complete',
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(adapters.events).toContain('verification:scan-prohibited-capabilities')
    expect(adapters.events).toContain('github:upsert-pr-comment')
    expect(adapters.events).not.toContain('github:mark-ready-for-review')
    expect(result.stderr).toContain(
      'Prohibited capability scan found Redux evidence: apps/desktop/src/state.ts: import { createStore } from "redux"',
    )
    expect(adapters.recordedStatuses.at(-1)?.blockers).toContain(
      'Prohibited capability scan found Redux evidence: apps/desktop/src/state.ts: import { createStore } from "redux"',
    )
  })

  it('blocks resume-pr preflight before reading or mutating PR state', async () => {
    const adapters = createLiveAdapters({
      preflightResult: {
        blockers: ['Codex availability'],
        ready: false,
      },
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result).toEqual({
      exitCode: 1,
      stderr: 'Codex availability\n',
      stdout: '',
    })
    expect(adapters.events).toEqual(['preflight:run'])
  })

  it('blocks resume-pr on an active run lock before PR, branch, repair, or continuation work', async () => {
    const adapters = createLiveAdapters({
      runLockResult: {
        blockers: ['Another PRD orchestrator run is already active.'],
        lockId: undefined,
        ready: false,
      },
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result).toEqual({
      exitCode: 1,
      stderr: 'Another PRD orchestrator run is already active.\n',
      stdout: '',
    })
    expect(adapters.events).toEqual(['preflight:run', 'lock:acquire'])
  })

  it('releases the run lock when resume-pr throws after acquisition', async () => {
    const adapters = createLiveAdapters({
      getPrError: new Error('GitHub read failed'),
    })

    await expect(
      runPrdOrchestratorCliAsync({
        adapters,
        arguments_: ['resume-pr', '123'],
        stdin: '',
      }),
    ).rejects.toThrow('GitHub read failed')

    expect(adapters.events).toEqual([
      'preflight:run',
      'lock:acquire',
      'github:get-pr',
      'lock:release',
    ])
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
        'preflight:run',
        'lock:acquire',
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
        'lock:release',
      ]),
    )
    expect(adapters.events.indexOf('preflight:run')).toBeLessThan(
      adapters.events.indexOf('github:get-pr'),
    )
    expect(adapters.events.indexOf('lock:acquire')).toBeLessThan(
      adapters.events.indexOf('github:convert-pr-to-draft'),
    )
    expect(adapters.amendedCommitMessages.at(0)).toContain('Closes #82')
  })

  it('blocks final cleanup resume repair when the git adapter cannot commit cleanup', async () => {
    const adapters = createLiveAdapters({
      omitCommitFinalCleanup: true,
      resumePrFindings: [
        {
          body: 'Fix the final audit text.',
          id: 'resume-final-finding',
          source: 'github-pr-review',
          title: 'Final cleanup',
        },
      ],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Resume repair cannot commit final cleanup changes')
    expect(adapters.events).not.toContain('git:commit-final-cleanup')
    expect(adapters.events).not.toContain('git:push-prd-branch')
  })

  it('targets the mapped child commit before applying resume repair output', async () => {
    const adapters = createLiveAdapters({
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

    expect(result.exitCode).toBe(0)
    expect(adapters.checkoutChildCommitInputs).toEqual([
      {
        branchName: 'agent/prd-80-automate-prd-implementation',
        childIssueNumber: 82,
        commitHash: 'abc823456789',
      },
    ])
    expect(adapters.events.indexOf('git:checkout-child-commit')).toBeLessThan(
      adapters.events.indexOf('sandcastle:repair-resume-findings'),
    )
    expect(adapters.events.indexOf('git:checkout-child-commit')).toBeLessThan(
      adapters.events.indexOf('git:apply-worker-diff'),
    )
    expect(adapters.events.indexOf('git:checkout-child-commit')).toBeLessThan(
      adapters.events.indexOf('git:amend-child-commit'),
    )
  })

  it('checks mapped resume repair output, verifies it, and reruns CodeRabbit before amending', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82],
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

    expect(result.exitCode).toBe(0)
    expect(adapters.events.indexOf('sandcastle:repair-resume-findings')).toBeLessThan(
      adapters.events.indexOf('git:apply-worker-diff'),
    )
    expect(adapters.events.indexOf('git:apply-worker-diff')).toBeLessThan(
      adapters.events.indexOf('verification:run'),
    )
    expect(adapters.events.indexOf('verification:run')).toBeLessThan(
      adapters.events.indexOf('coderabbit:review'),
    )
    expect(adapters.events.indexOf('coderabbit:review')).toBeLessThan(
      adapters.events.indexOf('git:amend-child-commit'),
    )
    expect(adapters.events.indexOf('git:amend-child-commit')).toBeLessThan(
      adapters.events.indexOf('git:push-prd-branch'),
    )
  })

  it('checks and verifies final cleanup resume repair output before creating cleanup commits', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82],
      resumePrFindings: [
        {
          body: 'Tighten final audit wording.',
          filePath: 'tools/prd-orchestrator/src/final-prd-flow.ts',
          id: 'resume-final-finding',
          source: 'github-check',
          title: 'Final cleanup',
        },
      ],
      resumeRepairChangedFiles: ['tools/prd-orchestrator/src/final-prd-flow.ts'],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.events).not.toContain('git:amend-child-commit')
    expect(adapters.events.indexOf('git:apply-worker-diff')).toBeLessThan(
      adapters.events.indexOf('verification:run'),
    )
    expect(adapters.events.indexOf('verification:run')).toBeLessThan(
      adapters.events.indexOf('coderabbit:review'),
    )
    expect(adapters.events.indexOf('coderabbit:review')).toBeLessThan(
      adapters.events.indexOf('git:commit-final-cleanup'),
    )
    expect(adapters.events.indexOf('git:commit-final-cleanup')).toBeLessThan(
      adapters.events.indexOf('git:push-prd-branch'),
    )
  })

  it('records a resume repair blocker and avoids commits or push when verification fails', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82],
      resumePrFindings: [
        {
          body: 'Fix the child commit.',
          childIssueNumber: 82,
          id: 'resume-child-finding',
          source: 'github-pr-review',
          title: 'Child issue regression',
        },
      ],
      verificationFailureMessage: 'pnpm lint failed\nresume repair lint error',
      verificationFailuresBeforeClean: 1,
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Resume repair verification failed')
    expect(adapters.events).toContain('github:post-pr-comment')
    expect(adapters.events).toContain('state:record-run-status')
    expect(adapters.events).not.toContain('git:amend-child-commit')
    expect(adapters.events).not.toContain('git:commit-final-cleanup')
    expect(adapters.events).not.toContain('git:push-prd-branch')
    expect(adapters.recordedStatuses.at(-1)?.blockers.at(0)).toContain(
      'Resume repair verification failed',
    )
  })

  it('records a resume repair blocker when the repair worker fails', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82],
      resumePrFindings: [
        {
          body: 'Fix the child commit.',
          childIssueNumber: 82,
          id: 'resume-child-finding',
          source: 'github-pr-review',
          title: 'Child issue regression',
        },
      ],
      resumeRepairError: new Error('Sandcastle worker crashed'),
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Resume repair Sandcastle worker failed')
    expect(adapters.events).toContain('git:restore-prd-branch')
    expect(adapters.events).toContain('github:post-pr-comment')
    expect(adapters.events).toContain('state:record-run-status')
    expect(adapters.events).not.toContain('git:apply-worker-diff')
    expect(adapters.events).not.toContain('git:amend-child-commit')
    expect(adapters.events).not.toContain('git:push-prd-branch')
  })

  it('records a resume repair blocker and avoids push when CodeRabbit cannot become clean', async () => {
    const adapters = createLiveAdapters({
      codeRabbitFindings: [
        {
          body: 'Still broken after repair.',
          id: 'persistent-resume-finding',
          source: 'github-pr-review',
          title: 'Persistent resume finding',
        },
      ],
      initialCompletedChildIssueNumbers: [82],
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
    expect(result.stderr).toContain('Resume repair CodeRabbit rerun still has actionable findings')
    expect(
      adapters.events.filter((event) => event === 'sandcastle:repair-resume-findings'),
    ).toHaveLength(2)
    expect(adapters.events).toContain('github:post-pr-comment')
    expect(adapters.events).toContain('state:record-run-status')
    expect(adapters.events).not.toContain('git:amend-child-commit')
    expect(adapters.events).not.toContain('git:push-prd-branch')
  })

  it('records a resume repair blocker when the CodeRabbit rerun fails', async () => {
    const adapters = createLiveAdapters({
      codeRabbitReviewError: new Error('CodeRabbit authentication failed'),
      initialCompletedChildIssueNumbers: [82],
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
    expect(result.stderr).toContain('Resume repair CodeRabbit rerun failed')
    expect(adapters.events).toContain('git:restore-prd-branch')
    expect(adapters.events).toContain('github:post-pr-comment')
    expect(adapters.events).toContain('state:record-run-status')
    expect(adapters.events).not.toContain('git:amend-child-commit')
    expect(adapters.events).not.toContain('git:push-prd-branch')
  })

  it('blocks mapped resume repair output outside the child write surface before applying it', async () => {
    const adapters = createLiveAdapters({
      initialCompletedChildIssueNumbers: [82],
      resumePrFindings: [
        {
          body: 'Fix the child commit.',
          childIssueNumber: 82,
          id: 'resume-child-finding',
          source: 'github-pr-review',
          title: 'Child issue regression',
        },
      ],
      resumeRepairChangedFiles: ['tools/prd-orchestrator/src/unexpected.ts'],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(
      'Resume repair output touched files outside the child write surface',
    )
    expect(adapters.events).not.toContain('git:apply-worker-diff')
    expect(adapters.events).not.toContain('verification:run')
    expect(adapters.events).not.toContain('coderabbit:review')
    expect(adapters.events).not.toContain('git:amend-child-commit')
    expect(adapters.events).not.toContain('git:push-prd-branch')
  })

  it('maps resume PR review findings by changed file before amending child commits', async () => {
    const adapters = createLiveAdapters({
      childCommitReferences: [
        {
          changedFiles: ['tools/prd-orchestrator/src/default-live-adapters.ts'],
          childIssueNumber: 82,
          commitHash: 'abc823456789',
        },
      ],
      resumePrFindings: [
        {
          body: 'Fix the inline review comment.',
          filePath: 'tools/prd-orchestrator/src/default-live-adapters.ts',
          id: 'resume-file-finding',
          source: 'github-pr-review',
          title: 'File-scoped regression',
        },
      ],
      resumeRepairChangedFiles: ['tools/prd-orchestrator/src/default-live-adapters.ts'],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['resume-pr', '123'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(adapters.checkoutChildCommitInputs).toEqual([
      {
        branchName: 'agent/prd-80-automate-prd-implementation',
        childIssueNumber: 82,
        commitHash: 'abc823456789',
      },
    ])
    expect(adapters.events).toContain('git:amend-child-commit')
    expect(adapters.events).not.toContain('git:commit-final-cleanup')
  })

  it('blocks resume repair instead of amending the wrong HEAD when targeted checkout is unavailable', async () => {
    const adapters = createLiveAdapters({
      omitCheckoutChildCommit: true,
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
    expect(result.stderr).toBe(
      'Resume repair cannot safely target child commits because the git adapter does not support targeted checkout.\n',
    )
    expect(adapters.events).toContain('lock:release')
    expect(adapters.events).not.toContain('sandcastle:repair-resume-findings')
    expect(adapters.events).not.toContain('git:amend-child-commit')
    expect(adapters.events).not.toContain('git:push-prd-branch')
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
    expect(adapters.events).toContain('github:scan-automation-prs')
    expect(adapters.events).toContain('state:read-run-status')
    expect(adapters.events).toContain('state:read-artifact-status')
    expect(adapters.events).toContain('state:cleanup')
  })

  it('reports remote automation PR ownership in status when no local lock is active', async () => {
    const adapters = createLiveAdapters({
      openAutomationPrs: [
        {
          branchName: 'agent/prd-91-other-prd',
          isDraft: true,
          prNumber: 456,
          prdIssueNumber: 91,
          url: 'https://github.com/motech-development/cv-maxxing/pull/456',
        },
      ],
    })
    const result = await runPrdOrchestratorCliAsync({
      adapters,
      arguments_: ['status'],
      stdin: '',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'Remote automation PRs: #456 for PRD #91 on agent/prd-91-other-prd',
    )
    expect(adapters.events).toEqual([
      'state:read-run-status',
      'github:get-current-pr',
      'state:read-artifact-status',
      'github:scan-automation-prs',
    ])
  })

  it('passes CLI model and effort flags to the default live adapter factory', () => {
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', {
      codexEffort: 'xhigh',
      codexModel: 'gpt-5.1-codex-max',
    })

    expect(adapters.configuration).toEqual({
      codexEffort: 'xhigh',
      codexModel: 'gpt-5.1-codex-max',
    })
  })
})

interface CreateLiveAdaptersOptions {
  readonly applyWorkerDiffError?: Error
  readonly blockedImplementationChildIssueNumbers?: ReadonlySet<number>
  readonly childCommitReferences?: readonly ChildCommitReference[]
  readonly ciPollingResults?: readonly (GitHubActionsStatus | Error)[]
  readonly ciPollingTimeoutMs?: number
  readonly codeRabbitFindings?: readonly CodeRabbitFinding[]
  readonly codeRabbitFindingsBeforeClean?: number
  readonly codeRabbitReviewError?: Error
  readonly automationPr?: RemoteAutomationPr
  readonly existingFinalAuditComment?: string
  readonly getPrError?: Error
  readonly impactAnalyses?: readonly Awaited<
    ReturnType<PrdOrchestratorLiveAdapters['sandcastle']['runImpactAnalysis']>
  >[]
  readonly initialCompletedChildIssueNumbers?: readonly number[]
  readonly issues?: readonly GitHubIssue[]
  readonly omitCheckoutChildCommit?: boolean
  readonly omitCommitFinalCleanup?: boolean
  readonly openAutomationPrs?: readonly RemoteAutomationPr[]
  readonly preflightResult?: LivePreflightResult
  readonly prBranchName?: string
  readonly prohibitedCapabilityMatches?: readonly ProhibitedCapabilityMatch[]
  readonly recoveredRunStatusPhase?: string
  readonly repairReviewError?: Error
  readonly remoteAutomationBlockers?: readonly string[]
  readonly resumeRepairChangedFiles?: readonly string[]
  readonly resumeRepairError?: Error
  readonly repairVerificationChangedFiles?: readonly string[]
  readonly resumePrFindings?: readonly ResumePrFinding[]
  readonly runLockResult?: LiveRunLockResult
  readonly verificationFailureCountsByChildIssueNumber?: ReadonlyMap<number, number>
  readonly verificationFailuresBeforeClean?: number
  readonly verificationFailureMessage?: string
  readonly workerChangedFiles?: readonly string[]
  readonly workerChangedFilesByChildIssueNumber?: ReadonlyMap<number, readonly string[]>
}

const createLiveAdapters = (
  options: CreateLiveAdaptersOptions = {},
): PrdOrchestratorLiveAdapters & {
  readonly events: string[]
  readonly amendedCommitMessages: string[]
  readonly checkoutChildCommitInputs: {
    readonly branchName: string
    readonly childIssueNumber: number
    readonly commitHash: string
  }[]
  readonly completedChildIssueNumbers: number[]
  readonly postedComments: string[]
  readonly recordedStatuses: RunStatus[]
  readonly updatedPrBodies: string[]
  readonly upsertedComments: string[]
  readonly workerBranchNames: string[]
} => {
  const events: string[] = []
  const amendedCommitMessages: string[] = []
  const checkoutChildCommitInputs: {
    readonly branchName: string
    readonly childIssueNumber: number
    readonly commitHash: string
  }[] = []
  const recordedStatuses: RunStatus[] = []
  const postedComments: string[] = []
  const completedChildIssueNumbers: number[] = [
    ...(options.initialCompletedChildIssueNumbers ?? []),
  ]
  const updatedPrBodies: string[] = []
  const upsertedComments: string[] = []
  const workerBranchNames: string[] = []
  let codeRabbitReviewCount = 0
  let ciPollingCount = 0
  let impactAnalysisCount = 0
  let prIsDraft = options.automationPr?.isDraft ?? options.resumePrFindings === undefined
  let lastRecordedStatus:
    | Awaited<ReturnType<PrdOrchestratorLiveAdapters['state']['readRunStatus']>>
    | undefined
  let verificationRunCount = 0
  const verificationRunCountsByChildIssueNumber = new Map<number, number>()
  let activeChildIssueNumber: number | undefined

  return {
    ci: {
      pollChecks: () => {
        events.push('ci:poll-checks')
        const result = options.ciPollingResults?.[ciPollingCount]
        ciPollingCount += 1

        if (result instanceof Error) {
          return Promise.reject(result)
        }

        return Promise.resolve(
          result ?? {
            blockers: [],
            status: 'passed',
          },
        )
      },
    },
    amendedCommitMessages,
    checkoutChildCommitInputs,
    completedChildIssueNumbers,
    codeRabbit: {
      reviewChild: () => {
        events.push('coderabbit:review')
        codeRabbitReviewCount += 1

        if (options.codeRabbitReviewError !== undefined) {
          return Promise.reject(options.codeRabbitReviewError)
        }

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
    configuration: {
      ciPollingIntervalMs: 0,
      ciPollingTimeoutMs: options.ciPollingTimeoutMs ?? 1000,
      codexEffort: undefined,
      codexModel: undefined,
    },
    updatedPrBodies,
    upsertedComments,
    workerBranchNames,
    recordedStatuses,
    git: {
      applyWorkerDiff: (input) => {
        events.push('git:apply-worker-diff')
        activeChildIssueNumber = Number.parseInt(
          /-child-(\d+)-/.exec(input.workerBranchName)?.[1] ?? '',
          10,
        )

        return options.applyWorkerDiffError === undefined
          ? Promise.resolve()
          : Promise.reject(options.applyWorkerDiffError)
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
      checkoutChildCommit:
        options.omitCheckoutChildCommit === true
          ? undefined
          : (input) => {
              events.push('git:checkout-child-commit')
              checkoutChildCommitInputs.push(input)

              return Promise.resolve()
            },
      commitFinalCleanup:
        options.omitCommitFinalCleanup === true
          ? undefined
          : () => {
              events.push('git:commit-final-cleanup')

              return Promise.resolve({
                hash: 'fed789012345',
              })
            },
      getChildCommitReferences: () => {
        events.push('git:get-child-commit-references')

        if (options.childCommitReferences !== undefined) {
          return Promise.resolve(options.childCommitReferences)
        }

        return Promise.resolve(
          (completedChildIssueNumbers.length === 0 ? [82] : completedChildIssueNumbers).map(
            (childIssueNumber) => ({
              changedFiles: ['tools/prd-orchestrator/src/cli.ts'],
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
      restorePrdBranchToCleanState: () => {
        events.push('git:restore-prd-branch')

        return Promise.resolve()
      },
    },
    github: {
      createDraftPr: () => {
        events.push('github:create-draft-pr')

        return Promise.resolve({
          branchName: 'agent/prd-80-automate-prd-implementation',
          isDraft: true,
          prNumber: 123,
          prdIssueNumber: 80,
          url: 'https://github.com/motech-development/cv-maxxing/pull/123',
        })
      },
      findAutomationPr: () => {
        events.push('github:find-automation-pr')

        return Promise.resolve(options.automationPr)
      },
      getOpenAutomationPrOwnership: () => {
        events.push('github:scan-automation-prs')

        return Promise.resolve({
          blockers: options.remoteAutomationBlockers ?? [],
          remoteAutomationPrs:
            options.openAutomationPrs ??
            (options.automationPr === undefined ? [] : [options.automationPr]),
        })
      },
      getPr: () => {
        events.push('github:get-pr')

        if (options.getPrError !== undefined) {
          return Promise.reject(options.getPrError)
        }

        return Promise.resolve({
          body: '## Automation\n\nManaged by `@cv-maxxing/prd-orchestrator`.',
          branchName: options.prBranchName ?? 'agent/prd-80-automate-prd-implementation',
          isDraft: prIsDraft,
          prNumber: 123,
          url: 'https://github.com/motech-development/cv-maxxing/pull/123',
        })
      },
      convertPrToDraft: () => {
        events.push('github:convert-pr-to-draft')
        prIsDraft = true

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
      upsertPrComment: (input) => {
        events.push('github:upsert-pr-comment')
        upsertedComments.push(input.body)

        if (options.existingFinalAuditComment === undefined) {
          events.push('github:create-final-audit-comment')
        } else {
          events.push('github:update-pr-comment')
        }

        return Promise.resolve()
      },
    },
    sandcastle: {
      repairResumeFindings: () => {
        events.push('sandcastle:repair-resume-findings')

        if (options.resumeRepairError !== undefined) {
          return Promise.reject(options.resumeRepairError)
        }

        return Promise.resolve({
          changedFiles: options.resumeRepairChangedFiles ?? ['tools/prd-orchestrator/src/cli.ts'],
          stdout: 'repaired resume findings',
          workerBranchName:
            'agent/prd-80-child-82-build-prd-and-child-task-planning-from-github-markdown',
        })
      },
      repairReviewFindings: () => {
        events.push('sandcastle:repair-review')

        if (options.repairReviewError !== undefined) {
          return Promise.reject(options.repairReviewError)
        }

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
          changedFiles: options.repairVerificationChangedFiles ?? [
            'tools/prd-orchestrator/src/cli.ts',
          ],
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
          workerBranchName: input.workerBranchName,
        })
      },
    },
    state: {
      acquireRunLock: () => {
        events.push('lock:acquire')

        return Promise.resolve(
          options.runLockResult ?? {
            blockers: [],
            lockId: 'run-1',
            ready: true,
          },
        )
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
          options.recoveredRunStatusPhase ??
          (completedChildIssueNumbers.length >= childIssueCount ? 'ready-for-review' : 'complete')

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

        return Promise.resolve(
          options.preflightResult ?? {
            blockers: [],
            ready: true,
          },
        )
      },
    },
    verification: {
      runCommands: () => {
        events.push('verification:run')
        verificationRunCount += 1
        const childIssueNumber = activeChildIssueNumber
        const childVerificationRunCount =
          childIssueNumber === undefined
            ? verificationRunCount
            : (verificationRunCountsByChildIssueNumber.get(childIssueNumber) ?? 0) + 1

        if (childIssueNumber !== undefined) {
          verificationRunCountsByChildIssueNumber.set(childIssueNumber, childVerificationRunCount)
        }
        const failuresBeforeClean =
          childIssueNumber === undefined
            ? (options.verificationFailuresBeforeClean ?? 0)
            : (options.verificationFailureCountsByChildIssueNumber?.get(childIssueNumber) ??
              options.verificationFailuresBeforeClean ??
              0)

        if (childVerificationRunCount <= failuresBeforeClean) {
          return Promise.reject(
            new Error(options.verificationFailureMessage ?? 'verification failed'),
          )
        }

        return Promise.resolve([
          'pnpm lint',
          'pnpm --filter @cv-maxxing/prd-orchestrator typecheck',
        ])
      },
      scanProhibitedCapabilities: (input) => {
        events.push('verification:scan-prohibited-capabilities')

        return Promise.resolve(
          createProhibitedCapabilityScanResults({
            matches: options.prohibitedCapabilityMatches ?? [],
            scannedFiles: input.changedFiles,
          }),
        )
      },
    },
    postedComments,
  }
}
