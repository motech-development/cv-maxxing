import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

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
        codexModel: 'gpt-5.1-codex-max',
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
      'gh run list --branch agent/prd-80-test --json name,status,conclusion,workflowDatabaseId,startedAt --limit 20',
      'node --version',
      'pnpm --version',
      'git --version',
      'git status --porcelain',
      'git fetch --dry-run origin main',
      'gh auth status',
      'gh pr list --state open --limit 1 --json number',
      'git push --dry-run origin HEAD',
      'gh run list --limit 1 --json status,conclusion',
      'docker ps --format {{.ID}}',
      'node --input-type=module --eval import("@ai-hero/sandcastle")',
      'coderabbit --version',
      'codex --version',
      'pnpm --filter @cv-maxxing/prd-orchestrator exec vitest --version',
    ])
  })

  it('returns preflight blockers when required tools fail', async () => {
    const shell = createRecordingShell({
      failingCommands: new Set(['gh auth status']),
    })
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await expect(adapters.state.runPreflight()).resolves.toEqual({
      blockers: ['GitHub read/write capability'],
      ready: false,
    })
  })

  it('normalizes GitHub Actions status to the latest run for each workflow', async () => {
    const shell = createRecordingShell({
      historicalWorkflowRuns: true,
    })
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await expect(
      adapters.ci.pollChecks({
        branchName: 'agent/prd-80-test',
        prNumber: 123,
      }),
    ).resolves.toEqual({
      blockers: [],
      status: 'passed',
    })
  })

  it('loads existing automation PR draft state before live run rewrites', async () => {
    const shell = createRecordingShell()
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await expect(adapters.github.findAutomationPr(80, 'agent/prd-80-test')).resolves.toMatchObject({
      branchName: 'agent/prd-80-test',
      isDraft: true,
      prNumber: 123,
      prdIssueNumber: 80,
    })
    expect(shell.commands.map((command) => formatCommand(command))).toEqual([
      'gh pr list --state open --head agent/prd-80-test --json number,url,headRefName,body,isDraft --limit 1',
    ])
  })

  it('scans open PRs for valid remote automation ownership', async () => {
    const shell = createRecordingShell()
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await expect(adapters.github.getOpenAutomationPrOwnership()).resolves.toEqual({
      blockers: [],
      remoteAutomationPrs: [
        {
          branchName: 'agent/prd-80-test',
          isDraft: true,
          prNumber: 123,
          prdIssueNumber: 80,
          url: 'https://github.com/motech-development/cv-maxxing/pull/123',
        },
      ],
    })
    expect(shell.commands.map((command) => formatCommand(command))).toEqual([
      'gh pr list --state open --json number,url,headRefName,body,isDraft --limit 100',
    ])
  })

  it('reports malformed remote automation PR body as an ownership blocker', async () => {
    const shell = createRecordingShell({
      malformedAutomationPrBody: true,
    })
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await expect(adapters.github.getOpenAutomationPrOwnership()).resolves.toEqual({
      blockers: [
        'PR #123 body is missing the orchestrator Automation section',
        'PR #123 body does not declare draft branch `agent/prd-80-test`',
      ],
      remoteAutomationPrs: [],
    })
  })

  it('removes temporary body files after shell commands consume them', async () => {
    const shell = createRecordingShell()
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await adapters.github.createDraftPr({
      body: 'Temporary PR body',
      branchName: 'agent/prd-80-test',
      prdIssueNumber: 80,
      title: 'feat: test',
    })

    const bodyFilePath = shell.commands
      .flatMap((command) => command.args)
      .find((argument) => argument.endsWith('/content.txt'))

    expect(bodyFilePath).toBeDefined()
    await expect(stat(path.dirname(bodyFilePath ?? ''))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('inspects CodeRabbit PR reviews, comments, inline comments, and check rollups', async () => {
    const shell = createRecordingShell()
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await expect(
      adapters.codeRabbit.reviewChild({
        branchName: 'agent/prd-80-test',
        childCommitHash: 'abc123456789',
        childIssueNumber: 81,
        prNumber: 123,
      }),
    ).resolves.toEqual({
      findings: [
        {
          body: 'Requested changes from review.',
          id: 'coderabbit-review-1',
          source: 'github-pr-review',
          title: 'CodeRabbit requested changes',
        },
        {
          body: 'Top-level comment body.',
          id: 'coderabbit-comment-1',
          source: 'github-pr-review',
          title: 'CodeRabbit PR comment',
        },
        {
          body: 'Inline comment body.',
          commitHash: 'abc123456789',
          filePath: 'tools/prd-orchestrator/src/default-live-adapters.ts',
          id: 'coderabbit-inline-comment-1',
          lineNumber: 42,
          source: 'github-pr-review',
          title: 'CodeRabbit inline review comment',
        },
        {
          body: 'CodeRabbit check CodeRabbit failed with conclusion failure.',
          id: 'coderabbit-check-1',
          source: 'github-check',
          title: 'CodeRabbit check failed',
        },
      ],
      status: 'findings',
    })
    expect(shell.commands.map((command) => formatCommand(command))).toContain(
      'gh pr view 123 --json reviews,comments,statusCheckRollup',
    )
    expect(shell.commands.map((command) => formatCommand(command))).toContain(
      'gh api repos/{owner}/{repo}/pulls/123/comments --paginate --slurp',
    )
    expect(
      shell.commands.find((command) => formatCommand(command) === 'coderabbit review --agent')
        ?.timeoutMs,
    ).toBe('none')
  })

  it('scans prohibited capabilities against the working tree files, not a branch ref', async () => {
    const shell = createRecordingShell()
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await adapters.verification.scanProhibitedCapabilities({
      branchName: 'agent/prd-80-test',
      changedFiles: ['apps/desktop/src/main.ts'],
    })

    expect(shell.commands.map((command) => formatCommand(command))).toContain(
      'git grep --line-number --extended-regexp --ignore-case @sentry|posthog|analytics-node|crashReporter|trackEvent|telemetryClient -- apps/desktop/src/main.ts',
    )
    expect(shell.commands.map((command) => command.args)).not.toContainEqual(
      expect.arrayContaining(['agent/prd-80-test']),
    )
  })

  it('checks out the exact child commit before amending and rebases the PR branch onto the amended commit', async () => {
    const shell = createRecordingShell()
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await adapters.git.checkoutChildCommit?.({
      branchName: 'agent/prd-80-test',
      childIssueNumber: 81,
      commitHash: 'abc123456789',
    })
    await adapters.git.applyWorkerDiff({
      prdBranchName: 'agent/prd-80-test',
      workerBranchName: 'agent/prd-80-test-resume-81',
    })
    await adapters.git.amendChildCommit('fix: address review findings for child #81')

    expect(shell.commands.map((command) => formatCommand(command))).toEqual([
      'git checkout agent/prd-80-test',
      'git cat-file -e abc123456789^{commit}',
      'git merge-base --is-ancestor abc123456789 agent/prd-80-test',
      'git checkout abc123456789',
      'git merge --squash --no-commit agent/prd-80-test-resume-81',
      'git add --all',
      'git commit --amend -F <tmp>',
      'git rev-parse HEAD',
      'git rebase --onto amended123456789 abc123456789 agent/prd-80-test',
      'git checkout agent/prd-80-test',
    ])
  })

  it('restores the automation branch worktree and index to a clean HEAD state', async () => {
    const shell = createRecordingShell()
    const adapters = createDefaultPrdOrchestratorLiveAdapters('/repo', undefined, shell.run)

    await adapters.git.restorePrdBranchToCleanState({
      branchName: 'agent/prd-80-test',
    })

    expect(shell.commands.map((command) => formatCommand(command))).toEqual([
      'git checkout agent/prd-80-test',
      'git reset --hard HEAD',
      'git clean -fd',
      'git status --porcelain',
    ])
  })

  it('re-acquires a stale repo lock atomically during recovery', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'prd-orchestrator-lock-'))
    const lockDirectory = path.join(temporaryDirectory, '.git', 'prd-orchestrator')
    const lockFilePath = path.join(lockDirectory, 'lock.json')
    const adapters = createDefaultPrdOrchestratorLiveAdapters(temporaryDirectory)

    await mkdir(lockDirectory, {
      recursive: true,
    })
    await writeFile(
      lockFilePath,
      JSON.stringify({
        heartbeatIso: new Date(0).toISOString(),
        pid: 9_999_999,
        runId: 'stale-run',
      }),
    )

    await expect(adapters.state.acquireRunLock()).resolves.toMatchObject({
      blockers: [],
      ready: true,
    })
  })
})

