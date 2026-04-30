import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

import type { SandboxProvider } from '@ai-hero/sandcastle'
import { describe, expect, it } from 'vitest'

import {
  buildImpactAnalysisPrompt,
  buildPencilWorkflowRequirementSection,
  buildSandcastleImpactAnalysisOptions,
  createCodexImpactAnalysisConfig,
  createSandcastleImpactAnalysisRunOptions,
  getPencilRequiredDesignFiles,
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
      env: {
        GIT_ASKPASS: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined,
        SSH_AUTH_SOCK: undefined,
      },
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

    expect(
      createCodexImpactAnalysisConfig({
        cliEffort: ' high ',
        cliModel: undefined,
        env: {},
      }).effort,
    ).toBe('high')
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

  it('normalizes local Sandcastle branch names before returning safe branch strategy', () => {
    expect(
      validateSandcastleBranchStrategy({
        branch: ' agent/prd-80-child-85-impact ',
        type: 'branch',
      }),
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
        cachePath: '/repo/.pnpm-store/v10',
        packageManager: 'pnpm',
      },
      codexCliCredentialMounts: [
        {
          hostPath: '/Users/tester/.codex/auth.json',
          readonly: true,
          sandboxPath: '/home/agent/.codex/auth.json',
        },
      ],
      cliOverrides: {},
      env: {},
      sandboxBranchName: 'agent/prd-80-child-85-impact',
    } as const
    const options = buildSandcastleImpactAnalysisOptions(input)
    const runOptions = createSandcastleImpactAnalysisRunOptions(input, {
      createAgentProvider: (model, agentOptions) => {
        expect(model).toBe('gpt-5.5')
        expect(agentOptions).toStrictEqual({
          effort: 'high',
          env: {},
        })

        return {
          buildPrintCommand: () => ({
            command: 'codex exec --config model_reasoning_effort="high"',
          }),
          captureSessions: false,
          env: {},
          name: 'codex',
          parseStreamLine: () => [],
        }
      },
      createSandboxProvider: (sandboxOptions) => {
        expect(sandboxOptions).toStrictEqual({
          env: {
            npm_config_store_dir: '/home/agent/.pnpm-store/v10',
          },
          mounts: [
            {
              hostPath: '/Users/tester/.codex/auth.json',
              readonly: true,
              sandboxPath: '/home/agent/.codex/auth.json',
            },
            {
              hostPath: '/repo/.pnpm-store/v10',
              readonly: false,
              sandboxPath: '/home/agent/.pnpm-store/v10',
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
        env: {
          GIT_ASKPASS: undefined,
          GITHUB_TOKEN: undefined,
          GH_TOKEN: undefined,
          SSH_AUTH_SOCK: undefined,
        },
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
        env: {
          GIT_ASKPASS: undefined,
          GITHUB_TOKEN: undefined,
          GH_TOKEN: undefined,
          npm_config_store_dir: '/home/agent/.pnpm-store/v10',
          SSH_AUTH_SOCK: undefined,
        },
        mounts: [
          {
            hostPath: '/Users/tester/.codex/auth.json',
            readonly: true,
            sandboxPath: '/home/agent/.codex/auth.json',
          },
          {
            hostPath: '/repo/.pnpm-store/v10',
            readonly: false,
            sandboxPath: '/home/agent/.pnpm-store/v10',
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
    expect(prompt).toContain('Return only machine-parseable JSON. Do not wrap it in Markdown.')
  })

  it('keeps the Sandcastle prompt file aligned with the parser JSON contract', async () => {
    const prompt = await readFile(
      new URL('../../../../.sandcastle/prompts/impact-analysis.md', import.meta.url),
      'utf8',
    )

    expect(prompt).toContain('Return only machine-parseable JSON')
    expect(prompt).toContain('"expectedFiles"')
    expect(prompt).toContain('"expectedModules"')
    expect(prompt).toContain('"designFiles"')
    expect(prompt).toContain('"pencilRequiredDesignFiles"')
    expect(prompt).toContain('"tests"')
    expect(prompt).toContain('"sharedContracts"')
    expect(prompt).toContain('"riskLevel"')
    expect(prompt).not.toContain('"expected_write_surfaces"')
  })

  it('identifies .pen files as Pencil-required impact surfaces', () => {
    const prompt = buildImpactAnalysisPrompt(workerInput)

    expect(prompt).toContain('Treat `.pen` design files as Pencil-required surfaces.')
    expect(prompt).toContain('"pencilRequiredDesignFiles": ["design/app.pen"]')
    expect(prompt).toContain(
      'For `sharedContracts`, return repository file paths, not symbolic contract names.',
    )
    expect(prompt).toContain('"sharedContracts": ["tools/prd-orchestrator/src/index.ts"]')
    expect(
      getPencilRequiredDesignFiles({
        designFiles: ['design/app.pen', 'design/cv.html'],
        expectedFiles: [],
        expectedModules: [],
        riskLevel: 'medium',
        sharedContracts: [],
        tests: [],
      }),
    ).toEqual(['design/app.pen'])
    expect(
      parseImpactAnalysisResult(`{
        "expectedFiles": [],
        "expectedModules": [],
        "designFiles": ["design/app.pen"],
        "pencilRequiredDesignFiles": ["design/app.pen"],
        "tests": [],
        "sharedContracts": [],
        "riskLevel": "medium"
      }`),
    ).toMatchObject({
      pencilRequiredDesignFiles: ['design/app.pen'],
    })
  })

  it('builds Pencil workflow prompt text only when .pen changes are required', () => {
    expect(
      buildPencilWorkflowRequirementSection({
        designFiles: ['design/app.pen'],
        expectedFiles: [],
        expectedModules: [],
        riskLevel: 'medium',
        sharedContracts: [],
        tests: [],
      }),
    ).toContain(
      'Capture Pencil screenshot evidence for these `.pen` design sources: design/app.pen',
    )
    expect(
      buildPencilWorkflowRequirementSection({
        designFiles: ['design/cv.html'],
        expectedFiles: [],
        expectedModules: [],
        riskLevel: 'low',
        sharedContracts: [],
        tests: [],
      }),
    ).toBe('No Pencil workflow is required for this child task.')
  })

  it('rejects broad home, GitHub token, and SSH key mounts or worker env credentials', () => {
    const absoluteSshKeyPath = `${homedir()}/.ssh/id_rsa`

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
          GH_TOKEN: undefined,
        },
        mounts: [
          {
            hostPath: '~/.ssh/id_rsa',
            readonly: true,
            sandboxPath: '/home/agent/.ssh',
          },
          {
            hostPath: '~/.SSH/id_rsa',
            readonly: true,
            sandboxPath: '/home/agent/.ssh-upper',
          },
        ],
        sandboxEnv: {},
      }),
    ).toEqual({
      safe: false,
      violations: [
        'agent env contains forbidden credential key GITHUB_TOKEN',
        'mount ~/.ssh/id_rsa is forbidden because it may expose credentials',
        'mount ~/.SSH/id_rsa is forbidden because it may expose credentials',
      ],
    })

    expect(
      validateCredentialIsolation({
        agentEnv: {},
        mounts: [
          {
            hostPath: '~',
            readonly: true,
            sandboxPath: '/home/agent',
          },
          {
            hostPath: absoluteSshKeyPath,
            readonly: true,
            sandboxPath: '/home/agent/.ssh/id_rsa',
          },
        ],
        sandboxEnv: {},
      }),
    ).toEqual({
      safe: false,
      violations: [
        'mount ~ is forbidden because it may expose credentials',
        `mount ${absoluteSshKeyPath} is forbidden because it may expose credentials`,
      ],
    })
  })

  it('explicitly strips inherited credential variables from Sandcastle environments', () => {
    const options = buildSandcastleImpactAnalysisOptions({
      ...workerInput,
      cacheInputs: {
        cachePath: '/repo/.pnpm-store/v10',
        packageManager: 'pnpm',
      },
      cliOverrides: {},
      env: {
        GITHUB_TOKEN: 'ghp_secret',
        GH_TOKEN: 'ghp_secret',
        SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
      },
      sandboxBranchName: 'agent/prd-80-child-85-impact',
    })

    expect(options.agent.env).toMatchObject({
      GITHUB_TOKEN: undefined,
      GH_TOKEN: undefined,
      SSH_AUTH_SOCK: undefined,
    })
    expect(options.sandbox.env).toMatchObject({
      GITHUB_TOKEN: undefined,
      GH_TOKEN: undefined,
      SSH_AUTH_SOCK: undefined,
    })
  })

  it('omits dependency cache mounts when no dynamic package-manager cache path is available', () => {
    const options = buildSandcastleImpactAnalysisOptions({
      ...workerInput,
      cacheInputs: {
        packageManager: 'pnpm',
      },
      cliOverrides: {},
      env: {},
      sandboxBranchName: 'agent/prd-80-child-85-impact',
    })

    expect(options.sandbox.mounts).toEqual([])
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
