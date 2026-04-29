import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { prdOrchestratorCommands, prdOrchestratorLifecycle } from '../index.js'

interface PackageManifest {
  readonly bin: Record<string, string>
  readonly scripts: Record<string, string>
}

interface RootPackageManifest {
  readonly devDependencies: Record<string, string>
}

describe('PRD orchestrator command scaffold', () => {
  it('exposes the v1 command lifecycle in execution order', () => {
    expect(prdOrchestratorCommands.map((command) => command.name)).toEqual([
      'plan',
      'run --one-child',
      'run',
      'resume-pr <number>',
      'status',
      'cleanup',
    ])
  })

  it('keeps planning and observability commands non-mutating', () => {
    const nonMutatingCommands = prdOrchestratorCommands
      .filter((command) => !command.mutatesRepository)
      .map((command) => command.name)

    expect(nonMutatingCommands).toEqual(['plan', 'status'])
  })

  it('records one draft PR per PRD as the initial lifecycle boundary', () => {
    expect(prdOrchestratorLifecycle).toEqual({
      automationOwner: '@cv-maxxing/prd-orchestrator',
      draftPullRequestPolicy: 'one draft PR per PRD',
      humanMergeBoundary: true,
      runStateRoot: '.git/prd-orchestrator/runs',
    })
  })

  it('makes the compiled CLI discoverable through the documented pnpm exec path', async () => {
    const rootPackageManifest = await readRootPackageManifest()
    const packageManifest = await readPackageManifest()

    expect(rootPackageManifest.devDependencies['@cv-maxxing/prd-orchestrator']).toBe('workspace:*')
    expect(packageManifest.bin).toEqual({
      'prd-orchestrator': './dist/bin.js',
    })
  })

  it('routes package-owned invocation scripts through the packaged CLI entrypoint', async () => {
    const packageManifest = await readPackageManifest()

    expect(packageManifest.scripts['prd-orchestrator']).toBe('node dist/bin.js')
    expect(packageManifest.scripts.plan).toBe('pnpm build && pnpm exec prd-orchestrator plan')
    expect(packageManifest.scripts['run:all']).toBe('pnpm build && pnpm exec prd-orchestrator run')
    expect(packageManifest.scripts['run:one-child']).toBe(
      'pnpm build && pnpm exec prd-orchestrator run --one-child',
    )
    expect(packageManifest.scripts['resume-pr']).toBe(
      'pnpm build && pnpm exec prd-orchestrator resume-pr',
    )
    expect(packageManifest.scripts.status).toBe('pnpm build && pnpm exec prd-orchestrator status')
    expect(packageManifest.scripts.cleanup).toBe('pnpm build && pnpm exec prd-orchestrator cleanup')
  })

  it('documents only verified package-owned command examples', async () => {
    const readme = await readFileText('../../README.md')

    expect(readme).toContain(
      'pnpm --filter @cv-maxxing/prd-orchestrator exec prd-orchestrator plan',
    )
    expect(readme).toContain(
      'pnpm --filter @cv-maxxing/prd-orchestrator exec prd-orchestrator run --one-child',
    )
    expect(readme).toContain('pnpm --filter @cv-maxxing/prd-orchestrator exec prd-orchestrator run')
    expect(readme).toContain(
      'pnpm --filter @cv-maxxing/prd-orchestrator exec prd-orchestrator resume-pr 123',
    )
    expect(readme).toContain(
      'pnpm --filter @cv-maxxing/prd-orchestrator exec prd-orchestrator status',
    )
    expect(readme).toContain(
      'pnpm --filter @cv-maxxing/prd-orchestrator exec prd-orchestrator cleanup',
    )
  })
})

const readPackageManifest = async (): Promise<PackageManifest> => {
  const packageJson = await readFileText('../../package.json')
  const parsedJson: unknown = JSON.parse(packageJson)

  if (
    !isRecord(parsedJson) ||
    !isStringRecord(parsedJson.bin) ||
    !isStringRecord(parsedJson.scripts)
  ) {
    throw new TypeError('Expected package.json to include string-valued bin and scripts.')
  }

  return {
    bin: parsedJson.bin,
    scripts: parsedJson.scripts,
  }
}

const readRootPackageManifest = async (): Promise<RootPackageManifest> => {
  const packageJson = await readFileText('../../../../package.json')
  const parsedJson: unknown = JSON.parse(packageJson)

  if (!isRecord(parsedJson) || !isStringRecord(parsedJson.devDependencies)) {
    throw new TypeError('Expected root package.json to include string-valued devDependencies.')
  }

  return {
    devDependencies: parsedJson.devDependencies,
  }
}

const readFileText = async (relativePath: string): Promise<string> => {
  return await readFile(new URL(relativePath, import.meta.url), 'utf8')
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
