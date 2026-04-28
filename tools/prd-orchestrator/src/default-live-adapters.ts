import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { codex, run } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'

import {
  createSandcastleImpactAnalysisRunOptions,
  parseImpactAnalysisResult,
  type SandcastleImpactAnalysisResult,
} from './sandcastle-impact-analysis.js'
import {
  interpretGitHubActionsStatus,
  type ChildCommitReference,
  type CiStatus,
  type ResumePrFinding,
} from './final-prd-flow.js'
import {
  createCleanupPlanFromArtifacts,
  type ApplyWorkerDiffInput,
  type AutomationPrDetails,
  type ChildCommitResult,
  type CheckoutChildCommitInput,
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
  type ReviewChildInput,
  type ReviewChildResult,
  type RunImpactAnalysisInput,
  type RunImplementationInput,
  type RunImplementationResult,
} from './live-orchestrator.js'
import type {
  CleanupArtifact,
  CleanupPlan,
  RemoteAutomationPr,
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
  readonly timeoutMs?: number
}

export interface DefaultLiveAdapterShellCommandResult {
  readonly stderr: string
  readonly stdout: string
}

export type DefaultLiveAdapterShellRunner = (
  input: DefaultLiveAdapterShellCommandInput,
) => Promise<DefaultLiveAdapterShellCommandResult>

const defaultTimeoutMs = 10 * 60 * 1000
const runStateRoot = '.git/prd-orchestrator/runs'
const statusFileName = 'status.json'
const lockFileName = 'lock.json'

