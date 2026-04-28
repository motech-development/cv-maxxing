import type { SandboxProvider } from '@ai-hero/sandcastle'
import { describe, expect, it } from 'vitest'

import {
  buildImpactAnalysisPrompt,
  buildSandcastleImpactAnalysisOptions,
  createCodexImpactAnalysisConfig,
  createSandcastleImpactAnalysisRunOptions,
  parseImpactAnalysisResult,
  validateCredentialIsolation,
  validateSandcastleBranchStrategy,
} from '../index.js'

const workerInput = {
  architectureDesignConstraints:
    'No required web backend. No telemetry. No MUI or Redux. PDF-only exports.',
  assignedChildTaskBody: `## What to build

Wire Sandcastle Docker impact analysis.

## Acceptance criteria

- [ ] Impact analysis returns expected files/modules, design files, tests, shared contracts, and risk level.
`,
  childIssueNumber: 85,
  parentPrdBody: '## Solution\n\nBuild a repo-level PRD orchestrator.',
  prdIssueNumber: 80,
  repoInstructions: 'Use pnpm, TypeScript ES modules, and colocated Vitest tests.',
  siblingSummaries: [
    {
      issueNumber: 83,
      status: 'complete',
      summary: 'Draft PR state and merge instructions are implemented.',
    },
    {
      issueNumber: 84,
      status: 'complete',
      summary: 'Run preflight, lock, status, and cleanup guardrails are implemented.',
    },
  ],
} as const

