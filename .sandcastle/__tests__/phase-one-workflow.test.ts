import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  IMPLEMENT_PROMPT_FILE,
  MERGE_PROMPT_FILE,
  PLANNER_PROMPT_FILE,
  REVIEW_PROMPT_FILE,
  runPhaseOneDryRun,
} from '../main.js'

const packageManifestPaths = ['package.json', 'apps/desktop/package.json'] as const
const runtimeWorkflowFiles = [
  '.sandcastle/main.ts',
  PLANNER_PROMPT_FILE,
  IMPLEMENT_PROMPT_FILE,
  REVIEW_PROMPT_FILE,
  MERGE_PROMPT_FILE,
] as const

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
