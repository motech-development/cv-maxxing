import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { codex, run } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'

import {
  buildPencilWorkflowRequirementSection,
  createSandcastleImpactAnalysisRunOptions,
  defaultCodexModel,
  parseImpactAnalysisResult,
  type DockerCacheMount,
  type SandcastleImpactAnalysisResult,
} from './sandcastle-impact-analysis.js'
import {
  createProhibitedCapabilityScanResults,
  interpretGitHubActionsStatus,
  validateAutomationPrOwnership,
  type ChildCommitReference,
  type GitHubActionsRun,
  type GitHubActionsStatus,
  type ProhibitedCapabilityId,
  type ProhibitedCapabilityMatch,
  type ResumePrFinding,
} from './final-prd-flow.js'
import {
  createCleanupPlanFromArtifacts,
  type ApplyWorkerDiffInput,
  type AutomationPrDetails,
  type ChildCommitResult,
  type CheckoutChildCommitInput,
  type CiFailureEvidence,
  type CreateDraftPrInput,
  type LivePreflightResult,
  type LiveRunLockResult,
  type PreparePrdBranchInput,
  type PrdOrchestratorLiveConfiguration,
  type PrdOrchestratorLiveAdapters,
  type PushPrdBranchInput,
  type PollChecksInput,
  type RepairResumeFindingsInput,
  type RepairVerificationFailureInput,
  type RestorePrdBranchToCleanStateInput,
  type ReviewChildInput,
  type ReviewChildResult,
  type RunImpactAnalysisInput,
  type RunImplementationInput,
  type RunImplementationResult,
  type ScanProhibitedCapabilitiesInput,
  type UpsertPrCommentInput,
} from './live-orchestrator.js'
import type {
  CleanupArtifact,
  CleanupPlan,
  RemoteAutomationPr,
  RemoteAutomationPrOwnership,
  RunStatus,
} from './run-guardrails.js'
import { createRepoRunLockPath, evaluatePreflight } from './run-guardrails.js'
import type { GitHubIssue, ParsedChildTask } from './planning.js'
import type { CodeRabbitFinding } from './coderabbit-review.js'

export interface DefaultLiveAdapterShellCommandInput {
  readonly args: readonly string[]
  readonly command: string
  readonly cwd?: string
  readonly stdin?: string
  readonly timeoutMs?: number | 'none'
}

export interface DefaultLiveAdapterShellCommandResult {
  readonly stderr: string
  readonly stdout: string
}

interface OpenPullRequestSummary {
  readonly body: string
  readonly branchName: string
  readonly isDraft: boolean
  readonly prNumber: number
  readonly url: string
}

export type DefaultLiveAdapterShellRunner = (
  input: DefaultLiveAdapterShellCommandInput,
) => Promise<DefaultLiveAdapterShellCommandResult>

export type RepositoryRootCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly encoding: 'utf8'
    readonly stdio: ['ignore', 'pipe', 'ignore']
  },
) => string

const defaultTimeoutMs = 10 * 60 * 1000
const codexCliCredentialFiles = ['.codex/auth.json', '.codex/config.toml'] as const
const githubCliTransientRetryDelaysMs = [1000, 3000] as const
const runStateRoot = '.git/prd-orchestrator/runs'
const statusFileName = 'status.json'
const lockFileName = 'lock.json'

