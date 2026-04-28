import { describe, expect, it } from 'vitest'

import { runPrdOrchestratorCli, runPrdOrchestratorCliAsync } from '../cli.js'
import type { PrdOrchestratorLiveAdapters } from '../live-orchestrator.js'
import type { RemoteAutomationPr } from '../run-guardrails.js'

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
      'github:list-open-issues',
      'git:get-main-branch-status',
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
    ])
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
    expect(adapters.events).toContain('state:read-run-status')
    expect(adapters.events).toContain('state:cleanup')
  })
})

const createLiveAdapters = (): PrdOrchestratorLiveAdapters & {
  readonly events: string[]
} => {
  const events: string[] = []

  return {
    ci: {
      pollChecks: () => {
        events.push('ci:poll-checks')

        return Promise.resolve('passed')
      },
    },
    codeRabbit: {
      reviewChild: () => {
        events.push('coderabbit:review')

        return Promise.resolve({
          findings: [],
          status: 'passed',
        })
      },
    },
    events,
    git: {
      applyWorkerDiff: () => {
        events.push('git:apply-worker-diff')

        return Promise.resolve()
      },
      commitChild: () => {
        events.push('git:commit-child')

        return Promise.resolve({
          hash: 'abc123456789',
        })
      },
      getMainBranchStatus: () => {
        events.push('git:get-main-branch-status')

        return Promise.resolve({
          clean: true,
          currentBranch: 'main',
          upToDate: true,
        })
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
          isDraft: true,
          prNumber: 123,
          url: 'https://github.com/motech-development/cv-maxxing/pull/123',
        })
      },
      listOpenIssues: () => {
        events.push('github:list-open-issues')

        return Promise.resolve(issueObjects)
      },
      markReadyForReview: () => {
        events.push('github:mark-ready-for-review')

        return Promise.resolve()
      },
      postPrComment: () => {
        events.push('github:post-pr-comment')

        return Promise.resolve()
      },
      updatePrBody: () => {
        events.push('github:update-pr-body')

        return Promise.resolve()
      },
    },
    sandcastle: {
      runImpactAnalysis: () => {
        events.push('sandcastle:impact-analysis')

        return Promise.resolve({
          designFiles: [],
          expectedFiles: ['tools/prd-orchestrator/src/cli.ts'],
          expectedModules: ['@cv-maxxing/prd-orchestrator'],
          riskLevel: 'low',
          sharedContracts: [],
          tests: ['tools/prd-orchestrator/src/__tests__/cli.test.ts'],
        })
      },
      runImplementation: () => {
        events.push('sandcastle:implementation')

        return Promise.resolve({
          changedFiles: ['tools/prd-orchestrator/src/cli.ts'],
          stdout: 'implemented child',
          workerBranchName:
            'agent/prd-80-child-82-build-prd-and-child-task-planning-from-github-markdown',
        })
      },
    },
    state: {
      cleanup: () => {
        events.push('state:cleanup')

        return Promise.resolve({
          preserve: [],
          remove: ['.git/prd-orchestrator/runs/stale'],
        })
      },
      readRunStatus: () => {
        events.push('state:read-run-status')

        return Promise.resolve({
          activePrdIssueNumber: 80,
          blockers: [],
          branchName: 'agent/prd-80-automate-prd-implementation',
          ciStatus: 'unknown',
          codeRabbitStatus: 'passed',
          completedChildren: [82],
          currentChildIssueNumber: undefined,
          heartbeatIso: '2026-04-28T17:00:00.000Z',
          lastCommand: 'run --one-child',
          phase: 'complete',
          prNumber: 123,
          prUrl: 'https://github.com/motech-development/cv-maxxing/pull/123',
        })
      },
      recordRunStatus: () => {
        events.push('state:record-run-status')

        return Promise.resolve()
      },
    },
    verification: {
      runCommands: () => {
        events.push('verification:run')

        return Promise.resolve([
          'pnpm lint',
          'pnpm --filter @cv-maxxing/prd-orchestrator typecheck',
        ])
      },
    },
  }
}
