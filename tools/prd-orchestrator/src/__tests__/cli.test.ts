import { describe, expect, it } from 'vitest'

import { runPrdOrchestratorCli } from '../cli.js'

const issueJson = JSON.stringify([
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
])

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

  it('rejects unsupported commands without mutating state', () => {
    expect(
      runPrdOrchestratorCli({
        arguments_: ['run', '--one-child'],
        stdin: issueJson,
      }),
    ).toEqual({
      exitCode: 1,
      stderr: 'Unsupported command. Only read-only `plan` is supported.\n',
      stdout: '',
    })
  })
})
