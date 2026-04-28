import {
  createDryRunPlan,
  type DryRunPlan,
  type GitHubIssue,
  renderDryRunPlan,
} from './planning.js'

export interface PrdOrchestratorCliInput {
  readonly arguments_: readonly string[]
  readonly stdin: string
}

export interface PrdOrchestratorCliResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export const runPrdOrchestratorCli = (input: PrdOrchestratorCliInput): PrdOrchestratorCliResult => {
  const [command] = input.arguments_

  if (command !== 'plan') {
    return {
      exitCode: 1,
      stderr: 'Unsupported command. Only read-only `plan` is supported.\n',
      stdout: '',
    }
  }

  return runPlanCommand(input.stdin)
}

const runPlanCommand = (stdin: string): PrdOrchestratorCliResult => {
  const issues = parseIssueJson(stdin)
  const plan = createDryRunPlan(issues)

  return {
    exitCode: plan.selectedPrd === undefined ? 1 : 0,
    stderr: '',
    stdout: `${renderDryRunPlan(plan)}\n`,
  }
}

const parseIssueJson = (stdin: string): readonly GitHubIssue[] => {
  const parsedJson: unknown = JSON.parse(stdin)

  if (Array.isArray(parsedJson)) {
    return parsedJson.map((issue) => parseGitHubIssue(issue))
  }

  if (isRecord(parsedJson) && Array.isArray(parsedJson.issues)) {
    return parsedJson.issues.map((issue) => parseGitHubIssue(issue))
  }

  throw new TypeError('Expected stdin to contain a GitHub issue array or an object with `issues`.')
}

const parseGitHubIssue = (value: unknown): GitHubIssue => {
  if (!isRecord(value)) {
    throw new TypeError('Expected each GitHub issue to be an object.')
  }

  if (
    typeof value.body !== 'string' ||
    typeof value.number !== 'number' ||
    typeof value.state !== 'string' ||
    typeof value.title !== 'string'
  ) {
    throw new TypeError('Expected each GitHub issue to include body, number, state, and title.')
  }

  return {
    body: value.body,
    number: value.number,
    state: value.state,
    title: value.title,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const createPlanFromIssueJson = (issueJson: string): DryRunPlan =>
  createDryRunPlan(parseIssueJson(issueJson))
