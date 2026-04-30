import { homedir } from 'node:os'
import path from 'node:path'

import { codex } from '@ai-hero/sandcastle'
import type { BranchStrategy, RunOptions } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'
import type { DockerOptions } from '@ai-hero/sandcastle/sandboxes/docker'

export type CodexEffort = 'high' | 'low' | 'medium' | 'xhigh'

export type ImpactRiskLevel = 'high' | 'low' | 'medium'

export interface CodexImpactAnalysisConfigInput {
  readonly cliEffort?: string
  readonly cliModel?: string
  readonly env: Record<string, string | undefined>
}

export interface CodexImpactAnalysisConfig {
  readonly effort: CodexEffort
  readonly env: Record<string, string | undefined>
  readonly model: string
  readonly provider: 'codex'
}

export type SandcastleBranchStrategy =
  | {
      readonly type: 'head'
    }
  | {
      readonly branch: string
      readonly type: 'branch'
    }
  | {
      readonly type: 'merge-to-head'
    }

export interface SafeSandcastleBranchStrategy {
  readonly branch: string
  readonly type: 'branch'
}

export interface DependencyCacheInputs {
  readonly packageManager: 'npm' | 'pnpm' | 'yarn'
}

export interface DockerCacheMount {
  readonly hostPath: string
  readonly readonly: boolean
  readonly sandboxPath: string
}

export interface SiblingTaskSummary {
  readonly issueNumber: number
  readonly status: string
  readonly summary: string
}

export interface ImpactAnalysisPromptInput {
  readonly architectureDesignConstraints: string
  readonly assignedChildTaskBody: string
  readonly childIssueNumber: number
  readonly parentPrdBody: string
  readonly prdIssueNumber: number
  readonly repoInstructions: string
  readonly siblingSummaries: readonly SiblingTaskSummary[]
}

export interface BuildSandcastleImpactAnalysisOptionsInput extends ImpactAnalysisPromptInput {
  readonly cacheInputs: DependencyCacheInputs
  readonly cliOverrides: {
    readonly effort?: string
    readonly model?: string
  }
  readonly env: Record<string, string | undefined>
  readonly sandboxBranchName: string
}

export interface SandcastleImpactAnalysisOptions {
  readonly agent: CodexImpactAnalysisConfig
  readonly branchStrategy: SafeSandcastleBranchStrategy & {
    readonly pushToRemote: false
  }
  readonly maxIterations: 1
  readonly prompt: string
  readonly sandbox: {
    readonly env: Record<string, string | undefined>
    readonly mounts: readonly DockerCacheMount[]
    readonly provider: 'docker'
  }
}

export type SandcastleImpactAnalysisRunOptions = Pick<
  RunOptions,
  'agent' | 'branchStrategy' | 'maxIterations' | 'prompt' | 'sandbox'
>

export interface SandcastleImpactAnalysisAdapterFactories {
  readonly createAgentProvider?: typeof codex
  readonly createSandboxProvider?: (options?: DockerOptions) => RunOptions['sandbox']
}

export interface CredentialIsolationInput {
  readonly agentEnv: Record<string, string | undefined>
  readonly mounts: readonly DockerCacheMount[]
  readonly sandboxEnv: Record<string, string | undefined>
}

export interface CredentialIsolationResult {
  readonly safe: boolean
  readonly violations: readonly string[]
}

export interface SandcastleImpactAnalysisResult {
  readonly designFiles: readonly string[]
  readonly expectedFiles: readonly string[]
  readonly expectedModules: readonly string[]
  readonly pencilRequiredDesignFiles?: readonly string[]
  readonly riskLevel: ImpactRiskLevel
  readonly sharedContracts: readonly string[]
  readonly tests: readonly string[]
}

export const defaultCodexModel = 'gpt-5.5'
const defaultCodexEffort = 'high'
const codexModelEnvironmentName = 'CV_MAXXING_PRD_ORCHESTRATOR_CODEX_MODEL'
const codexEffortEnvironmentName = 'CV_MAXXING_PRD_ORCHESTRATOR_CODEX_EFFORT'
const safeCodexEfforts = new Set<CodexEffort>(['high', 'low', 'medium', 'xhigh'])
const forbiddenCredentialKeyPattern =
  /(?:^|_)(?:GITHUB_TOKEN|GH_TOKEN|SSH_AUTH_SOCK|GIT_ASKPASS)(?:$|_)/i