describe('Sandcastle impact analysis adapter planning', () => {
  it('uses Codex defaults with environment and CLI overrides', () => {
    expect(
      createCodexImpactAnalysisConfig({
        cliEffort: undefined,
        cliModel: undefined,
        env: {},
      }),
    ).toEqual({
      effort: 'high',
      env: {},
      model: 'gpt-5.5',
      provider: 'codex',
    })

    expect(
      createCodexImpactAnalysisConfig({
        cliEffort: 'xhigh',
        cliModel: 'gpt-5.4',
        env: {
          CV_MAXXING_PRD_ORCHESTRATOR_CODEX_EFFORT: 'medium',
          CV_MAXXING_PRD_ORCHESTRATOR_CODEX_MODEL: 'gpt-5.4-mini',
        },
      }),
    ).toMatchObject({
      effort: 'xhigh',
      model: 'gpt-5.4',
    })
  })

  it('forbids Sandcastle head branch strategy and requires explicit local branches', () => {
    expect(() => validateSandcastleBranchStrategy({ type: 'head' })).toThrow(
      'Sandcastle head branch strategy is forbidden',
    )
    expect(
      validateSandcastleBranchStrategy({ branch: 'agent/prd-80-child-85-impact', type: 'branch' }),
    ).toEqual({
      branch: 'agent/prd-80-child-85-impact',
      type: 'branch',
    })
  })

  it('constructs Docker/Codex Sandcastle options behind an adapter boundary', () => {
    const sandboxProvider: SandboxProvider = {
      create: () => Promise.reject(new Error('sandbox provider stub should not create a sandbox')),
      env: {},
      name: 'docker',
      sandboxHomedir: '/home/agent',
      tag: 'bind-mount',
    }
    const input = {
      ...workerInput,
      cacheInputs: {
        packageManager: 'pnpm',
      },
      cliOverrides: {},
      env: {},
      sandboxBranchName: 'agent/prd-80-child-85-impact',
    } as const
    const options = buildSandcastleImpactAnalysisOptions(input)
    const runOptions = createSandcastleImpactAnalysisRunOptions(input, {
      createSandboxProvider: (sandboxOptions) => {
        expect(sandboxOptions).toEqual({
          env: {},
          mounts: [
            {
              hostPath: '~/.local/share/pnpm/store',
              readonly: false,
              sandboxPath: '/home/agent/.local/share/pnpm/store',
            },
          ],
        })

        return sandboxProvider
      },
    })

    expect({
      ...options,
      prompt: '<checked separately>',
    }).toEqual({
      agent: {
        effort: 'high',
        env: {},
        model: 'gpt-5.5',
        provider: 'codex',
      },
      branchStrategy: {
        branch: 'agent/prd-80-child-85-impact',
        pushToRemote: false,
        type: 'branch',
      },
      maxIterations: 1,
      prompt: '<checked separately>',
      sandbox: {
        env: {},
        mounts: [
          {
            hostPath: '~/.local/share/pnpm/store',
            readonly: false,
            sandboxPath: '/home/agent/.local/share/pnpm/store',
          },
        ],
        provider: 'docker',
      },
    })
    expect(options.prompt).toContain('## Parent PRD')
    expect(runOptions.agent.name).toBe('codex')
    expect(
      runOptions.agent.buildPrintCommand({
        dangerouslySkipPermissions: true,
        prompt: options.prompt,
      }).command,
    ).toContain('model_reasoning_effort="high"')
    expect(runOptions.sandbox.name).toBe('docker')
    expect(runOptions.sandbox.tag).toBe('bind-mount')
    expect(runOptions.branchStrategy).toEqual({
      branch: 'agent/prd-80-child-85-impact',
      type: 'branch',
    })
  })

  it('passes parent PRD, assigned child, siblings, repo instructions, and constraints into the prompt', () => {
    const prompt = buildImpactAnalysisPrompt(workerInput)

    expect(prompt).toContain('## Parent PRD\n\n## Solution')
    expect(prompt).toContain('## Assigned Child Task\n\n## What to build')
    expect(prompt).toContain('#83 complete: Draft PR state and merge instructions are implemented.')
    expect(prompt).toContain('Use pnpm, TypeScript ES modules, and colocated Vitest tests.')
    expect(prompt).toContain('No required web backend. No telemetry. No MUI or Redux.')
    expect(prompt).toContain(
      'Do not request or use GitHub tokens, SSH keys, or remote push credentials.',
    )
  })

  it('rejects broad home, GitHub token, and SSH key mounts or worker env credentials', () => {
    expect(
      validateCredentialIsolation({
        agentEnv: {},
        mounts: [
          {
            hostPath: '~/.codex',
            readonly: true,
            sandboxPath: '/home/agent/.codex',
          },
        ],
        sandboxEnv: {},
      }),
    ).toEqual({
      safe: true,
      violations: [],
    })

    expect(
      validateCredentialIsolation({
        agentEnv: {
          GITHUB_TOKEN: 'ghp_secret',
        },
        mounts: [
          {
            hostPath: '~/.ssh/id_rsa',
            readonly: true,
            sandboxPath: '/home/agent/.ssh',
          },
        ],
        sandboxEnv: {},
      }),
    ).toEqual({
      safe: false,
      violations: [
        'agent env contains forbidden credential key GITHUB_TOKEN',
        'mount ~/.ssh/id_rsa is forbidden because it may expose credentials',
      ],
    })
  })

  it('parses impact-analysis JSON into expected write surfaces and risk level', () => {
    expect(
      parseImpactAnalysisResult(`{
        "expectedFiles": ["tools/prd-orchestrator/src/sandcastle-impact-analysis.ts"],
        "expectedModules": ["@cv-maxxing/prd-orchestrator"],
        "designFiles": [".sandcastle/prompts/impact-analysis.md"],
        "tests": ["tools/prd-orchestrator/src/__tests__/sandcastle-impact-analysis.test.ts"],
        "sharedContracts": ["SandcastleImpactAnalysisResult"],
        "riskLevel": "medium"
      }`),
    ).toEqual({
      designFiles: ['.sandcastle/prompts/impact-analysis.md'],
      expectedFiles: ['tools/prd-orchestrator/src/sandcastle-impact-analysis.ts'],
      expectedModules: ['@cv-maxxing/prd-orchestrator'],
      riskLevel: 'medium',
      sharedContracts: ['SandcastleImpactAnalysisResult'],
      tests: ['tools/prd-orchestrator/src/__tests__/sandcastle-impact-analysis.test.ts'],
    })
  })
})