export const createDefaultPrdOrchestratorLiveAdapters = (
  cwd = process.cwd(),
  configuration?: PrdOrchestratorLiveConfiguration,
  shellRunner?: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters => {
  const shell = shellRunner ?? createShellRunner(cwd)
  const resolvedConfiguration = configuration ?? createEnvironmentConfiguration()

  return {
    ci: createCiAdapter(shell),
    codeRabbit: createCodeRabbitAdapter(shell),
    configuration: resolvedConfiguration,
    git: createGitAdapter(shell),
    github: createGitHubAdapter(shell),
    sandcastle: createSandcastleAdapter(cwd, shell, resolvedConfiguration),
    state: createRunStateAdapter(cwd, shell),
    verification: createVerificationAdapter(shell),
  }
}

const createEnvironmentConfiguration = (): PrdOrchestratorLiveConfiguration => ({
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
      const timeout = setTimeout(() => {
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
        clearTimeout(timeout)
        reject(error)
      })
      child.on('close', (exitCode) => {
        clearTimeout(timeout)

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

const createGitHubAdapter = (
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['github'] => ({
  createDraftPr: async (input: CreateDraftPrInput): Promise<RemoteAutomationPr> => {
    const bodyFilePath = await writeTemporaryFile('prd-pr-body-', input.body)

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

    const pr = await viewPullRequestByHead(shell, input.branchName)

    return {
      branchName: pr.branchName,
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
        'number,url,headRefName,body',
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
      prNumber: parseNumberField(pullRequest, 'number'),
      prdIssueNumber,
      url: parseStringField(pullRequest, 'url'),
    }
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
    const bodyFilePath = await writeTemporaryFile('prd-pr-comment-', body)

    await shell({
      args: ['pr', 'comment', String(prNumber), '--body-file', bodyFilePath],
      command: 'gh',
    })
  },
  updatePrBody: async (prNumber: number, body: string): Promise<void> => {
    const bodyFilePath = await writeTemporaryFile('prd-pr-body-', body)

    await shell({
      args: ['pr', 'edit', String(prNumber), '--body-file', bodyFilePath],
      command: 'gh',
    })
  },
})

const createGitAdapter = (
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['git'] => {
  let pendingChildCommitTarget: CheckoutChildCommitInput | undefined

  return {
    applyWorkerDiff: async (input: ApplyWorkerDiffInput): Promise<void> => {
      if (pendingChildCommitTarget === undefined) {
        await shell({
          args: ['checkout', input.prdBranchName],
          command: 'git',
        })
      } else if (pendingChildCommitTarget.branchName !== input.prdBranchName) {
        throw new Error(
          `Resume repair target branch ${pendingChildCommitTarget.branchName} does not match diff branch ${input.prdBranchName}.`,
        )
      }

      await shell({
        args: ['merge', '--squash', '--no-commit', input.workerBranchName],
        command: 'git',
      })
    },
    amendChildCommit: async (message: string): Promise<ChildCommitResult> => {
      const messageFilePath = await writeTemporaryFile('prd-child-amend-', message)
      const childCommitTarget = pendingChildCommitTarget

      await shell({
        args: ['add', '--all'],
        command: 'git',
      })
      await shell({
        args: ['commit', '--amend', '-F', messageFilePath],
        command: 'git',
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
      const messageFilePath = await writeTemporaryFile('prd-child-commit-', message)

      await shell({
        args: ['add', '--all'],
        command: 'git',
      })
      await shell({
        args: ['commit', '-F', messageFilePath],
        command: 'git',
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
      const messageFilePath = await writeTemporaryFile('prd-final-cleanup-', message)

      await shell({
        args: ['add', '--all'],
        command: 'git',
      })
      await shell({
        args: ['commit', '-F', messageFilePath],
        command: 'git',
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
      agent: codex(configuration.codexModel ?? 'gpt-5.5', {
        effort: parseCodexEffort(configuration.codexEffort),
        env: {},
      }),
      branchStrategy: {
        branch: input.workerBranchName,
        type: 'branch',
      },
      cwd,
      maxIterations: 1,
      prompt,
      sandbox: docker({
        env: {},
        mounts: [],
      }),
    })
    const changedFiles = await shell({
      args: ['diff', '--name-only', `${input.prdBranchName}..${result.branch}`],
      command: 'git',
    })

    return {
      changedFiles: parseChangedFiles(changedFiles.stdout),
      stdout: result.stdout,
      workerBranchName: result.branch,
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
      agent: codex(configuration.codexModel ?? 'gpt-5.5', {
        effort: parseCodexEffort(configuration.codexEffort),
        env: {},
      }),
      branchStrategy: {
        branch: input.workerBranchName,
        type: 'branch',
      },
      cwd,
      maxIterations: 1,
      prompt,
      sandbox: docker({
        env: {},
        mounts: [],
      }),
    })
    const changedFiles = await shell({
      args: [
        'diff',
        '--name-only',
        `${input.targetCommitHash ?? input.branchName}..${result.branch}`,
      ],
      command: 'git',
    })

    return {
      changedFiles: parseChangedFiles(changedFiles.stdout),
      stdout: result.stdout,
      workerBranchName: result.branch,
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
      agent: codex(configuration.codexModel ?? 'gpt-5.5', {
        effort: parseCodexEffort(configuration.codexEffort),
        env: {},
      }),
      branchStrategy: {
        branch: input.workerBranchName,
        type: 'branch',
      },
      cwd,
      maxIterations: 1,
      prompt,
      sandbox: docker({
        env: {},
        mounts: [],
      }),
    })
    const changedFiles = await shell({
      args: ['diff', '--name-only', `${input.prdBranchName}..${result.branch}`],
      command: 'git',
    })

    return {
      changedFiles: parseChangedFiles(changedFiles.stdout),
      stdout: result.stdout,
      workerBranchName: result.branch,
    }
  },
  runImpactAnalysis: async (
    input: RunImpactAnalysisInput,
  ): Promise<SandcastleImpactAnalysisResult> => {
    const promptInputs = await loadPromptInputs(cwd)
    const result = await run({
      ...createSandcastleImpactAnalysisRunOptions({
        architectureDesignConstraints: promptInputs.architecture,
        assignedChildTaskBody: formatChildTaskForPrompt(input.childTask),
        cacheInputs: {
          packageManager: 'pnpm',
        },
        childIssueNumber: input.childTask.issueNumber,
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
      }),
      cwd,
    })

    return parseImpactAnalysisResult(result.stdout)
  },
  runImplementation: async (input: RunImplementationInput): Promise<RunImplementationResult> => {
    const prompt = await buildImplementationPrompt(cwd, input)
    const result = await run({
      agent: codex(configuration.codexModel ?? 'gpt-5.5', {
        effort: parseCodexEffort(configuration.codexEffort),
        env: {},
      }),
      branchStrategy: {
        branch: input.workerBranchName,
        type: 'branch',
      },
      cwd,
      maxIterations: 1,
      prompt,
      sandbox: docker({
        env: {},
        mounts: [],
      }),
    })
    const changedFiles = await shell({
      args: ['diff', '--name-only', `${input.prdBranchName}..${result.branch}`],
      command: 'git',
    })

    return {
      changedFiles: parseChangedFiles(changedFiles.stdout),
      stdout: result.stdout,
      workerBranchName: result.branch,
    }
  },
})

const createVerificationAdapter = (
  shell: DefaultLiveAdapterShellRunner,
): PrdOrchestratorLiveAdapters['verification'] => ({
  runCommands: async (commands: readonly string[]): Promise<readonly string[]> => {
    const evidence: string[] = []

    for (const command of commands) {
      await shell({
        args: ['-lc', command],
        command: '/bin/zsh',
        timeoutMs: 30 * 60 * 1000,
      })
      evidence.push(command)
    }

    return evidence
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
      timeoutMs: 60 * 60 * 1000,
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
  pollChecks: async (input: PollChecksInput): Promise<CiStatus> => {
    const result = await shell({
      args: [
        'run',
        'list',
        '--branch',
        input.branchName,
        '--json',
        'name,status,conclusion',
        '--limit',
        '20',
      ],
      command: 'gh',
      timeoutMs: 30 * 60 * 1000,
    })

    return interpretGitHubActionsStatus({
      runs: parseJsonArray(result.stdout).map((runValue) => parseGitHubActionsRun(runValue)),
    }).status
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
        commandSucceeds(shell, 'node', [
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

  return template
    .replace('{{PARENT_PRD}}', input.parentPrdBody)
    .replace('{{CHILD_TASK}}', formatChildTaskForPrompt(input.childTask))
    .replace('{{SIBLING_SUMMARIES}}', JSON.stringify(input.siblingSummaries, null, 2))
    .replace('{{EXPECTED_WRITE_SURFACES}}', JSON.stringify(input.impactAnalysis, null, 2))
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

const writeTemporaryFile = async (prefix: string, content: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  const filePath = path.join(directory, 'content.txt')

  await writeFile(filePath, content, 'utf8')

  return filePath
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

const parseGitHubActionsRun = (
  value: unknown,
): {
  readonly conclusion: string | undefined
  readonly name: string
  readonly status: string
} => {
  if (!isRecord(value)) {
    throw new TypeError('Expected GitHub Actions run JSON object.')
  }

  return {
    conclusion: parseOptionalStringField(value, 'conclusion'),
    name: parseStringField(value, 'name'),
    status: parseStringField(value, 'status'),
  }
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

  return [
    {
      body: parseOptionalStringField(comment, 'body') ?? 'CodeRabbit left a PR comment.',
      id: `coderabbit-comment-${String(index + 1)}`,
      source: 'github-pr-review',
      title: 'CodeRabbit PR comment',
    },
  ]
}

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

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