export const createDefaultPrdOrchestratorLiveAdapters = (
  cwd = process.cwd(),
  configuration?: PrdOrchestratorLiveConfiguration,
  shellRunner?: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters => {
  const repoRoot = resolveRepositoryRoot(cwd)
  const shell = shellRunner ?? createShellRunner(repoRoot)
  const resolvedConfiguration = configuration ?? createEnvironmentConfiguration()

  return {
    ci: createCiAdapter(shell),
    codeRabbit: createCodeRabbitAdapter(shell),
    configuration: resolvedConfiguration,
    git: createGitAdapter(shell),
    github: createGitHubAdapter(shell),
    sandcastle: createSandcastleAdapter(repoRoot, shell, resolvedConfiguration),
    state: createRunStateAdapter(repoRoot, shell),
    verification: createVerificationAdapter(shell),
  }
}

export const resolveRepositoryRoot = (
  cwd: string,
  commandRunner: RepositoryRootCommandRunner = runRepositoryRootCommand,
): string => {
  try {
    const root = commandRunner('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    return root.length === 0 ? cwd : root
  } catch {
    return cwd
  }
}

const runRepositoryRootCommand: RepositoryRootCommandRunner = (command, args, options) =>
  execFileSync(command, [...args], options)

const createEnvironmentConfiguration = (): PrdOrchestratorLiveConfiguration => ({
  ciPollingIntervalMs: parseOptionalPositiveInteger(
    process.env.CV_MAXXING_PRD_ORCHESTRATOR_CI_POLLING_INTERVAL_MS,
  ),
  ciPollingTimeoutMs: parseOptionalPositiveInteger(
    process.env.CV_MAXXING_PRD_ORCHESTRATOR_CI_POLLING_TIMEOUT_MS,
  ),
  codexEffort: process.env.CV_MAXXING_PRD_ORCHESTRATOR_CODEX_EFFORT,
  codexModel: process.env.CV_MAXXING_PRD_ORCHESTRATOR_CODEX_MODEL,
})

const createShellRunner =
  (defaultCwd: string) =>
  async (
    input: DefaultLiveAdapterShellCommandInput,
  ): Promise<DefaultLiveAdapterShellCommandResult> => {
    return await new Promise((resolve, reject) => {
      const child = spawn(input.command, input.args, {
        cwd: input.cwd ?? defaultCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const timeout =
        input.timeoutMs === 'none'
          ? undefined
          : setTimeout(() => {
              child.kill('SIGTERM')
              reject(new Error(`Command timed out: ${input.command} ${input.args.join(' ')}`))
            }, input.timeoutMs ?? defaultTimeoutMs)
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })
      child.on('error', (error) => {
        clearCommandTimeout(timeout)
        reject(error)
      })
      child.on('close', (exitCode) => {
        clearCommandTimeout(timeout)

        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderr = Buffer.concat(stderrChunks).toString('utf8')

        if (exitCode !== 0) {
          reject(
            new Error(
              `Command failed (${String(exitCode)}): ${input.command} ${input.args.join(
                ' ',
              )}\n${stderr}`,
            ),
          )

          return
        }

        resolve({
          stderr,
          stdout,
        })
      })

      if (input.stdin !== undefined) {
        child.stdin.end(input.stdin)

        return
      }

      child.stdin.end()
    })
  }

const clearCommandTimeout = (timeout: ReturnType<typeof setTimeout> | undefined): void => {
  if (timeout !== undefined) {
    clearTimeout(timeout)
  }
}

const createGitHubAdapter = (
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['github'] => ({
  createDraftPr: async (input: CreateDraftPrInput): Promise<RemoteAutomationPr> => {
    const pr = await withTemporaryFile('prd-pr-body-', input.body, async (bodyFilePath) => {
      await shell({
        args: [
          'pr',
          'create',
          '--draft',
          '--base',
          'main',
          '--head',
          input.branchName,
          '--title',
          input.title,
          '--body-file',
          bodyFilePath,
        ],
        command: 'gh',
      })

      return await viewPullRequestByHead(shell, input.branchName)
    })

    return {
      branchName: pr.branchName,
      isDraft: pr.isDraft,
      prNumber: pr.prNumber,
      prdIssueNumber: input.prdIssueNumber,
      url: pr.url,
    }
  },
  convertPrToDraft: async (prNumber: number): Promise<void> => {
    await shell({
      args: ['pr', 'ready', String(prNumber), '--undo'],
      command: 'gh',
    })
  },
  findAutomationPr: async (
    prdIssueNumber: number,
    branchName: string,
  ): Promise<RemoteAutomationPr | undefined> => {
    const result = await shell({
      args: [
        'pr',
        'list',
        '--state',
        'open',
        '--head',
        branchName,
        '--json',
        'number,url,headRefName,body,isDraft',
        '--limit',
        '1',
      ],
      command: 'gh',
    })
    const pullRequests = parseJsonArray(result.stdout)
    const pullRequest = pullRequests.at(0)

    if (pullRequest === undefined || !isRecord(pullRequest)) {
      return undefined
    }

    return {
      branchName: parseStringField(pullRequest, 'headRefName'),
      isDraft: parseBooleanField(pullRequest, 'isDraft'),
      prNumber: parseNumberField(pullRequest, 'number'),
      prdIssueNumber,
      url: parseStringField(pullRequest, 'url'),
    }
  },
  getOpenAutomationPrOwnership: async (): Promise<RemoteAutomationPrOwnership> => {
    const result = await shell({
      args: [
        'pr',
        'list',
        '--state',
        'open',
        '--json',
        'number,url,headRefName,body,isDraft',
        '--limit',
        '100',
      ],
      command: 'gh',
    })

    return parseRemoteAutomationPrOwnership(parseJsonArray(result.stdout))
  },
  getPr: async (prNumber: number): Promise<AutomationPrDetails> => {
    const result = await shell({
      args: ['pr', 'view', String(prNumber), '--json', 'number,url,headRefName,body,isDraft'],
      command: 'gh',
    })
    const pullRequest = parseJsonRecord(result.stdout)

    return {
      body: parseStringField(pullRequest, 'body'),
      branchName: parseStringField(pullRequest, 'headRefName'),
      isDraft: parseBooleanField(pullRequest, 'isDraft'),
      prNumber: parseNumberField(pullRequest, 'number'),
      url: parseStringField(pullRequest, 'url'),
    }
  },
  getReviewFindings: async (prNumber: number): Promise<readonly ResumePrFinding[]> => {
    return await getCodeRabbitPrFindings(shell, prNumber)
  },
  getCurrentPr: async (): Promise<AutomationPrDetails | undefined> => {
    try {
      const result = await shell({
        args: ['pr', 'view', '--json', 'number,url,headRefName,body,isDraft'],
        command: 'gh',
      })
      const pullRequest = parseJsonRecord(result.stdout)

      return {
        body: parseStringField(pullRequest, 'body'),
        branchName: parseStringField(pullRequest, 'headRefName'),
        isDraft: parseBooleanField(pullRequest, 'isDraft'),
        prNumber: parseNumberField(pullRequest, 'number'),
        url: parseStringField(pullRequest, 'url'),
      }
    } catch {
      return undefined
    }
  },
  listOpenIssues: async (): Promise<readonly GitHubIssue[]> => {
    const result = await shell({
      args: [
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        '200',
        '--json',
        'number,title,body,state',
      ],
      command: 'gh',
    })

    return parseJsonArray(result.stdout).map((issue) => parseGitHubIssue(issue))
  },
  markReadyForReview: async (prNumber: number): Promise<void> => {
    await shell({
      args: ['pr', 'ready', String(prNumber)],
      command: 'gh',
    })
  },
  postPrComment: async (prNumber: number, body: string): Promise<void> => {
    await withTemporaryFile('prd-pr-comment-', body, async (bodyFilePath) => {
      await runGitHubCliCommandWithTransientRetry(shell, {
        args: ['pr', 'comment', String(prNumber), '--body-file', bodyFilePath],
        command: 'gh',
      })
    })
  },
  updatePrBody: async (prNumber: number, body: string): Promise<void> => {
    await withTemporaryFile('prd-pr-body-', body, async (bodyFilePath) => {
      await runGitHubCliCommandWithTransientRetry(shell, {
        args: ['pr', 'edit', String(prNumber), '--body-file', bodyFilePath],
        command: 'gh',
      })
    })
  },
  upsertPrComment: async (input: UpsertPrCommentInput): Promise<void> => {
    const commentId = await findIssueCommentIdByMarker(shell, input.prNumber, input.marker)

    if (commentId === undefined) {
      await withTemporaryFile('prd-pr-comment-', input.body, async (bodyFilePath) => {
        await runGitHubCliCommandWithTransientRetry(shell, {
          args: ['pr', 'comment', String(input.prNumber), '--body-file', bodyFilePath],
          command: 'gh',
        })
      })

      return
    }

    await withTemporaryJsonFile(
      'prd-pr-comment-update-',
      {
        body: input.body,
      },
      async (bodyFilePath) => {
        await runGitHubCliCommandWithTransientRetry(shell, {
          args: [
            'api',
            `repos/{owner}/{repo}/issues/comments/${String(commentId)}`,
            '--method',
            'PATCH',
            '--input',
            bodyFilePath,
          ],
          command: 'gh',
        })
      },
    )
  },
})

const runGitHubCliCommandWithTransientRetry = async (
  shell: DefaultLiveAdapterShellRunner,
  input: DefaultLiveAdapterShellCommandInput,
): Promise<DefaultLiveAdapterShellCommandResult> => {
  for (const delayMs of [0, ...githubCliTransientRetryDelaysMs]) {
    if (delayMs > 0) {
      await sleep(delayMs)
    }

    try {
      return await shell(input)
    } catch (error) {
      if (!isTransientGitHubCliError(error) || delayMs === githubCliTransientRetryDelaysMs.at(-1)) {
        throw error
      }
    }
  }

  return await shell(input)
}

const isTransientGitHubCliError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)

  return /error connecting to api\.github\.com|check your internet connection|HTTP 5\d\d|EOF/i.test(
    message,
  )
}

const createGitAdapter = (
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['git'] => {
  let pendingChildCommitTarget: CheckoutChildCommitInput | undefined

  return {
    applyWorkerDiff: async (input: ApplyWorkerDiffInput): Promise<void> => {
      if (pendingChildCommitTarget === undefined) {
        if (input.workerWorktreePath !== undefined) {
          await detachPreservedWorkerWorktreeIfOnBranch(shell, {
            branchName: input.prdBranchName,
            workerWorktreePath: input.workerWorktreePath,
          })
        }

        await shell({
          args: ['checkout', input.prdBranchName],
          command: 'git',
        })
      } else if (pendingChildCommitTarget.branchName !== input.prdBranchName) {
        throw new Error(
          `Resume repair target branch ${pendingChildCommitTarget.branchName} does not match diff branch ${input.prdBranchName}.`,
        )
      }

      if (input.workerWorktreePath !== undefined) {
        await applyPreservedWorkerWorktreeDiff(shell, input.workerWorktreePath)

        return
      }

      await shell({
        args: ['merge', '--squash', '--no-commit', input.workerBranchName],
        command: 'git',
      })
    },
    amendChildCommit: async (message: string): Promise<ChildCommitResult> => {
      const childCommitTarget = pendingChildCommitTarget

      await shell({
        args: ['add', '--all'],
        command: 'git',
      })
      await withTemporaryFile('prd-child-amend-', message, async (messageFilePath) => {
        await shell({
          args: ['commit', '--amend', '-F', messageFilePath],
          command: 'git',
        })
      })

      const result = await shell({
        args: ['rev-parse', 'HEAD'],
        command: 'git',
      })
      const amendedCommitHash = result.stdout.trim()

      if (childCommitTarget !== undefined) {
        await shell({
          args: [
            'rebase',
            '--onto',
            amendedCommitHash,
            childCommitTarget.commitHash,
            childCommitTarget.branchName,
          ],
          command: 'git',
        })
        await shell({
          args: ['checkout', childCommitTarget.branchName],
          command: 'git',
        })
        pendingChildCommitTarget = undefined
      }

      return {
        hash: amendedCommitHash,
      }
    },
    checkoutChildCommit: async (input: CheckoutChildCommitInput): Promise<void> => {
      await shell({
        args: ['checkout', input.branchName],
        command: 'git',
      })
      await shell({
        args: ['cat-file', '-e', `${input.commitHash}^{commit}`],
        command: 'git',
      })
      await shell({
        args: ['merge-base', '--is-ancestor', input.commitHash, input.branchName],
        command: 'git',
      })
      await shell({
        args: ['checkout', input.commitHash],
        command: 'git',
      })
      pendingChildCommitTarget = input
    },
    commitChild: async (message: string): Promise<ChildCommitResult> => {
      await shell({
        args: ['add', '--all'],
        command: 'git',
      })
      await withTemporaryFile('prd-child-commit-', message, async (messageFilePath) => {
        await shell({
          args: ['commit', '-F', messageFilePath],
          command: 'git',
        })
      })

      const result = await shell({
        args: ['rev-parse', 'HEAD'],
        command: 'git',
      })

      return {
        hash: result.stdout.trim(),
      }
    },
    commitFinalCleanup: async (message: string): Promise<ChildCommitResult> => {
      await shell({
        args: ['add', '--all'],
        command: 'git',
      })
      await withTemporaryFile('prd-final-cleanup-', message, async (messageFilePath) => {
        await shell({
          args: ['commit', '-F', messageFilePath],
          command: 'git',
        })
      })

      const result = await shell({
        args: ['rev-parse', 'HEAD'],
        command: 'git',
      })

      return {
        hash: result.stdout.trim(),
      }
    },
    getChildCommitReferences: async (
      branchName: string,
    ): Promise<readonly ChildCommitReference[]> => {
      try {
        const result = await shell({
          args: ['log', '--format=%H%x00%B%x00%x00', `main..${branchName}`],
          command: 'git',
        })

        const references = parseChildCommitReferences(result.stdout)

        return await Promise.all(
          references.map(async (reference) => ({
            ...reference,
            changedFiles: await getCommitChangedFiles(shell, reference.commitHash),
          })),
        )
      } catch {
        return []
      }
    },
    getCompletedChildIssueNumbers: async (branchName: string): Promise<readonly number[]> => {
      try {
        const result = await shell({
          args: ['log', '--format=%H%n%B', `main..${branchName}`],
          command: 'git',
        })

        return parseClosedIssueNumbers(result.stdout)
      } catch {
        return []
      }
    },
    getMainBranchStatus: async () => {
      const [statusResult, branchResult] = await Promise.all([
        shell({
          args: ['status', '--porcelain'],
          command: 'git',
        }),
        shell({
          args: ['branch', '--show-current'],
          command: 'git',
        }),
      ])

      await shell({
        args: ['fetch', 'origin', 'main'],
        command: 'git',
      })

      const [mainResult, originMainResult] = await Promise.all([
        shell({
          args: ['rev-parse', 'main'],
          command: 'git',
        }),
        shell({
          args: ['rev-parse', 'origin/main'],
          command: 'git',
        }),
      ])

      return {
        clean: statusResult.stdout.trim().length === 0,
        currentBranch: branchResult.stdout.trim(),
        upToDate: mainResult.stdout.trim() === originMainResult.stdout.trim(),
      }
    },
    preparePrdBranch: async (input: PreparePrdBranchInput): Promise<void> => {
      await shell({
        args: ['checkout', 'main'],
        command: 'git',
      })
      await shell({
        args: ['pull', '--ff-only', 'origin', 'main'],
        command: 'git',
      })

      if (input.remoteAutomationPr === undefined) {
        await shell({
          args: ['checkout', '-B', input.branchName, 'main'],
          command: 'git',
        })
        await shell({
          args: ['push', '--set-upstream', 'origin', input.branchName],
          command: 'git',
        })

        return
      }

      await shell({
        args: ['fetch', 'origin', input.branchName],
        command: 'git',
      })
      await shell({
        args: ['checkout', input.branchName],
        command: 'git',
      })
      await shell({
        args: ['pull', '--ff-only', 'origin', input.branchName],
        command: 'git',
      })
    },
    pushPrdBranch: async (input: PushPrdBranchInput): Promise<void> => {
      await shell({
        args: ['push', '--force-with-lease', 'origin', input.branchName],
        command: 'git',
      })
    },
    restorePrdBranchToCleanState: async (
      input: RestorePrdBranchToCleanStateInput,
    ): Promise<void> => {
      await shell({
        args: ['checkout', input.branchName],
        command: 'git',
      })
      await shell({
        args: ['reset', '--hard', 'HEAD'],
        command: 'git',
      })
      await shell({
        args: ['clean', '-fd'],
        command: 'git',
      })
      const status = await shell({
        args: ['status', '--porcelain'],
        command: 'git',
      })

      if (status.stdout.trim().length > 0) {
        throw new Error(
          `PRD branch ${input.branchName} remained dirty after restore:\n${status.stdout}`,
        )
      }
    },
  }
}

const createSandcastleAdapter = (
  cwd: string,
  shell: DefaultLiveAdapterShellRunner,
  configuration: PrdOrchestratorLiveConfiguration,
): PrdOrchestratorLiveAdapters['sandcastle'] => ({
  repairReviewFindings: async (
    input: RunImplementationInput & {
      readonly findings: readonly CodeRabbitFinding[]
    },
  ): Promise<RunImplementationResult> => {
    const prompt = [
      await buildImplementationPrompt(cwd, input),
      '',
      '## CodeRabbit Findings To Repair',
      '',
      ...input.findings.map((finding) => `- ${finding.id}: ${finding.title}\n${finding.body}`),
    ].join('\n')
    const result = await run({
      agent: codex(configuration.codexModel ?? defaultCodexModel, {
        effort: parseCodexEffort(configuration.codexEffort),
        env: {},
      }),
      branchStrategy: createSandcastleWorkerBranchStrategy({
        baseBranch: input.prdBranchName,
        workerBranchName: input.workerBranchName,
      }),
      cwd,
      maxIterations: 1,
      prompt,
      sandbox: docker({
        env: {},
        mounts: await resolveCodexCliCredentialMounts(),
      }),
    })
    const changedFiles = await getWorkerChangedFiles(shell, {
      baseRef: input.prdBranchName,
      workerBranchName: result.branch,
      workerWorktreePath: result.preservedWorktreePath,
    })

    return {
      changedFiles,
      stdout: result.stdout,
      workerBranchName: result.branch,
      workerWorktreePath: result.preservedWorktreePath,
    }
  },
  repairResumeFindings: async (
    input: RepairResumeFindingsInput,
  ): Promise<RunImplementationResult> => {
    const prompt = [
      'Repair findings discovered while resuming an automation-owned PR.',
      '',
      `PR: #${String(input.prNumber)}`,
      `Branch: ${input.branchName}`,
      ...(input.targetCommitHash === undefined
        ? []
        : [`Target child commit: ${input.targetCommitHash}`]),
      '',
      '## Findings',
      '',
      ...input.findings.map((finding) => `- ${finding.id}: ${finding.title}\n${finding.body}`),
    ].join('\n')
    const result = await run({
      agent: codex(configuration.codexModel ?? defaultCodexModel, {
        effort: parseCodexEffort(configuration.codexEffort),
        env: {},
      }),
      branchStrategy: createSandcastleWorkerBranchStrategy({
        baseBranch: input.targetCommitHash ?? input.branchName,
        workerBranchName: input.workerBranchName,
      }),
      cwd,
      maxIterations: 1,
      prompt,
      sandbox: docker({
        env: {},
        mounts: await resolveCodexCliCredentialMounts(),
      }),
    })
    const changedFiles = await getWorkerChangedFiles(shell, {
      baseRef: input.targetCommitHash ?? input.branchName,
      workerBranchName: result.branch,
      workerWorktreePath: result.preservedWorktreePath,
    })

    return {
      changedFiles,
      stdout: result.stdout,
      workerBranchName: result.branch,
      workerWorktreePath: result.preservedWorktreePath,
    }
  },
  repairVerificationFailure: async (
    input: RepairVerificationFailureInput,
  ): Promise<RunImplementationResult> => {
    const prompt = [
      await buildImplementationPrompt(cwd, input),
      '',
      '## Verification Failure To Repair',
      '',
      input.errorMessage,
    ].join('\n')
    const result = await run({
      agent: codex(configuration.codexModel ?? defaultCodexModel, {
        effort: parseCodexEffort(configuration.codexEffort),
        env: {},
      }),
      branchStrategy: createSandcastleWorkerBranchStrategy({
        baseBranch: input.prdBranchName,
        workerBranchName: input.workerBranchName,
      }),
      cwd,
      maxIterations: 1,
      prompt,
      sandbox: docker({
        env: {},
        mounts: await resolveCodexCliCredentialMounts(),
      }),
    })
    const changedFiles = await getWorkerChangedFiles(shell, {
      baseRef: input.prdBranchName,
      workerBranchName: result.branch,
      workerWorktreePath: result.preservedWorktreePath,
    })

    return {
      changedFiles,
      stdout: result.stdout,
      workerBranchName: result.branch,
      workerWorktreePath: result.preservedWorktreePath,
    }
  },
  runImpactAnalysis: async (
    input: RunImpactAnalysisInput,
  ): Promise<SandcastleImpactAnalysisResult> => {
    const promptInputs = await loadPromptInputs(cwd)
    const pnpmStorePath = await resolvePnpmStorePath(shell)
    const codexCliCredentialMounts = await resolveCodexCliCredentialMounts()
    const result = await run({
      ...createSandcastleImpactAnalysisRunOptions({
        architectureDesignConstraints: promptInputs.architecture,
        assignedChildTaskBody: formatChildTaskForPrompt(input.childTask),
        cacheInputs: {
          cachePath: pnpmStorePath,
          packageManager: 'pnpm',
        },
        childIssueNumber: input.childTask.issueNumber,
        codexCliCredentialMounts,
        cliOverrides: {
          effort: configuration.codexEffort,
          model: configuration.codexModel,
        },
        env: process.env,
        parentPrdBody: input.parentPrdBody,
        prdIssueNumber: input.parentPrd.issueNumber,
        repoInstructions: promptInputs.instructions,
        sandboxBranchName: `${createWorkerBranchName(input)}-impact`,
        siblingSummaries: input.siblingSummaries,
        writeSurfaceReanalysis: input.writeSurfaceReanalysis,
      }),
      cwd,
    })

    return parseImpactAnalysisResult(result.stdout)
  },
  runImplementation: async (input: RunImplementationInput): Promise<RunImplementationResult> => {
    const prompt = await buildImplementationPrompt(cwd, input)
    const result = await run({
      agent: codex(configuration.codexModel ?? defaultCodexModel, {
        effort: parseCodexEffort(configuration.codexEffort),
        env: {},
      }),
      branchStrategy: createSandcastleWorkerBranchStrategy({
        baseBranch: input.prdBranchName,
        workerBranchName: input.workerBranchName,
      }),
      cwd,
      maxIterations: 1,
      prompt,
      sandbox: docker({
        env: {},
        mounts: await resolveCodexCliCredentialMounts(),
      }),
    })
    const changedFiles = await getWorkerChangedFiles(shell, {
      baseRef: input.prdBranchName,
      workerBranchName: result.branch,
      workerWorktreePath: result.preservedWorktreePath,
    })

    return {
      changedFiles,
      stdout: result.stdout,
      workerBranchName: result.branch,
      workerWorktreePath: result.preservedWorktreePath,
    }
  },
})

const detachPreservedWorkerWorktreeIfOnBranch = async (
  shell: DefaultLiveAdapterShellRunner,
  input: {
    readonly branchName: string
    readonly workerWorktreePath: string
  },
): Promise<void> => {
  const currentBranch = await shell({
    args: ['-C', input.workerWorktreePath, 'branch', '--show-current'],
    command: 'git',
  })

  if (currentBranch.stdout.trim() !== input.branchName) {
    return
  }

  await shell({
    args: ['-C', input.workerWorktreePath, 'switch', '--detach'],
    command: 'git',
  })
}

const applyPreservedWorkerWorktreeDiff = async (
  shell: DefaultLiveAdapterShellRunner,
  workerWorktreePath: string,
): Promise<void> => {
  await shell({
    args: ['-C', workerWorktreePath, 'add', '--all'],
    command: 'git',
  })
  const patch = await shell({
    args: ['-C', workerWorktreePath, 'diff', '--cached', '--binary', 'HEAD'],
    command: 'git',
  })

  if (patch.stdout.length === 0) {
    return
  }

  await shell({
    args: ['apply', '--index', '-'],
    command: 'git',
    stdin: patch.stdout,
  })
}

const getWorkerChangedFiles = async (
  shell: DefaultLiveAdapterShellRunner,
  input: {
    readonly baseRef: string
    readonly workerBranchName: string
    readonly workerWorktreePath?: string
  },
): Promise<readonly string[]> => {
  if (input.workerWorktreePath === undefined) {
    const changedFiles = await shell({
      args: ['diff', '--name-only', `${input.baseRef}..${input.workerBranchName}`],
      command: 'git',
    })

    return parseChangedFiles(changedFiles.stdout)
  }

  const [trackedChanges, untrackedChanges] = await Promise.all([
    shell({
      args: ['-C', input.workerWorktreePath, 'diff', '--name-only', 'HEAD'],
      command: 'git',
    }),
    shell({
      args: ['-C', input.workerWorktreePath, 'ls-files', '--others', '--exclude-standard'],
      command: 'git',
    }),
  ])

  return [
    ...new Set([
      ...parseChangedFiles(trackedChanges.stdout),
      ...parseChangedFiles(untrackedChanges.stdout),
    ]),
  ]
}

export const resolvePnpmStorePath = async (
  shell: DefaultLiveAdapterShellRunner,
): Promise<string | undefined> => {
  try {
    const result = await shell({
      args: ['store', 'path'],
      command: 'pnpm',
      timeoutMs: 60 * 1000,
    })
    const storePath = result.stdout.trim()

    return storePath.length === 0 ? undefined : storePath
  } catch {
    return undefined
  }
}

export const createCodexCliCredentialMounts = (
  homeDirectory: string,
  existingCredentialFiles: readonly string[],
): readonly DockerCacheMount[] =>
  codexCliCredentialFiles
    .filter((credentialFile) => existingCredentialFiles.includes(credentialFile))
    .map((credentialFile) => ({
      hostPath: path.join(homeDirectory, credentialFile),
      readonly: true,
      sandboxPath: `/home/agent/${credentialFile}`,
    }))

export const createSandcastleWorkerBranchStrategy = (input: {
  readonly baseBranch?: string
  readonly workerBranchName: string
}): {
  readonly baseBranch?: string
  readonly branch: string
  readonly type: 'branch'
} => ({
  ...(input.baseBranch === undefined ? {} : { baseBranch: input.baseBranch }),
  branch: input.workerBranchName,
  type: 'branch',
})

const resolveCodexCliCredentialMounts = async (
  homeDirectory = homedir(),
): Promise<readonly DockerCacheMount[]> => {
  const existingCredentialFiles = await Promise.all(
    codexCliCredentialFiles.map(async (credentialFile) => {
      try {
        const credentialStat = await stat(path.join(homeDirectory, credentialFile))

        return credentialStat.isFile() ? credentialFile : null
      } catch {
        return null
      }
    }),
  )

  return createCodexCliCredentialMounts(
    homeDirectory,
    existingCredentialFiles.filter(
      (file): file is (typeof codexCliCredentialFiles)[number] => file !== null,
    ),
  )
}

export const resolveHostShell = (env: Record<string, string | undefined> = process.env): string => {
  const shell = env.SHELL?.trim()

  return shell === undefined || shell.length === 0 ? 'sh' : shell
}

export const createDefaultSandcastleDockerImageName = (repoRoot: string): string => {
  const directoryName =
    repoRoot
      .replaceAll(/[\\/]+$/g, '')
      .split(/[\\/]/)
      .at(-1) ?? 'local'
  const sanitizedName = directoryName.toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '-')

  return `sandcastle:${sanitizedName.length === 0 ? 'local' : sanitizedName}`
}

const createVerificationAdapter = (
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['verification'] => ({
  runCommands: async (commands: readonly string[]): Promise<readonly string[]> => {
    const evidence: string[] = []

    for (const command of commands) {
      await shell({
        args: ['-lc', command],
        command: resolveHostShell(),
        timeoutMs: 30 * 60 * 1000,
      })
      evidence.push(command)
    }

    return evidence
  },
  scanProhibitedCapabilities: async (input: ScanProhibitedCapabilitiesInput) => {
    const matches = await findProhibitedCapabilityMatches(shell, input)

    return createProhibitedCapabilityScanResults({
      matches,
      scannedFiles: input.changedFiles,
    })
  },
})

const createCodeRabbitAdapter = (
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['codeRabbit'] => ({
  reviewChild: async (input: ReviewChildInput): Promise<ReviewChildResult> => {
    if (input.prNumber <= 0) {
      throw new Error('CodeRabbit review requires a positive PR number.')
    }

    await shell({
      args: ['review', '--agent'],
      command: 'coderabbit',
      timeoutMs: 'none',
    })
    const findings = await getCodeRabbitPrFindings(shell, input.prNumber)

    return {
      findings,
      status: findings.length === 0 ? 'passed' : 'findings',
    }
  },
})

const getCodeRabbitPrFindings = async (
  shell: DefaultLiveAdapterShellRunner,
  prNumber: number,
): Promise<readonly CodeRabbitFinding[]> => {
  const pullRequest = await shell({
    args: ['pr', 'view', String(prNumber), '--json', 'reviews,comments,statusCheckRollup'],
    command: 'gh',
  })
  const reviewComments = await getInlineReviewComments(shell, prNumber)

  return parseCodeRabbitFindings(pullRequest.stdout, reviewComments.stdout)
}

const getInlineReviewComments = async (
  shell: DefaultLiveAdapterShellRunner,
  prNumber: number,
): Promise<DefaultLiveAdapterShellCommandResult> => {
  try {
    return await shell({
      args: [
        'api',
        `repos/{owner}/{repo}/pulls/${String(prNumber)}/comments`,
        '--paginate',
        '--slurp',
      ],
      command: 'gh',
    })
  } catch {
    return {
      stderr: '',
      stdout: '[]',
    }
  }
}

const createCiAdapter = (
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['ci'] => ({
  getFailureEvidence: async (input: PollChecksInput): Promise<readonly CiFailureEvidence[]> => {
    const prResult = await shell({
      args: ['pr', 'view', String(input.prNumber), '--json', 'statusCheckRollup'],
      command: 'gh',
      timeoutMs: 30 * 60 * 1000,
    })
    const failedChecks = parseFailedGitHubActionsChecks(prResult.stdout)

    return await Promise.all(
      failedChecks.map(async (check) => {
        const runId = parseGitHubActionsRunId(check.detailsUrl)
        const logExcerpt = await loadCiFailureLogExcerpt({
          checkName: check.name,
          detailsUrl: check.detailsUrl,
          runId,
          shell,
        })

        return {
          detailsUrl: check.detailsUrl,
          logExcerpt,
          name: check.name,
          workflowName: check.workflowName,
        }
      }),
    )
  },
  pollChecks: async (input: PollChecksInput): Promise<GitHubActionsStatus> => {
    const result = await shell({
      args: ['pr', 'view', String(input.prNumber), '--json', 'statusCheckRollup'],
      command: 'gh',
      timeoutMs: 30 * 60 * 1000,
    })

    return interpretGitHubActionsStatus({
      runs: parseGitHubActionsCheckRuns(result.stdout),
    })
  },
})

const createRunStateAdapter = (
  cwd: string,
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['state'] => {
  let activeRunId = createRunId()

  const activeRunDirectory = (): string => path.join(cwd, runStateRoot, activeRunId)

  return {
    acquireRunLock: async (): Promise<LiveRunLockResult> => {
      const runDirectory = activeRunDirectory()
      const lockFilePath = path.join(cwd, createRepoRunLockPath())

      await mkdir(runDirectory, {
        recursive: true,
      })
      await mkdir(path.dirname(lockFilePath), {
        recursive: true,
      })

      try {
        await writeRunLockFile(lockFilePath, activeRunId)

        return {
          blockers: [],
          lockId: activeRunId,
          ready: true,
        }
      } catch {
        if (await recoverStaleRepoLock(lockFilePath)) {
          return await acquireRecoveredRunLock(lockFilePath, activeRunId)
        }

        return {
          blockers: ['Another PRD orchestrator run is already active.'],
          lockId: undefined,
          ready: false,
        }
      }
    },
    cleanup: async (): Promise<CleanupPlan> => {
      const nowEpochMs = Date.now()
      const artifacts = await discoverCleanupArtifacts(cwd, shell)
      const activeRunIds = await discoverActiveRunIds(cwd)
      const plan = createCleanupPlanFromArtifacts({
        activeRunIds,
        artifacts,
        liveProcessIds: getCurrentProcessIds(),
        nowEpochMs,
        retentionDays: 7,
      })

      await Promise.all(
        plan.remove.map((artifactPath) => removeCleanupArtifact(cwd, shell, artifactPath)),
      )

      return plan
    },
    readRunStatus: async (): Promise<RunStatus> => {
      try {
        const runDirectory = await findLatestRunDirectory(cwd)
        const content = await readFile(path.join(runDirectory, statusFileName), 'utf8')

        return parseRunStatus(JSON.parse(content))
      } catch {
        return {
          activePrdIssueNumber: undefined,
          blockers: [],
          branchName: undefined,
          ciStatus: undefined,
          codeRabbitStatus: undefined,
          completedChildren: [],
          currentChildIssueNumber: undefined,
          heartbeatIso: undefined,
          lastCommand: undefined,
          phase: 'idle',
          prNumber: undefined,
          prUrl: undefined,
        }
      }
    },
    readArtifactStatus: async () => {
      const artifacts = await discoverCleanupArtifacts(cwd, shell)
      const activeRunIds = await discoverActiveRunIds(cwd)
      const activeWorktrees = artifacts.filter(
        (artifact) =>
          artifact.category === 'sandbox-branch' &&
          artifact.path.startsWith('.sandcastle/worktrees/') &&
          artifact.runId !== undefined &&
          activeRunIds.includes(artifact.runId),
      ).length
      const activeContainers = artifacts.filter(
        (artifact) =>
          artifact.category === 'container' && artifact.lastModifiedEpochMs > Date.now() - 1000,
      ).length
      const staleArtifacts = createCleanupPlanFromArtifacts({
        activeRunIds,
        artifacts,
        liveProcessIds: getCurrentProcessIds(),
        nowEpochMs: Date.now(),
        retentionDays: 7,
      }).remove.length

      return {
        cleanupStatus:
          staleArtifacts === 0
            ? 'no stale artifacts eligible for cleanup'
            : `${String(staleArtifacts)} stale artifacts eligible for cleanup`,
        lockStatus:
          activeRunIds.length === 0
            ? 'no active lock'
            : `active run locks: ${activeRunIds.join(', ')}`,
        sandcastleStatus: `${String(activeWorktrees)} active worktrees, ${String(
          activeContainers,
        )} active containers`,
      }
    },
    recoverRunStatusFromPr: async (pr: AutomationPrDetails): Promise<void> => {
      activeRunId = createRunId()
      await mkdir(activeRunDirectory(), {
        recursive: true,
      })
      await writeFile(
        path.join(activeRunDirectory(), statusFileName),
        JSON.stringify(
          {
            activePrdIssueNumber: undefined,
            blockers: [],
            branchName: pr.branchName,
            ciStatus: undefined,
            codeRabbitStatus: undefined,
            completedChildren: [],
            currentChildIssueNumber: undefined,
            heartbeatIso: new Date().toISOString(),
            lastCommand: 'resume-pr',
            phase: 'resuming',
            prNumber: pr.prNumber,
            prUrl: pr.url,
          } satisfies RunStatus,
          null,
          2,
        ),
        'utf8',
      )
    },
    recordRunStatus: async (statusValue: RunStatus): Promise<void> => {
      const runDirectory = activeRunDirectory()

      await mkdir(runDirectory, {
        recursive: true,
      })
      await writeFile(
        path.join(runDirectory, statusFileName),
        JSON.stringify(statusValue, null, 2),
        'utf8',
      )
    },
    releaseRunLock: async (): Promise<void> => {
      await rm(path.join(cwd, createRepoRunLockPath()), {
        force: true,
      })
    },
    runPreflight: async (): Promise<LivePreflightResult> => {
      const [
        nodeAvailable,
        pnpmAvailable,
        gitAvailable,
        cleanWorkingTree,
        mainUpdateAvailable,
        ghAuthAvailable,
        githubReadWriteAvailable,
        gitPushAvailable,
        ciPollingAvailable,
        dockerAvailable,
        sandcastleDockerImageAvailable,
        sandcastleAvailable,
        codeRabbitAvailable,
        codexAvailable,
        baselineRepoCommandsAvailable,
      ] = await Promise.all([
        commandSucceeds(shell, 'node', ['--version']),
        commandSucceeds(shell, 'pnpm', ['--version']),
        commandSucceeds(shell, 'git', ['--version']),
        commandSucceedsWithOutput(
          shell,
          'git',
          ['status', '--porcelain'],
          (stdout) => stdout === '',
        ),
        commandSucceeds(shell, 'git', ['fetch', '--dry-run', 'origin', 'main']),
        commandSucceeds(shell, 'gh', ['auth', 'status']),
        commandSucceeds(shell, 'gh', [
          'pr',
          'list',
          '--state',
          'open',
          '--limit',
          '1',
          '--json',
          'number',
        ]),
        commandSucceeds(shell, 'git', ['push', '--dry-run', 'origin', 'HEAD']),
        commandSucceeds(shell, 'gh', [
          'run',
          'list',
          '--limit',
          '1',
          '--json',
          'status,conclusion',
        ]),
        commandSucceeds(shell, 'docker', ['ps', '--format', '{{.ID}}']),
        commandSucceeds(shell, 'docker', [
          'image',
          'inspect',
          createDefaultSandcastleDockerImageName(cwd),
        ]),
        commandSucceeds(shell, 'pnpm', [
          '--filter',
          '@cv-maxxing/prd-orchestrator',
          'exec',
          'node',
          '--input-type=module',
          '--eval',
          'import("@ai-hero/sandcastle")',
        ]),
        commandSucceeds(shell, 'coderabbit', ['--version']),
        commandSucceeds(shell, 'codex', ['--version']),
        commandSucceeds(shell, 'pnpm', [
          '--filter',
          '@cv-maxxing/prd-orchestrator',
          'exec',
          'vitest',
          '--version',
        ]),
      ])
      const preflight = evaluatePreflight({
        baselineRepoCommandsAvailable: baselineRepoCommandsAvailable && gitAvailable,
        ciPollingAvailable,
        cleanWorkingTree,
        codeRabbitAvailable,
        codexAvailable,
        dockerAvailable,
        githubReadWriteAvailable: ghAuthAvailable && githubReadWriteAvailable,
        gitPushAvailable,
        mainUpdateAvailable,
        nodeAvailable,
        pnpmAvailable,
        sandcastleAvailable,
        sandcastleDockerImageAvailable,
      })

      return {
        blockers: preflight.blockers,
        ready: preflight.ready,
      }
    },
  }
}

const recoverStaleRepoLock = async (lockFilePath: string): Promise<boolean> => {
  try {
    const content = await readFile(lockFilePath, 'utf8')
    const lock: unknown = JSON.parse(content)

    if (!isRecord(lock) || typeof lock.pid !== 'number') {
      return false
    }

    if (isProcessAlive(lock.pid)) {
      return false
    }

    const heartbeatIso =
      typeof lock.heartbeatIso === 'string' ? lock.heartbeatIso : new Date(0).toISOString()
    const heartbeatEpochMs = Date.parse(heartbeatIso)
    const staleHeartbeatMs = 15 * 60 * 1000

    if (Number.isFinite(heartbeatEpochMs) && Date.now() - heartbeatEpochMs < staleHeartbeatMs) {
      return false
    }

    const staleLockFilePath = `${lockFilePath}.stale.${String(process.pid)}.${String(Date.now())}`

    await rename(lockFilePath, staleLockFilePath)
    await rm(staleLockFilePath, {
      force: true,
    })

    return true
  } catch {
    return false
  }
}

const commandSucceeds = async (
  shell: DefaultLiveAdapterShellRunner,
  command: string,
  args: readonly string[],
): Promise<boolean> => {
  try {
    await shell({
      args,
      command,
      timeoutMs: 60 * 1000,
    })

    return true
  } catch {
    return false
  }
}

const commandSucceedsWithOutput = async (
  shell: DefaultLiveAdapterShellRunner,
  command: string,
  args: readonly string[],
  validate: (stdout: string) => boolean,
): Promise<boolean> => {
  try {
    const result = await shell({
      args,
      command,
      timeoutMs: 60 * 1000,
    })

    return validate(result.stdout.trim())
  } catch {
    return false
  }
}

const createRunId = (): string =>
  `${new Date().toISOString().replaceAll(/[-:.]/g, '').slice(0, 15)}-${String(process.pid)}`

const findLatestRunDirectory = async (cwd: string): Promise<string> => {
  const root = path.join(cwd, runStateRoot)
  const entries = await readdir(root)
  const runDirectories = await Promise.all(
    entries.map(async (entry) => {
      const runDirectory = path.join(root, entry)
      const runDirectoryStat = await stat(runDirectory)

      return {
        lastModifiedEpochMs: runDirectoryStat.mtimeMs,
        path: runDirectory,
      }
    }),
  )
  const latestRunDirectory = runDirectories.toSorted(
    (left, right) => right.lastModifiedEpochMs - left.lastModifiedEpochMs,
  )[0]

  if (latestRunDirectory === undefined) {
    throw new Error('No PRD orchestrator run state exists.')
  }

  return latestRunDirectory.path
}

const discoverActiveRunIds = async (cwd: string): Promise<readonly string[]> => {
  const repoLockRunId = await readActiveRunIdFromLock(path.join(cwd, createRepoRunLockPath()))

  try {
    const entries = await readdir(path.join(cwd, runStateRoot))
    const activeRunIds = await Promise.all(
      entries.map(async (entry): Promise<string | undefined> => {
        return await readActiveRunIdFromLock(path.join(cwd, runStateRoot, entry, lockFileName))
      }),
    )

    return [repoLockRunId, ...activeRunIds].filter((runId): runId is string => runId !== undefined)
  } catch {
    return repoLockRunId === undefined ? [] : [repoLockRunId]
  }
}

const acquireRecoveredRunLock = async (
  lockFilePath: string,
  activeRunId: string,
): Promise<LiveRunLockResult> => {
  const attempts = [0, 1, 2] as const

  for (const attempt of attempts) {
    try {
      await writeRunLockFile(lockFilePath, activeRunId)

      return {
        blockers: [],
        lockId: activeRunId,
        ready: true,
      }
    } catch (error) {
      if (!isFileAlreadyExistsError(error)) {
        return {
          blockers: ['Unable to acquire repo lock during stale-lock recovery.'],
          lockId: undefined,
          ready: false,
        }
      }

      if (attempt < attempts.length - 1) {
        await sleep(25)
      }
    }
  }

  return {
    blockers: ['Another PRD orchestrator run acquired the lock during recovery.'],
    lockId: undefined,
    ready: false,
  }
}

const writeRunLockFile = async (lockFilePath: string, activeRunId: string): Promise<void> => {
  await writeFile(
    lockFilePath,
    JSON.stringify(
      {
        heartbeatIso: new Date().toISOString(),
        pid: process.pid,
        runId: activeRunId,
      },
      null,
      2,
    ),
    {
      encoding: 'utf8',
      flag: 'wx',
    },
  )
}

const isFileAlreadyExistsError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST'

const readActiveRunIdFromLock = async (lockFilePath: string): Promise<string | undefined> => {
  try {
    const content = await readFile(lockFilePath, 'utf8')
    const lock: unknown = JSON.parse(content)

    if (!isRecord(lock) || typeof lock.pid !== 'number' || typeof lock.runId !== 'string') {
      return undefined
    }

    return isProcessAlive(lock.pid) ? lock.runId : undefined
  } catch {
    return undefined
  }
}

const getCurrentProcessIds = (): readonly number[] => [process.pid]

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

const viewPullRequestByHead = async (
  shell: DefaultLiveAdapterShellRunner,
  branchName: string,
): Promise<AutomationPrDetails> => {
  const result = await shell({
    args: [
      'pr',
      'list',
      '--state',
      'open',
      '--head',
      branchName,
      '--json',
      'number,url,headRefName,body,isDraft',
      '--limit',
      '1',
    ],
    command: 'gh',
  })
  const pullRequest = parseJsonArray(result.stdout).at(0)

  if (!isRecord(pullRequest)) {
    throw new Error(`Unable to locate draft PR for branch ${branchName}.`)
  }

  return {
    body: parseStringField(pullRequest, 'body'),
    branchName: parseStringField(pullRequest, 'headRefName'),
    isDraft: parseBooleanField(pullRequest, 'isDraft'),
    prNumber: parseNumberField(pullRequest, 'number'),
    url: parseStringField(pullRequest, 'url'),
  }
}

const loadPromptInputs = async (
  cwd: string,
): Promise<{
  readonly architecture: string
  readonly instructions: string
}> => {
  const [architecture, instructions] = await Promise.all([
    readFile(path.join(cwd, 'ARCHITECTURE.md'), 'utf8'),
    readFile(path.join(cwd, 'AGENTS.md'), 'utf8').catch(() => ''),
  ])

  return {
    architecture,
    instructions,
  }
}

const buildImplementationPrompt = async (
  cwd: string,
  input: RunImplementationInput,
): Promise<string> => {
  const template = await readFile(
    path.join(cwd, '.sandcastle/prompts/implement-child-task.md'),
    'utf8',
  )

  return renderImplementationPrompt(template, input)
}

export const renderImplementationPrompt = (
  template: string,
  input: RunImplementationInput,
): string => {
  return template
    .replace('{{PARENT_PRD}}', input.parentPrdBody)
    .replace('{{CHILD_TASK}}', formatChildTaskForPrompt(input.childTask))
    .replace('{{SIBLING_SUMMARIES}}', JSON.stringify(input.siblingSummaries, null, 2))
    .replace('{{EXPECTED_WRITE_SURFACES}}', JSON.stringify(input.impactAnalysis, null, 2))
    .replace(
      '{{PENCIL_WORKFLOW_REQUIREMENTS}}',
      buildPencilWorkflowRequirementSection(input.impactAnalysis),
    )
}

const discoverCleanupArtifacts = async (
  cwd: string,
  shell: DefaultLiveAdapterShellRunner,
): Promise<readonly CleanupArtifact[]> => {
  const artifactRoots: readonly {
    readonly category: CleanupArtifact['category']
    readonly path: string
  }[] = [
    {
      category: 'run-log',
      path: runStateRoot,
    },
    {
      category: 'sandbox-branch',
      path: '.sandcastle/worktrees',
    },
    {
      category: 'sandcastle-artifact',
      path: '.sandcastle/logs',
    },
    {
      category: 'sandcastle-artifact',
      path: '.sandcastle/patches',
    },
  ]
  const artifactGroups = await Promise.all(
    artifactRoots.map(async (root) => {
      try {
        const entries = await readdir(path.join(cwd, root.path))

        return await Promise.all(
          entries.map(async (entry): Promise<CleanupArtifact> => {
            const artifactPath = `${root.path}/${entry}`
            const artifactStat = await stat(path.join(cwd, artifactPath))

            return {
              category: root.category,
              lastModifiedEpochMs: artifactStat.mtimeMs,
              path: artifactPath,
              runId: root.path === runStateRoot ? entry : undefined,
            }
          }),
        )
      } catch {
        return []
      }
    }),
  )

  return [
    ...artifactGroups.flat(),
    ...(await discoverLocalBranchArtifacts(cwd)),
    ...(await discoverContainerArtifacts(shell)),
  ]
}

const discoverLocalBranchArtifacts = async (cwd: string): Promise<readonly CleanupArtifact[]> => {
  try {
    const gitDirectory = path.join(cwd, '.git/refs/heads/agent')
    const entries = await readdir(gitDirectory)

    return await Promise.all(
      entries.map(async (entry): Promise<CleanupArtifact> => {
        const branchPath = `branch:agent/${entry}`
        const branchStat = await stat(path.join(gitDirectory, entry))

        return {
          category: 'sandbox-branch',
          lastModifiedEpochMs: branchStat.mtimeMs,
          path: branchPath,
        }
      }),
    )
  } catch {
    return []
  }
}

const discoverContainerArtifacts = async (
  shell: DefaultLiveAdapterShellRunner,
): Promise<readonly CleanupArtifact[]> => {
  try {
    const result = await shell({
      args: [
        'ps',
        '--all',
        '--filter',
        'name=prd-orchestrator',
        '--format',
        '{{.ID}}\t{{.Status}}\t{{.Names}}',
      ],
      command: 'docker',
    })

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [containerId, status, name] = line.split('\t')
        const active = status?.startsWith('Up') === true

        return {
          category: 'container',
          lastModifiedEpochMs: active ? Date.now() : 0,
          path: `container:${containerId ?? ''}`,
          runId: parseRunIdFromArtifactName(name),
        } satisfies CleanupArtifact
      })
  } catch {
    return []
  }
}

const removeCleanupArtifact = async (
  cwd: string,
  shell: DefaultLiveAdapterShellRunner,
  artifactPath: string,
): Promise<void> => {
  if (artifactPath.startsWith('branch:')) {
    await shell({
      args: ['branch', '-D', artifactPath.slice('branch:'.length)],
      command: 'git',
    })

    return
  }

  if (artifactPath.startsWith('container:')) {
    await shell({
      args: ['rm', '-f', artifactPath.slice('container:'.length)],
      command: 'docker',
    })

    return
  }

  await rm(path.join(cwd, artifactPath), {
    force: true,
    recursive: true,
  })
}

const withTemporaryFile = async <Result>(
  prefix: string,
  content: string,
  useFile: (filePath: string) => Promise<Result>,
): Promise<Result> => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  const filePath = path.join(directory, 'content.txt')

  await writeFile(filePath, content, 'utf8')

  try {
    return await useFile(filePath)
  } finally {
    await rm(directory, {
      force: true,
      recursive: true,
    })
  }
}

const withTemporaryJsonFile = async <Result>(
  prefix: string,
  content: Record<string, unknown>,
  useFile: (filePath: string) => Promise<Result>,
): Promise<Result> => {
  return await withTemporaryFile(prefix, JSON.stringify(content), useFile)
}

const findIssueCommentIdByMarker = async (
  shell: DefaultLiveAdapterShellRunner,
  prNumber: number,
  marker: string,
): Promise<number | undefined> => {
  const result = await shell({
    args: [
      'api',
      `repos/{owner}/{repo}/issues/${String(prNumber)}/comments`,
      '--paginate',
      '--slurp',
    ],
    command: 'gh',
  })

  return parseIssueComments(result.stdout).find((comment) => comment.body.includes(marker))?.id
}

const createWorkerBranchName = (input: RunImpactAnalysisInput): string =>
  `agent/prd-${String(input.parentPrd.issueNumber)}-child-${String(
    input.childTask.issueNumber,
  )}-${slugify(input.childTask.title)}`

const formatChildTaskForPrompt = (childTask: ParsedChildTask): string =>
  [
    `Issue: #${String(childTask.issueNumber)} ${childTask.title}`,
    '',
    'What to build:',
    childTask.whatToBuild,
    '',
    'Acceptance criteria:',
    ...childTask.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    '',
    'User stories addressed:',
    ...childTask.userStoriesAddressed.map((storyNumber) => `- User story ${String(storyNumber)}`),
  ].join('\n')

const parseGitHubIssue = (value: unknown): GitHubIssue => {
  if (!isRecord(value)) {
    throw new TypeError('Expected GitHub issue JSON objects.')
  }

  return {
    body: parseStringField(value, 'body'),
    number: parseNumberField(value, 'number'),
    state: parseStringField(value, 'state').toUpperCase(),
    title: parseStringField(value, 'title'),
  }
}

const parseGitHubActionsCheckRuns = (content: string): readonly GitHubActionsRun[] => {
  const pullRequest = parseJsonRecord(content)
  const checks = Array.isArray(pullRequest.statusCheckRollup) ? pullRequest.statusCheckRollup : []

  return checks.flatMap((check) => {
    if (!isRecord(check)) {
      return []
    }

    return [parseGitHubActionsCheckRun(check)]
  })
}

const parseGitHubActionsCheckRun = (check: Record<string, unknown>): GitHubActionsRun => {
  const name = parseOptionalStringField(check, 'name') ?? parseOptionalStringField(check, 'context')

  if (name === undefined) {
    throw new TypeError('Expected GitHub check JSON object to include a name or context.')
  }

  const status = parseOptionalStringField(check, 'status')
  const state = parseOptionalStringField(check, 'state')
  const conclusion = parseOptionalStringField(check, 'conclusion')

  if (state !== undefined && status === undefined) {
    return parseGitHubStatusContext({
      name,
      state,
    })
  }

  return {
    conclusion: conclusion?.toLowerCase(),
    name,
    status: (status ?? 'pending').toLowerCase(),
  }
}

const parseGitHubStatusContext = (input: {
  readonly name: string
  readonly state: string
}): GitHubActionsRun => {
  const state = input.state.toLowerCase()

  if (state === 'success') {
    return {
      conclusion: 'success',
      name: input.name,
      status: 'completed',
    }
  }

  if (state === 'error' || state === 'failure') {
    return {
      conclusion: state,
      name: input.name,
      status: 'completed',
    }
  }

  return {
    conclusion: undefined,
    name: input.name,
    status: 'pending',
  }
}

const parseFailedGitHubActionsChecks = (
  content: string,
): readonly {
  readonly detailsUrl: string | undefined
  readonly name: string
  readonly workflowName: string | undefined
}[] => {
  const pullRequest = parseJsonRecord(content)
  const checks = Array.isArray(pullRequest.statusCheckRollup) ? pullRequest.statusCheckRollup : []

  return checks.flatMap((check) => {
    if (!isRecord(check)) {
      return []
    }

    const status = parseOptionalStringField(check, 'status')?.toUpperCase()
    const conclusion = parseOptionalStringField(check, 'conclusion')?.toUpperCase()
    const detailsUrl = parseOptionalStringField(check, 'detailsUrl')

    if (status !== 'COMPLETED' || conclusion !== 'FAILURE') {
      return []
    }

    if (detailsUrl?.includes('/actions/runs/') !== true) {
      return []
    }

    return [
      {
        detailsUrl,
        name: parseStringField(check, 'name'),
        workflowName: parseOptionalStringField(check, 'workflowName'),
      },
    ]
  })
}

const parseGitHubActionsRunId = (detailsUrl: string | undefined): string | undefined =>
  /\/actions\/runs\/(\d+)/.exec(detailsUrl ?? '')?.[1]

const loadCiFailureLogExcerpt = async (input: {
  readonly checkName: string
  readonly detailsUrl: string | undefined
  readonly runId: string | undefined
  readonly shell: DefaultLiveAdapterShellRunner
}): Promise<string> => {
  if (input.runId === undefined) {
    return `No GitHub Actions run id was available for ${input.detailsUrl ?? input.checkName}.`
  }

  const logResult = await input.shell({
    args: ['run', 'view', input.runId, '--log-failed'],
    command: 'gh',
    timeoutMs: 30 * 60 * 1000,
  })

  return trimCiFailureLog(logResult.stdout)
}

const trimCiFailureLog = (content: string): string => {
  const lines = content.split('\n')
  const firstFailureLineIndex = lines.findIndex((line) =>
    /##\[error\]|Error:|TimeoutError|failed|FAIL/i.test(line),
  )
  const startIndex = firstFailureLineIndex === -1 ? 0 : Math.max(0, firstFailureLineIndex - 40)
  const excerpt = lines
    .slice(startIndex, startIndex + 220)
    .join('\n')
    .trim()

  return excerpt.length <= 16_000 ? excerpt : `${excerpt.slice(0, 16_000)}\n[truncated]`
}

const parseCodeRabbitFindings = (
  content: string,
  inlineReviewCommentsContent = '[]',
): readonly CodeRabbitFinding[] => {
  const pullRequest = parseJsonRecord(content)
  const reviews = Array.isArray(pullRequest.reviews) ? pullRequest.reviews : []
  const comments = Array.isArray(pullRequest.comments) ? pullRequest.comments : []
  const inlineReviewComments = parseInlineReviewComments(inlineReviewCommentsContent)
  const checks = Array.isArray(pullRequest.statusCheckRollup) ? pullRequest.statusCheckRollup : []

  return [
    ...reviews.flatMap((review, index) => parseCodeRabbitReviewFinding(review, index)),
    ...comments.flatMap((comment, index) => parseCodeRabbitCommentFinding(comment, index)),
    ...inlineReviewComments.flatMap((comment, index) =>
      parseCodeRabbitInlineReviewCommentFinding(comment, index),
    ),
    ...checks.flatMap((check, index) => parseCodeRabbitCheckFinding(check, index)),
  ]
}

const parseInlineReviewComments = (content: string): readonly unknown[] => {
  const parsedContent = parseJsonArray(content)

  if (parsedContent.every((item) => Array.isArray(item))) {
    return parsedContent.flatMap((item) => item as readonly unknown[])
  }

  return parsedContent
}

const parseIssueComments = (
  content: string,
): readonly {
  readonly body: string
  readonly id: number
}[] => {
  const parsedContent = parseJsonArray(content)
  const commentValues = parsedContent.every((item) => Array.isArray(item))
    ? parsedContent.flatMap((item) => item as readonly unknown[])
    : parsedContent

  return commentValues.flatMap((comment) => {
    if (!isRecord(comment)) {
      return []
    }

    const body = parseOptionalStringField(comment, 'body')
    const id = parseOptionalNumberField(comment, 'id')

    return body === undefined || id === undefined
      ? []
      : [
          {
            body,
            id,
          },
        ]
  })
}

const parseCodeRabbitReviewFinding = (
  review: unknown,
  index: number,
): readonly CodeRabbitFinding[] => {
  if (!isRecord(review)) {
    return []
  }

  const author = review.author
  const authorLogin = isRecord(author) ? parseOptionalStringField(author, 'login') : undefined
  const state = parseOptionalStringField(review, 'state')

  if (authorLogin?.toLowerCase().includes('coderabbit') !== true || state !== 'CHANGES_REQUESTED') {
    return []
  }

  return [
    {
      body: parseOptionalStringField(review, 'body') ?? 'CodeRabbit requested changes.',
      id: `coderabbit-review-${String(index + 1)}`,
      source: 'github-pr-review',
      title: 'CodeRabbit requested changes',
    },
  ]
}

const parseCodeRabbitCommentFinding = (
  comment: unknown,
  index: number,
): readonly CodeRabbitFinding[] => {
  if (!isRecord(comment)) {
    return []
  }

  const author = comment.author ?? comment.user
  const authorLogin = isRecord(author) ? parseOptionalStringField(author, 'login') : undefined

  if (authorLogin?.toLowerCase().includes('coderabbit') !== true) {
    return []
  }

  const body = parseOptionalStringField(comment, 'body')

  if (body !== undefined && isCodeRabbitGeneratedTopLevelComment(body)) {
    return []
  }

  return [
    {
      body: body ?? 'CodeRabbit left a PR comment.',
      id: `coderabbit-comment-${String(index + 1)}`,
      source: 'github-pr-review',
      title: 'CodeRabbit PR comment',
    },
  ]
}

const codeRabbitGeneratedTopLevelCommentMarkers = [
  '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->',
  '<!-- This is an auto-generated comment by CodeRabbit for review status -->',
  '<!-- walkthrough_start -->',
  '<!-- review_rate_limit_status_start -->',
] as const

const isCodeRabbitGeneratedTopLevelComment = (body: string): boolean =>
  codeRabbitGeneratedTopLevelCommentMarkers.some((marker) => body.includes(marker))

const parseCodeRabbitInlineReviewCommentFinding = (
  comment: unknown,
  index: number,
): readonly CodeRabbitFinding[] => {
  if (!isRecord(comment)) {
    return []
  }

  const author = comment.author ?? comment.user
  const authorLogin = isRecord(author) ? parseOptionalStringField(author, 'login') : undefined

  if (authorLogin?.toLowerCase().includes('coderabbit') !== true) {
    return []
  }

  return [
    {
      body: parseOptionalStringField(comment, 'body') ?? 'CodeRabbit left an inline comment.',
      commitHash:
        parseOptionalStringField(comment, 'commit_id') ??
        parseOptionalStringField(comment, 'original_commit_id'),
      filePath: parseOptionalStringField(comment, 'path'),
      id: `coderabbit-inline-comment-${String(index + 1)}`,
      lineNumber:
        parseOptionalNumberField(comment, 'line') ??
        parseOptionalNumberField(comment, 'original_line'),
      source: 'github-pr-review',
      title: 'CodeRabbit inline review comment',
    },
  ]
}

const parseCodeRabbitCheckFinding = (
  check: unknown,
  index: number,
): readonly CodeRabbitFinding[] => {
  if (!isRecord(check)) {
    return []
  }

  const name = parseOptionalStringField(check, 'name') ?? ''
  const conclusion = parseOptionalStringField(check, 'conclusion')
  const status = parseOptionalStringField(check, 'status')
  const failed =
    conclusion !== undefined &&
    conclusion !== 'success' &&
    conclusion !== 'neutral' &&
    conclusion !== 'skipped'

  if (!name.toLowerCase().includes('coderabbit') || status !== 'COMPLETED' || !failed) {
    return []
  }

  return [
    {
      body: `CodeRabbit check ${name} failed with conclusion ${conclusion}.`,
      id: `coderabbit-check-${String(index + 1)}`,
      source: 'github-check',
      title: 'CodeRabbit check failed',
    },
  ]
}

const parseRunStatus = (value: unknown): RunStatus => {
  if (!isRecord(value)) {
    throw new TypeError('Expected run status JSON object.')
  }

  return {
    activePrdIssueNumber: parseOptionalNumberField(value, 'activePrdIssueNumber'),
    blockers: parseStringArray(value.blockers),
    branchName: parseOptionalStringField(value, 'branchName'),
    ciStatus: parseOptionalStringField(value, 'ciStatus'),
    codeRabbitStatus: parseOptionalStringField(value, 'codeRabbitStatus'),
    completedChildren: parseNumberArray(value.completedChildren),
    currentChildIssueNumber: parseOptionalNumberField(value, 'currentChildIssueNumber'),
    heartbeatIso: parseOptionalStringField(value, 'heartbeatIso'),
    lastCommand: parseOptionalStringField(value, 'lastCommand'),
    phase: parseStringField(value, 'phase'),
    prNumber: parseOptionalNumberField(value, 'prNumber'),
    prUrl: parseOptionalStringField(value, 'prUrl'),
  }
}

const parseRemoteAutomationPrOwnership = (
  values: readonly unknown[],
): RemoteAutomationPrOwnership => {
  return values
    .map((value) => parseOpenPullRequestSummary(value))
    .filter((pullRequest) => isAutomationPrCandidate(pullRequest))
    .reduce<RemoteAutomationPrOwnership>(
      (ownership, pullRequest) => {
        const validation = validateAutomationPrOwnership({
          body: pullRequest.body,
          branchName: pullRequest.branchName,
          prNumber: pullRequest.prNumber,
        })
        const prdIssueNumber = parsePrdIssueNumberFromAutomationBranch(pullRequest.branchName)

        if (!validation.valid || prdIssueNumber === undefined) {
          return {
            blockers: [
              ...ownership.blockers,
              ...validation.blockers,
              ...(prdIssueNumber === undefined && validation.valid
                ? [
                    `PR #${String(
                      pullRequest.prNumber,
                    )} branch ${pullRequest.branchName} is not an orchestrator PRD branch`,
                  ]
                : []),
            ],
            remoteAutomationPrs: ownership.remoteAutomationPrs,
          }
        }

        return {
          blockers: ownership.blockers,
          remoteAutomationPrs: [
            ...ownership.remoteAutomationPrs,
            {
              branchName: pullRequest.branchName,
              isDraft: pullRequest.isDraft,
              prNumber: pullRequest.prNumber,
              prdIssueNumber,
              url: pullRequest.url,
            },
          ],
        }
      },
      {
        blockers: [],
        remoteAutomationPrs: [],
      },
    )
}

const parseOpenPullRequestSummary = (value: unknown): OpenPullRequestSummary => {
  if (!isRecord(value)) {
    throw new TypeError('Expected each pull request to be an object.')
  }

  return {
    body: parseStringField(value, 'body'),
    branchName: parseStringField(value, 'headRefName'),
    isDraft: parseBooleanField(value, 'isDraft'),
    prNumber: parseNumberField(value, 'number'),
    url: parseStringField(value, 'url'),
  }
}

const isAutomationPrCandidate = (pullRequest: OpenPullRequestSummary): boolean =>
  pullRequest.branchName.startsWith('agent/prd-') ||
  pullRequest.body.includes('Managed by `@cv-maxxing/prd-orchestrator`.')

const parsePrdIssueNumberFromAutomationBranch = (branchName: string): number | undefined => {
  const issueNumber = Number.parseInt(/^agent\/prd-(\d+)-/.exec(branchName)?.[1] ?? '', 10)

  return Number.isInteger(issueNumber) ? issueNumber : undefined
}

const parseJsonRecord = (content: string): Record<string, unknown> => {
  const parsedContent: unknown = JSON.parse(content)

  if (!isRecord(parsedContent)) {
    throw new TypeError('Expected JSON object.')
  }

  return parsedContent
}

const parseJsonArray = (content: string): readonly unknown[] => {
  const parsedContent: unknown = JSON.parse(content)

  if (!Array.isArray(parsedContent)) {
    throw new TypeError('Expected JSON array.')
  }

  return parsedContent
}

const parseStringField = (value: Record<string, unknown>, fieldName: string): string => {
  const fieldValue = value[fieldName]

  if (typeof fieldValue !== 'string') {
    throw new TypeError(`Expected ${fieldName} to be a string.`)
  }

  return fieldValue
}

const parseOptionalStringField = (
  value: Record<string, unknown>,
  fieldName: string,
): string | undefined => {
  const fieldValue = value[fieldName]

  if (fieldValue === undefined || fieldValue === null) {
    return undefined
  }

  if (typeof fieldValue !== 'string') {
    throw new TypeError(`Expected ${fieldName} to be a string.`)
  }

  return fieldValue
}

const parseNumberField = (value: Record<string, unknown>, fieldName: string): number => {
  const fieldValue = value[fieldName]

  if (typeof fieldValue !== 'number') {
    throw new TypeError(`Expected ${fieldName} to be a number.`)
  }

  return fieldValue
}

const parseOptionalNumberField = (
  value: Record<string, unknown>,
  fieldName: string,
): number | undefined => {
  const fieldValue = value[fieldName]

  if (fieldValue === undefined || fieldValue === null) {
    return undefined
  }

  if (typeof fieldValue !== 'number') {
    throw new TypeError(`Expected ${fieldName} to be a number.`)
  }

  return fieldValue
}

const parseOptionalPositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || value.length === 0) {
    return undefined
  }

  const parsedValue = Number.parseInt(value, 10)

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return undefined
  }

  return parsedValue
}