const createRecordingShell = (
  input: {
    readonly failingCommands?: ReadonlySet<string>
    readonly historicalWorkflowRuns?: boolean
    readonly malformedAutomationPrBody?: boolean
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
        stdout: responseForCommand(command, input),
      })
    },
  }
}

const responseForCommand = (
  command: DefaultLiveAdapterShellCommandInput,
  input: {
    readonly historicalWorkflowRuns?: boolean
    readonly malformedAutomationPrBody?: boolean
  },
): string => {
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
        body:
          input.malformedAutomationPrBody === true
            ? '## Summary\n\nMissing owner contract.'
            : '## Automation\n\nManaged by `@cv-maxxing/prd-orchestrator`.\n\nDraft branch `agent/prd-80-test` is automation-owned and may be force-pushed while this PR remains draft.',
        headRefName: 'agent/prd-80-test',
        isDraft: true,
        number: 123,
        url: 'https://github.com/motech-development/cv-maxxing/pull/123',
      },
    ])
  }

  if (formattedCommand.startsWith('gh run list')) {
    if (input.historicalWorkflowRuns === true) {
      return JSON.stringify([
        {
          conclusion: 'failure',
          name: 'unit',
          startedAt: '2026-04-28T10:00:00Z',
          status: 'completed',
          workflowDatabaseId: 1,
        },
        {
          conclusion: 'success',
          name: 'unit',
          startedAt: '2026-04-28T11:00:00Z',
          status: 'completed',
          workflowDatabaseId: 1,
        },
        {
          conclusion: 'neutral',
          name: 'lint',
          startedAt: '2026-04-28T11:05:00Z',
          status: 'completed',
          workflowDatabaseId: 2,
        },
      ])
    }

    return JSON.stringify([
      {
        conclusion: 'success',
        name: 'unit',
        status: 'completed',
      },
    ])
  }

  if (formattedCommand.startsWith('gh pr view 123 --json reviews')) {
    return JSON.stringify({
      comments: [
        {
          author: {
            login: 'coderabbitai',
          },
          body: 'Top-level comment body.',
        },
      ],
      reviews: [
        {
          author: {
            login: 'coderabbitai',
          },
          body: 'Requested changes from review.',
          state: 'CHANGES_REQUESTED',
        },
      ],
      statusCheckRollup: [
        {
          conclusion: 'failure',
          name: 'CodeRabbit',
          status: 'COMPLETED',
        },
      ],
    })
  }

  if (formattedCommand === 'gh api repos/{owner}/{repo}/pulls/123/comments --paginate --slurp') {
    return JSON.stringify([
      [
        {
          body: 'Inline comment body.',
          commit_id: 'abc123456789',
          line: 42,
          path: 'tools/prd-orchestrator/src/default-live-adapters.ts',
          user: {
            login: 'coderabbitai',
          },
        },
      ],
    ])
  }

  if (formattedCommand === 'git rev-parse HEAD') {
    return 'amended123456789\n'
  }

  return ''
}

const formatCommand = (command: DefaultLiveAdapterShellCommandInput): string =>
  `${command.command} ${command.args
    .map((argument) =>
      argument.startsWith('/var/') || argument.startsWith('/tmp/') ? '<tmp>' : argument,
    )
    .join(' ')}`