const knownCredentialEnvironmentKeys = [
  'GIT_ASKPASS',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'SSH_AUTH_SOCK',
] as const
const forbiddenHomeCredentialPaths = ['.ssh', '.config/gh', '.git-credentials'] as const

export const createCodexImpactAnalysisConfig = (
  input: CodexImpactAnalysisConfigInput,
): CodexImpactAnalysisConfig => ({
  effort: parseCodexEffort(input.cliEffort ?? input.env[codexEffortEnvironmentName]),
  env: createCredentialStrippingEnvironment(input.env),
  model: input.cliModel ?? input.env[codexModelEnvironmentName] ?? defaultCodexModel,
  provider: 'codex',
})

export const validateSandcastleBranchStrategy = (
  strategy: SandcastleBranchStrategy,
): SafeSandcastleBranchStrategy => {
  if (strategy.type === 'head') {
    throw new Error('Sandcastle head branch strategy is forbidden')
  }

  if (strategy.type === 'merge-to-head') {
    throw new Error('Sandcastle merge-to-head strategy is not allowed for worker runs')
  }

  const normalizedBranch = strategy.branch.trim()

  if (normalizedBranch.length === 0) {
    throw new Error('Sandcastle worker runs require an explicit local branch')
  }

  return {
    branch: normalizedBranch,
    type: 'branch',
  }
}

export const buildSandcastleImpactAnalysisOptions = (
  input: BuildSandcastleImpactAnalysisOptionsInput,
): SandcastleImpactAnalysisOptions => {
  const agent = createCodexImpactAnalysisConfig({
    cliEffort: input.cliOverrides.effort,
    cliModel: input.cliOverrides.model,
    env: input.env,
  })
  const sandbox = {
    env: createCredentialStrippingEnvironment(input.env),
    mounts: detectDependencyCacheMounts(input.cacheInputs),
    provider: 'docker',
  } as const
  const credentialIsolation = validateCredentialIsolation({
    agentEnv: agent.env,
    mounts: sandbox.mounts,
    sandboxEnv: sandbox.env,
  })

  if (!credentialIsolation.safe) {
    throw new Error(credentialIsolation.violations.join('; '))
  }

  return {
    agent,
    branchStrategy: {
      ...validateSandcastleBranchStrategy({
        branch: input.sandboxBranchName,
        type: 'branch',
      }),
      pushToRemote: false,
    },
    maxIterations: 1,
    prompt: buildImpactAnalysisPrompt(input),
    sandbox,
  }
}

export const createSandcastleImpactAnalysisRunOptions = (
  input: BuildSandcastleImpactAnalysisOptionsInput,
  factories: SandcastleImpactAnalysisAdapterFactories = {},
): SandcastleImpactAnalysisRunOptions => {
  const options = buildSandcastleImpactAnalysisOptions(input)
  const createAgentProvider = factories.createAgentProvider ?? codex
  const createSandboxProvider = factories.createSandboxProvider ?? docker

  return {
    agent: createAgentProvider(options.agent.model, {
      effort: options.agent.effort,
      env: toProviderEnvironment(options.agent.env),
    }),
    branchStrategy: toSandcastleBranchStrategy(options.branchStrategy),
    maxIterations: options.maxIterations,
    prompt: options.prompt,
    sandbox: createSandboxProvider({
      env: toProviderEnvironment(options.sandbox.env),
      mounts: options.sandbox.mounts,
    }),
  }
}

