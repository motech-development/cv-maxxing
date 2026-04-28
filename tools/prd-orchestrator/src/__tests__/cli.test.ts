import { describe, expect, it } from 'vitest'

import { runPrdOrchestratorCli, runPrdOrchestratorCliAsync } from '../cli.js'
import { createDefaultPrdOrchestratorLiveAdapters } from '../default-live-adapters.js'
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
      'preflight:run',
      'lock:acquire',
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
      'lock:release',
    ])
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
    expect(adapters.events.filter((event) => event === 'coderabbit:review')).toHaveLength(2)
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
  readonly codeRabbitFindingsBeforeClean?: number
  readonly verificationFailuresBeforeClean?: number
  readonly workerChangedFiles?: readonly string[]
}

const createLiveAdapters = (
  options: CreateLiveAdaptersOptions = {},
): PrdOrchestratorLiveAdapters & {
  readonly events: string[]
} => {
  const events: string[] = []
  let codeRabbitReviewCount = 0
  let verificationRunCount = 0

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
        codeRabbitReviewCount += 1
        const findings =
          codeRabbitReviewCount <= (options.codeRabbitFindingsBeforeClean ?? 0)
            ? [
                {
                  body: 'Repair this finding.',
                  id: `finding-${String(codeRabbitReviewCount)}`,
                  source: 'github-pr-review' as const,
                  title: 'CodeRabbit finding',
                },
              ]
            : []

        return Promise.resolve({
          findings,
          status: findings.length === 0 ? 'passed' : 'findings',
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
      amendChildCommit: () => {
        events.push('git:amend-child-commit')

        return Promise.resolve({
          hash: 'def456789012',
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
          changedFiles: options.workerChangedFiles ?? ['tools/prd-orchestrator/src/cli.ts'],
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
      recoverRunStatusFromPr: () => {
        events.push('state:recover-run-status')

        return Promise.resolve()
      },
      recordRunStatus: () => {
        events.push('state:record-run-status')

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
  }
}