const parseBooleanField = (value: Record<string, unknown>, fieldName: string): boolean => {
  const fieldValue = value[fieldName]

  if (typeof fieldValue !== 'boolean') {
    throw new TypeError(`Expected ${fieldName} to be a boolean.`)
  }

  return fieldValue
}

const parseStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new TypeError('Expected string array.')
    }

    return item
  })
}

const parseNumberArray = (value: unknown): readonly number[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => {
    if (typeof item !== 'number') {
      throw new TypeError('Expected number array.')
    }

    return item
  })
}

const parseClosedIssueNumbers = (content: string): readonly number[] => [
  ...new Set(
    [...content.matchAll(/Closes\s+#(\d+)/gi)]
      .map((match) => Number.parseInt(match[1] ?? '', 10))
      .filter((issueNumber) => Number.isInteger(issueNumber)),
  ),
]

const parseChildCommitReferences = (content: string): readonly ChildCommitReference[] =>
  content
    .split('\0\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const [hash, body] = entry.split('\0')
      const issueNumber = parseClosedIssueNumbers(body ?? '').at(0)

      if (hash === undefined || issueNumber === undefined) {
        return []
      }

      return [
        {
          childIssueNumber: issueNumber,
          commitHash: hash,
        },
      ]
    })

const getCommitChangedFiles = async (
  shell: DefaultLiveAdapterShellRunner,
  commitHash: string,
): Promise<readonly string[]> => {
  try {
    const result = await shell({
      args: ['show', '--format=', '--name-only', commitHash],
      command: 'git',
    })

    return parseChangedFiles(result.stdout)
  } catch {
    return []
  }
}

const parseChangedFiles = (content: string): readonly string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const prohibitedCapabilityPatterns = [
  {
    capabilityId: 'telemetry',
    pattern: '@sentry|posthog|analytics-node|crashReporter|trackEvent|telemetryClient',
  },
  {
    capabilityId: 'remote-config',
    pattern: 'remoteConfig|remote-config|featureFlag|feature-flag',
  },
  {
    capabilityId: 'required-web-backend',
    pattern: String.raw`from ["']express|from ["']fastify|from ["']koa|createServer\(`,
  },
  {
    capabilityId: 'automatic-updates',
    pattern: 'autoUpdater|update-electron-app|electron-updater',
  },
  {
    capabilityId: 'mui',
    pattern: '@mui/|@material-ui/',
  },
  {
    capabilityId: 'redux',
    pattern: String.raw`from ["']redux|from ["']@reduxjs/toolkit|createStore\(|configureStore\(`,
  },
  {
    capabilityId: 'runtime-font-cdn',
    pattern: String.raw`fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net`,
  },
  {
    capabilityId: 'non-pdf-exports',
    pattern: String.raw`export.*\.(docx|doc|rtf|xlsx|odt)|mime.*(docx|msword|spreadsheet)`,
  },
] as const satisfies readonly {
  readonly capabilityId: ProhibitedCapabilityId
  readonly pattern: string
}[]

const findProhibitedCapabilityMatches = async (
  shell: DefaultLiveAdapterShellRunner,
  input: ScanProhibitedCapabilitiesInput,
): Promise<readonly ProhibitedCapabilityMatch[]> => {
  if (input.changedFiles.length === 0) {
    return []
  }

  const matches = await Promise.all(
    prohibitedCapabilityPatterns.map(async (definition) => {
      try {
        const result = await shell({
          args: [
            'grep',
            '--line-number',
            '--extended-regexp',
            '--ignore-case',
            definition.pattern,
            '--',
            ...input.changedFiles,
          ],
          command: 'git',
        })

        return parseProhibitedCapabilityMatches(definition.capabilityId, result.stdout)
      } catch {
        return []
      }
    }),
  )

  return matches.flat()
}

const parseProhibitedCapabilityMatches = (
  capabilityId: ProhibitedCapabilityId,
  content: string,
): readonly ProhibitedCapabilityMatch[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      capabilityId,
      evidence: line,
    }))

const parseRunIdFromArtifactName = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined
  }

  return /prd-orchestrator-([a-zA-Z0-9_.:-]+)/.exec(value)?.[1]
}

const parseCodexEffort = (value: string | undefined): 'high' | 'low' | 'medium' | 'xhigh' => {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value
  }

  return 'high'
}

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80)

  return slug.length === 0 ? 'untitled' : slug
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
