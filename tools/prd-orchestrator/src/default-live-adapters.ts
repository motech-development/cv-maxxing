import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { codex, run } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'

import {
  createSandcastleImpactAnalysisRunOptions,
  parseImpactAnalysisResult,
  type SandcastleImpactAnalysisResult,
} from './sandcastle-impact-analysis.js'
import { interpretGitHubActionsStatus, type CiStatus } from './final-prd-flow.js'
import {
  createCleanupPlanFromArtifacts,
  type ApplyWorkerDiffInput,
  type AutomationPrDetails,
  type ChildCommitResult,
  type CreateDraftPrInput,
  type PreparePrdBranchInput,
  type PrdOrchestratorLiveAdapters,
  type PushPrdBranchInput,
  type PollChecksInput,
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
import type { GitHubIssue, ParsedChildTask } from './planning.js'
import type { CodeRabbitFinding } from './coderabbit-review.js'

interface ShellCommandInput {
  readonly args: readonly string[]
  readonly command: string
  readonly cwd?: string
  readonly stdin?: string
  readonly timeoutMs?: number
}

interface ShellCommandResult {
  readonly stderr: string
  readonly stdout: string
}

const defaultTimeoutMs = 10 * 60 * 1000
const runStateRoot = '.git/prd-orchestrator/runs'
const latestRunId = 'latest'
const statusFileName = 'status.json'

export const createDefaultPrdOrchestratorLiveAdapters = (
  cwd = process.cwd(),
): PrdOrchestratorLiveAdapters => {
  const shell = createShellRunner(cwd)

  return {
    ci: createCiAdapter(shell),
    codeRabbit: createCodeRabbitAdapter(shell),
    git: createGitAdapter(shell),
    github: createGitHubAdapter(shell),
    sandcastle: createSandcastleAdapter(cwd, shell),
    state: createRunStateAdapter(cwd),
    verification: createVerificationAdapter(shell),
  }
}

const createShellRunner =
  (defaultCwd: string) =>
  async (input: ShellCommandInput): Promise<ShellCommandResult> => {
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
  shell: (input: ShellCommandInput) => Promise<ShellCommandResult>,
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
  shell: (input: ShellCommandInput) => Promise<ShellCommandResult>,
): PrdOrchestratorLiveAdapters['git'] => ({
  applyWorkerDiff: async (input: ApplyWorkerDiffInput): Promise<void> => {
    await shell({
      args: ['checkout', input.prdBranchName],
      command: 'git',
    })
    await shell({
      args: ['merge', '--squash', '--no-commit', input.workerBranchName],
      command: 'git',
    })
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
})

const createSandcastleAdapter = (
  cwd: string,
  shell: (input: ShellCommandInput) => Promise<ShellCommandResult>,
): PrdOrchestratorLiveAdapters['sandcastle'] => ({
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
        cliOverrides: {},
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
      agent: codex(process.env.CV_MAXXING_PRD_ORCHESTRATOR_CODEX_MODEL ?? 'gpt-5.5', {
        effort: parseCodexEffort(process.env.CV_MAXXING_PRD_ORCHESTRATOR_CODEX_EFFORT),
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
      changedFiles: changedFiles.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      stdout: result.stdout,
      workerBranchName: result.branch,
    }
  },
})

const createVerificationAdapter = (
  shell: (input: ShellCommandInput) => Promise<ShellCommandResult>,
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
  shell: (input: ShellCommandInput) => Promise<ShellCommandResult>,
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
    const pullRequest = await shell({
      args: ['pr', 'view', String(input.prNumber), '--json', 'reviews'],
      command: 'gh',
    })
    const findings = parseCodeRabbitFindings(pullRequest.stdout)

    return {
      findings,
      status: findings.length === 0 ? 'passed' : 'findings',
    }
  },
})

const createCiAdapter = (
  shell: (input: ShellCommandInput) => Promise<ShellCommandResult>,
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

const createRunStateAdapter = (cwd: string): PrdOrchestratorLiveAdapters['state'] => ({
  cleanup: async (): Promise<CleanupPlan> => {
    const nowEpochMs = Date.now()
    const artifacts = await discoverCleanupArtifacts(cwd)
    const plan = createCleanupPlanFromArtifacts({
      activeRunIds: [latestRunId],
      artifacts,
      nowEpochMs,
      retentionDays: 7,
    })

    await Promise.all(
      plan.remove.map((artifactPath) =>
        rm(path.join(cwd, artifactPath), {
          force: true,
          recursive: true,
        }),
      ),
    )

    return plan
  },
  readRunStatus: async (): Promise<RunStatus> => {
    try {
      const content = await readFile(
        path.join(cwd, runStateRoot, latestRunId, statusFileName),
        'utf8',
      )

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
  recordRunStatus: async (statusValue: RunStatus): Promise<void> => {
    const runDirectory = path.join(cwd, runStateRoot, latestRunId)

    await mkdir(runDirectory, {
      recursive: true,
    })
    await writeFile(
      path.join(runDirectory, statusFileName),
      JSON.stringify(statusValue, null, 2),
      'utf8',
    )
  },
})

const viewPullRequestByHead = async (
  shell: (input: ShellCommandInput) => Promise<ShellCommandResult>,
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

const discoverCleanupArtifacts = async (cwd: string): Promise<readonly CleanupArtifact[]> => {
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

  return artifactGroups.flat()
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

const parseCodeRabbitFindings = (content: string): readonly CodeRabbitFinding[] => {
  const pullRequest = parseJsonRecord(content)
  const reviews = pullRequest.reviews

  if (!Array.isArray(reviews)) {
    return []
  }

  return reviews.flatMap((review, index): readonly CodeRabbitFinding[] => {
    if (!isRecord(review)) {
      return []
    }

    const author = review.author
    const authorLogin = isRecord(author) ? parseOptionalStringField(author, 'login') : undefined
    const state = parseOptionalStringField(review, 'state')

    if (
      authorLogin?.toLowerCase().includes('coderabbit') !== true ||
      state !== 'CHANGES_REQUESTED'
    ) {
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
  })
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
