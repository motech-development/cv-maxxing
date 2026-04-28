import { describe, expect, it } from 'vitest'

import {
  createDefaultPrdOrchestratorLiveAdapters,
  type DefaultLiveAdapterShellCommandInput,
  type DefaultLiveAdapterShellRunner,
} from '../default-live-adapters.js'

describe('default live adapters', () => {
  it('constructs GitHub, CI, and preflight commands without live mutations in tests', async () => {
    const shell = createRecordingShell()
    const adapters = createDefaultPrdOrchestratorLiveAdapters(
      '/repo',
      {
        codexEffort: 'high',
        codexModel: 'gpt-5.5',
      },
      shell.run,
    )

    await adapters.github.listOpenIssues()
    await adapters.github.createDraftPr({
      body: 'PR body',
      branchName: 'agent/prd-80-test',
      prdIssueNumber: 80,
      title: 'feat: test',
    })
    await adapters.ci.pollChecks({
      branchName: 'agent/prd-80-test',
      prNumber: 123,
    })
    await adapters.state.runPreflight()

    expect(shell.commands.map((command) => formatCommand(command))).toEqual([
      'gh issue list --state open --limit 200 --json number,title,body,state',
      'gh pr create --draft --base main --head agent/prd-80-test --title feat: test --body-file <tmp>',
      'gh pr list --state open --head agent/prd-80-test --json number,url,headRefName,body,isDraft --limit 1',
      'gh run list --branch agent/prd-80-test --json name,status,conclusion --limit 20',
      'node --version',
      'pnpm --version',
      'gh auth status',
      'git --version',
      'docker ps',
      'coderabbit --version',
    ])
  })

  it('returns preflight blockers when required tools fail', async () => {
    const shell = createRecordingShell({
      failingCommands: new Set(['gh auth status']),
    })
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await expect(adapters.state.runPreflight()).resolves.toEqual({
      blockers: ['gh preflight failed'],
      ready: false,
    })
  })
})

const createRecordingShell = (
  input: {
    readonly failingCommands?: ReadonlySet<string>
  } = {},
): {
  readonly commands: DefaultLiveAdapterShellCommandInput[]
  readonly run: DefaultLiveAdapterShellRunner
} => {
  const commands: DefaultLiveAdapterShellCommandInput[] = []

  return {
    commands,
    run: (command) => {
      commands.push(command)

      if (input.failingCommands?.has(formatCommand(command)) === true) {
        return Promise.reject(new Error(`Failed: ${formatCommand(command)}`))
      }

      return Promise.resolve({
        stderr: '',
        stdout: responseForCommand(command),
      })
    },
  }
}

const responseForCommand = (command: DefaultLiveAdapterShellCommandInput): string => {
  const formattedCommand = formatCommand(command)

  if (formattedCommand.startsWith('gh issue list')) {
    return JSON.stringify([
      {
        body: '## User Stories\n\n1. Test',
        number: 80,
        state: 'OPEN',
        title: 'PRD: Test',
      },
    ])
  }

  if (formattedCommand.startsWith('gh pr list')) {
    return JSON.stringify([
      {
        body: '## Automation\n\nManaged by `@cv-maxxing/prd-orchestrator`.',
        headRefName: 'agent/prd-80-test',
        isDraft: true,
        number: 123,
        url: 'https://github.com/motech-development/cv-maxxing/pull/123',
      },
    ])
  }

  if (formattedCommand.startsWith('gh run list')) {
    return JSON.stringify([
      {
        conclusion: 'success',
        name: 'unit',
        status: 'completed',
      },
    ])
  }

  return ''
}

const formatCommand = (command: DefaultLiveAdapterShellCommandInput): string =>
  `${command.command} ${command.args
    .map((argument) =>
      argument.startsWith('/var/') || argument.startsWith('/tmp/') ? '<tmp>' : argument,
    )
    .join(' ')}`