export const buildImpactAnalysisPrompt = (input: ImpactAnalysisPromptInput): string =>
  [
    'You are performing read-only impact analysis for one PRD child task.',
    '',
    'Do not implement code. Do not mutate GitHub. Do not request or use GitHub tokens, SSH keys, or remote push credentials.',
    'Treat `.pen` design files as Pencil-required surfaces. When acceptance criteria require design source changes, list `.pen` files in both `designFiles` and `pencilRequiredDesignFiles`.',
    'For `sharedContracts`, return repository file paths, not symbolic contract names.',
    'Return only machine-parseable JSON. Do not wrap it in Markdown.',
    '',
    `Parent PRD issue: #${String(input.prdIssueNumber)}`,
    `Assigned child issue: #${String(input.childIssueNumber)}`,
    '',
    '## Parent PRD',
    '',
    input.parentPrdBody,
    '',
    '## Assigned Child Task',
    '',
    input.assignedChildTaskBody,
    '',
    '## Sibling Summaries',
    '',
    formatSiblingSummaries(input.siblingSummaries),
    '',
    '## Repository Instructions',
    '',
    input.repoInstructions,
    '',
    '## Architecture And Design Constraints',
    '',
    input.architectureDesignConstraints,
    '',
    '## Required JSON Output',
    '',
    [
      '{',
      '  "expectedFiles": ["path/to/file.ts"],',
      '  "expectedModules": ["module-or-package-name"],',
      '  "designFiles": ["design/app.pen"],',
      '  "pencilRequiredDesignFiles": ["design/app.pen"],',
      '  "tests": ["path/to/test.ts"],',
      '  "sharedContracts": ["tools/prd-orchestrator/src/index.ts"],',
      '  "riskLevel": "low|medium|high"',
      '}',
    ].join('\n'),
  ].join('\n')

export const getPencilRequiredDesignFiles = (
  impactAnalysis: SandcastleImpactAnalysisResult,
): readonly string[] =>
  uniqueStrings([
    ...impactAnalysis.designFiles.filter((filePath) => isPencilDesignFile(filePath)),
    ...(impactAnalysis.pencilRequiredDesignFiles ?? []),
  ]).filter((filePath) => isPencilDesignFile(filePath))

export const buildPencilWorkflowRequirementSection = (
  impactAnalysis: SandcastleImpactAnalysisResult,
): string => {
  const pencilRequiredDesignFiles = getPencilRequiredDesignFiles(impactAnalysis)

  if (pencilRequiredDesignFiles.length === 0) {
    return 'No Pencil workflow is required for this child task.'
  }

  return [
    'Required Pencil workflow:',
    `- Inspect and edit these \`.pen\` design sources with Pencil: ${pencilRequiredDesignFiles.join(
      ', ',
    )}.`,
    '- Save the active Pencil/VS Code editor before reporting completion.',
    `- Capture Pencil screenshot evidence for these \`.pen\` design sources: ${pencilRequiredDesignFiles.join(
      ', ',
    )}.`,
  ].join('\n')
}

export const validateCredentialIsolation = (
  input: CredentialIsolationInput,
): CredentialIsolationResult => {
  const envViolations = [
    ...formatForbiddenCredentialEnvironmentViolations('agent env', input.agentEnv),
    ...formatForbiddenCredentialEnvironmentViolations('sandbox env', input.sandboxEnv),
  ]
  const mountViolations = input.mounts
    .filter((mount) => isForbiddenMount(mount.hostPath))
    .map((mount) => `mount ${mount.hostPath} is forbidden because it may expose credentials`)
  const violations = [...envViolations, ...mountViolations]

  return {
    safe: violations.length === 0,
    violations,
  }
}

export const parseImpactAnalysisResult = (content: string): SandcastleImpactAnalysisResult => {
  const parsedContent: unknown = JSON.parse(content)

  if (!isRecord(parsedContent)) {
    throw new TypeError('Impact analysis result must be a JSON object')
  }

  const designFiles = parseStringArray(parsedContent.designFiles, 'designFiles')
  const pencilRequiredDesignFiles = parseOptionalStringArray(
    parsedContent.pencilRequiredDesignFiles,
    'pencilRequiredDesignFiles',
  )

  return {
    designFiles,
    expectedFiles: parseStringArray(parsedContent.expectedFiles, 'expectedFiles'),
    expectedModules: parseStringArray(parsedContent.expectedModules, 'expectedModules'),
    ...(pencilRequiredDesignFiles === undefined
      ? {}
      : {
          pencilRequiredDesignFiles,
        }),
    riskLevel: parseRiskLevel(parsedContent.riskLevel),
    sharedContracts: parseStringArray(parsedContent.sharedContracts, 'sharedContracts'),
    tests: parseStringArray(parsedContent.tests, 'tests'),
  }
}

const detectDependencyCacheMounts = (input: DependencyCacheInputs): readonly DockerCacheMount[] => {
  if (input.packageManager === 'pnpm') {
    return [
      {
        hostPath: '~/.local/share/pnpm/store',
        readonly: false,
        sandboxPath: '/home/agent/.local/share/pnpm/store',
      },
    ]
  }

  if (input.packageManager === 'npm') {
    return [
      {
        hostPath: '~/.npm',
        readonly: false,
        sandboxPath: '/home/agent/.npm',
      },
    ]
  }

  return [
    {
      hostPath: '~/.cache/yarn',
      readonly: false,
      sandboxPath: '/home/agent/.cache/yarn',
    },
  ]
}

