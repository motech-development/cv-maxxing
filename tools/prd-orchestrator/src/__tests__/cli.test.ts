import { describe, expect, it } from 'vitest'

import { runPrdOrchestratorCli } from '../cli.js'

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
})
