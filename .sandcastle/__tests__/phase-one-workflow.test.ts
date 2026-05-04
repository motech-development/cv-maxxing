import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  IMPLEMENT_PROMPT_FILE,
  MERGE_PROMPT_FILE,
  PLANNER_PROMPT_FILE,
  REVIEW_PROMPT_FILE,
  createCodexDockerOptions,
  runPhaseOneWorkflow,
  runPhaseOneDryRun,
  type DraftPullRequestGateway,
  type MergePromptRunner,
  type PlannerOutput,
  type PlannerPlan,
} from '../main.js'

const packageManifestPaths = ['package.json', 'apps/desktop/package.json'] as const
const runtimeWorkflowFiles = [
  '.sandcastle/main.ts',
  PLANNER_PROMPT_FILE,
  IMPLEMENT_PROMPT_FILE,
  REVIEW_PROMPT_FILE,
  MERGE_PROMPT_FILE,
] as const

const parentIssue = {
  branchName: 'prd-117-replace-prd-orchestrator',
  number: 117,
  title: 'PRD: Replace PRD orchestrator with Sandcastle-native workflow',
} satisfies PlannerPlan['parentIssue']

const childIssue = {
  branchName: 'child-124-document-phase-one',
  number: 124,
  title: 'Document and verify the Sandcastle-native Phase 1 workflow',
} satisfies PlannerPlan['children'][number]

const plan: PlannerPlan = {
  children: [childIssue],
  parentIssue,
}

describe('Phase 1 controlled dry run', () => {
  it('exercises planner, implementer, reviewer, merger, and draft PR wiring', async () => {
    const result = await runPhaseOneDryRun()

    expect(result.phases).toEqual(['planner', 'implementer', 'reviewer', 'merger', 'draft-pr'])
    expect(result.plannerOutput.kind).toBe('plan')
    expect(result.childResults).toHaveLength(1)
    expect(result.childResults[0]).toMatchObject({
      status: 'fulfilled',
      implementationCommits: [{ sha: 'dry-run-implementation' }],
      reviewCommits: [{ sha: 'dry-run-review' }],
    })
    expect(result.mergeResult).toMatchObject({
      status: 'merged',
    })
    expect(result.draftPullRequestResult).toMatchObject({
      pullRequest: {
        isDraft: true,
      },
      status: 'created',
    })
  })
})

describe('Codex subscription auth', () => {
  it('defaults Sandcastle agents to gpt-5.5 with high effort', () => {
    expect(DEFAULT_CODEX_MODEL).toBe('gpt-5.5')
    expect(DEFAULT_CODEX_EFFORT).toBe('high')
  })

  it('mounts only the local Codex auth files into a sandbox-local CODEX_HOME', () => {
    const options = createCodexDockerOptions({
      fileExists: (path) =>
        ['/Users/dev/.codex/auth.json', '/Users/dev/.codex/config.toml'].includes(path),
      hostCodexHome: '/Users/dev/.codex',
    })

    expect(options.env).toMatchObject({
      CODEX_HOME: '/home/agent/.codex',
    })
    expect(options.mounts).toEqual([
      {
        hostPath: '/Users/dev/.codex/auth.json',
        readonly: true,
        sandboxPath: '/home/agent/.codex/auth.json',
      },
      {
        hostPath: '/Users/dev/.codex/config.toml',
        readonly: true,
        sandboxPath: '/home/agent/.codex/config.toml',
      },
    ])
  })

  it('fails fast when the host is not logged into Codex locally', () => {
    expect(() =>
      createCodexDockerOptions({
        fileExists: () => false,
        hostCodexHome: '/Users/dev/.codex',
      }),
    ).toThrow('Codex subscription auth requires /Users/dev/.codex/auth.json')
  })

  it('documents subscription auth without requiring an OpenAI API key', async () => {
    const readme = await readFile('.sandcastle/README.md', 'utf8')
    const environmentExample = await readFile('.sandcastle/.env.example', 'utf8')

    expect(readme).toContain('Codex subscription')
    expect(readme).toContain('codex login')
    expect(readme).not.toContain('OPENAI_API_KEY')
    expect(environmentExample).not.toContain('OPENAI_API_KEY')
  })
})