const formatSiblingSummaries = (siblings: readonly SiblingTaskSummary[]): string =>
  siblings.length === 0
    ? 'None.'
    : siblings
        .map((sibling) => `#${String(sibling.issueNumber)} ${sibling.status}: ${sibling.summary}`)
        .join('\n')

const parseCodexEffort = (effort: string | undefined): CodexEffort => {
  const normalizedEffort = effort?.trim()

  if (normalizedEffort === undefined || normalizedEffort.length === 0) {
    return defaultCodexEffort
  }

  if (safeCodexEfforts.has(normalizedEffort as CodexEffort)) {
    return normalizedEffort as CodexEffort
  }

  throw new Error(`Unsupported Codex effort ${normalizedEffort}`)
}

const formatForbiddenCredentialEnvironmentViolations = (
  label: string,
  env: Record<string, string | undefined>,
): readonly string[] =>
  Object.entries(env)
    .filter(([key, value]) => value !== undefined && forbiddenCredentialKeyPattern.test(key))
    .map(([key]) => `${label} contains forbidden credential key ${key}`)

const createCredentialStrippingEnvironment = (
  env: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  const inheritedCredentialEnvironment = Object.fromEntries(
    Object.keys(env)
      .filter((key) => forbiddenCredentialKeyPattern.test(key))
      .map((key) => [key, undefined]),
  )
  const knownCredentialEnvironment = Object.fromEntries(
    knownCredentialEnvironmentKeys.map((key) => [key, undefined]),
  )

  return {
    ...knownCredentialEnvironment,
    ...inheritedCredentialEnvironment,
  }
}

const isForbiddenMount = (hostPath: string): boolean => {
  const homeDirectory = path.normalize(homedir())
  const resolvedHostPath = resolveHomePath(hostPath, homeDirectory)

  if (resolvedHostPath === homeDirectory) {
    return true
  }

  const relativeHostPath = path.relative(homeDirectory, resolvedHostPath)
  const insideHome =
    relativeHostPath.length > 0 &&
    !relativeHostPath.startsWith('..') &&
    !path.isAbsolute(relativeHostPath)

  if (!insideHome) {
    return false
  }

  const normalizedRelativeHostPath = relativeHostPath.replaceAll('\\', '/').toLowerCase()

  return forbiddenHomeCredentialPaths.some((forbiddenPath) => {
    const normalizedForbiddenPath = forbiddenPath.toLowerCase()

    return (
      normalizedRelativeHostPath === normalizedForbiddenPath ||
      normalizedRelativeHostPath.startsWith(`${normalizedForbiddenPath}/`)
    )
  })
}

const resolveHomePath = (hostPath: string, homeDirectory: string): string => {
  if (hostPath === '~' || hostPath === '~/') {
    return homeDirectory
  }

  if (hostPath.startsWith('~/')) {
    return path.normalize(path.join(homeDirectory, hostPath.slice(2)))
  }

  return path.normalize(hostPath)
}

const toSandcastleBranchStrategy = (
  strategy: SandcastleImpactAnalysisOptions['branchStrategy'],
): BranchStrategy => ({
  branch: strategy.branch,
  type: strategy.type,
})

const toProviderEnvironment = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseStringArray = (value: unknown, fieldName: string): readonly string[] => {
  if (!isStringArray(value)) {
    throw new TypeError(`Impact analysis field ${fieldName} must be a string array`)
  }

  return value
}

const parseOptionalStringArray = (
  value: unknown,
  fieldName: string,
): readonly string[] | undefined => {
  if (value === undefined) {
    return undefined
  }

  return parseStringArray(value, fieldName)
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const parseRiskLevel = (value: unknown): ImpactRiskLevel => {
  if (value === 'high' || value === 'low' || value === 'medium') {
    return value
  }

  throw new TypeError('Impact analysis field riskLevel must be low, medium, or high')
}

const isPencilDesignFile = (filePath: string): boolean => filePath.endsWith('.pen')

const uniqueStrings = (items: readonly string[]): readonly string[] => [...new Set(items)]