describe('runPhaseOneWorkflow', () => {
  it('runs a bounded planner-driven workflow until the planner reports no work', async () => {
    const calls: string[] = []
    const plannerOutputs: PlannerOutput[] = [
      {
        kind: 'plan',
        plan,
      },
      {
        kind: 'no-work',
      },
    ]
    const existingPullRequests: readonly Awaited<
      ReturnType<DraftPullRequestGateway['findDraftPullRequest']>
    >[] = []
    const runMergePrompt: MergePromptRunner = async () => {
      calls.push('merge')
      await Promise.resolve()

      return {
        branchName: parentIssue.branchName,
      }
    }
    const gateway: DraftPullRequestGateway = {
      createDraftPullRequest: async () => {
        calls.push('create-pr')
        await Promise.resolve()

        return {
          isDraft: true,
          number: 1,
          url: 'https://github.com/motech-development/cv-maxxing/pull/1',
        }
      },
      ensureParentBranch: async () => {
        calls.push('branch')
        await Promise.resolve()
      },
      findDraftPullRequest: async () => {
        calls.push('find-pr')
        await Promise.resolve()

        return existingPullRequests.find((pullRequest) => pullRequest?.isDraft === true)
      },
    }

    const result = await runPhaseOneWorkflow({
      draftPullRequestGateway: gateway,
      executeChild: async ({ child }) => {
        calls.push('child')
        await Promise.resolve()

        return {
          branchName: child.branchName,
          child,
          implementationCommits: [{ sha: 'implementation' }],
          logFilePaths: [],
          reviewCommits: [{ sha: 'review' }],
          status: 'fulfilled',
        }
      },
      maxIterations: 2,
      runMergePrompt,
      runPlanner: async () => {
        calls.push('planner')
        await Promise.resolve()

        const output = plannerOutputs.shift()

        if (output === undefined) {
          throw new Error('Planner was called more times than expected.')
        }

        return output
      },
    })

    expect(calls).toEqual([
      'planner',
      'child',
      'merge',
      'branch',
      'find-pr',
      'create-pr',
      'planner',
    ])
    expect(result).toMatchObject({
      status: 'no-work',
    })
    expect(result.iterations).toHaveLength(1)
    expect(result.iterations[0]?.draftPullRequestResult).toMatchObject({
      status: 'created',
    })
  })

  it('stops before child execution when the planner reports no work immediately', async () => {
    const result = await runPhaseOneWorkflow({
      executeChild: () =>
        Promise.reject(new Error('Child execution should not run without a plan.')),
      runPlanner: async () => {
        await Promise.resolve()

        return {
          kind: 'no-work',
        }
      },
    })

    expect(result).toEqual({
      iterations: [],
      status: 'no-work',
    })
  })
})

describe('Phase 1 repository guardrails', () => {
  it('keeps workspace scripts and dependencies free of the removed orchestrator package', async () => {
    const manifests = await Promise.all(
      packageManifestPaths.map(async (path) => ({
        manifest: parsePackageManifest(await readFile(path, 'utf8')),
        path,
      })),
    )

    for (const { manifest, path } of manifests) {
      expect(Object.values(manifest.scripts ?? {}), path).not.toContain(
        '@cv-maxxing/prd-orchestrator',
      )
      expect(readDependencyNames(manifest), path).not.toContain('@cv-maxxing/prd-orchestrator')
    }
  })

  it('keeps old resume, ledger, and child-commit rewrite concepts out of runtime workflow files', async () => {
    const contents = await Promise.all(
      runtimeWorkflowFiles.map(async (path) => ({
        content: await readFile(path, 'utf8'),
        path,
      })),
    )

    for (const { content, path } of contents) {
      expect(content, path).not.toContain('ledger')
      expect(content, path).not.toContain('run-state')
      expect(content, path).not.toContain('resume')
      expect(content, path).not.toContain('child-commit rewrite')
      expect(content, path).not.toContain('child commit rewrite')
    }
  })
})

interface PackageManifest {
  readonly scripts?: Record<string, string>
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

const parsePackageManifest = (content: string): PackageManifest => {
  const parsed: unknown = JSON.parse(content)

  if (!isRecord(parsed)) {
    throw new TypeError('Package manifest must be a JSON object.')
  }

  return {
    dependencies: parseStringRecord(parsed.dependencies),
    devDependencies: parseStringRecord(parsed.devDependencies),
    optionalDependencies: parseStringRecord(parsed.optionalDependencies),
    peerDependencies: parseStringRecord(parsed.peerDependencies),
    scripts: parseStringRecord(parsed.scripts),
  }
}

const readDependencyNames = ({
  dependencies = {},
  devDependencies = {},
  optionalDependencies = {},
  peerDependencies = {},
}: PackageManifest): readonly string[] => [
  ...Object.keys(dependencies),
  ...Object.keys(devDependencies),
  ...Object.keys(optionalDependencies),
  ...Object.keys(peerDependencies),
]

const parseStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new TypeError('Package manifest field must be an object when present.')
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
