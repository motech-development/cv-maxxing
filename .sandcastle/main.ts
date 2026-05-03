export const MAX_ITERATIONS = 10
export const MAX_PARALLEL_CHILDREN = 4

export const PLANNER_PROMPT_FILE = '.sandcastle/prompts/plan-prd.md'
export const IMPLEMENT_PROMPT_FILE = '.sandcastle/prompts/implement-child.md'
export const REVIEW_PROMPT_FILE = '.sandcastle/prompts/review-child.md'
export const MERGE_PROMPT_FILE = '.sandcastle/prompts/merge-children.md'

export const COMPLETION_SIGNAL = '</task>'
export const PLAN_START_SIGNAL = '<plan>'
export const PLAN_END_SIGNAL = '</plan>'
export const PLAN_SIGNAL = PLAN_END_SIGNAL
export const NO_WORK_SIGNAL = '</no-work>'

export interface PlannedIssue {
  readonly number: number
  readonly title: string
  readonly branchName: string
}

export interface PlannerPlan {
  readonly parentIssue: PlannedIssue
  readonly children: readonly PlannedIssue[]
}

export type PlannerOutput =
  | {
      readonly kind: 'plan'
      readonly plan: PlannerPlan
    }
  | {
      readonly kind: 'no-work'
    }

export const createPrdBranchName = (issueNumber: number, title: string): string =>
  `prd-${String(issueNumber)}-${slugify(title)}`

export const createChildBranchName = (issueNumber: number, title: string): string =>
  `child-${String(issueNumber)}-${slugify(title)}`

export const parsePlannerOutput = (output: string): PlannerOutput => {
  if (output.includes(NO_WORK_SIGNAL)) {
    return {
      kind: 'no-work',
    }
  }

  const payload = extractPlannerPayload(output)
  const parsed: unknown = JSON.parse(payload)

  return {
    kind: 'plan',
    plan: parsePlannerPlan(parsed),
  }
}

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replaceAll(/^-+|-+$/g, '')

  return slug.length > 0 ? slug : 'task'
}

const extractPlannerPayload = (output: string): string => {
  const startIndex = output.indexOf(PLAN_START_SIGNAL)
  const endIndex = output.indexOf(PLAN_END_SIGNAL)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Planner output must include a JSON payload between plan tags.')
  }

  return output.slice(startIndex + PLAN_START_SIGNAL.length, endIndex).trim()
}

const parsePlannerPlan = (value: unknown): PlannerPlan => {
  if (!isRecord(value)) {
    throw new Error('Planner output must be a JSON object.')
  }

  const parentIssue = parsePlannedIssue(value.parentIssue, 'parentIssue')
  const children = parsePlannedIssueList(value.children)

  return {
    parentIssue,
    children,
  }
}

const parsePlannedIssueList = (value: unknown): readonly PlannedIssue[] => {
  if (!Array.isArray(value)) {
    throw new TypeError('Planner output must include a children array.')
  }

  return value.map((child) => parsePlannedIssue(child, 'children[]'))
}

const parsePlannedIssue = (value: unknown, label: string): PlannedIssue => {
  if (!isRecord(value)) {
    throw new Error(`Planner output field ${label} must be an object.`)
  }

  const issueNumber = value.number
  const title = value.title
  const branchName = value.branchName

  if (typeof issueNumber !== 'number' || !Number.isInteger(issueNumber)) {
    throw new TypeError(`Planner output field ${label}.number must be an integer.`)
  }

  if (typeof title !== 'string' || title.length === 0) {
    throw new TypeError(`Planner output field ${label}.title must be a string.`)
  }

  if (typeof branchName !== 'string' || branchName.length === 0) {
    throw new TypeError(`Planner output field ${label}.branchName must be a string.`)
  }

  if (branchName.includes('agent/prd-orchestrator')) {
    throw new Error('Planner output must not use old PRD orchestrator branch naming.')
  }

  return {
    number: issueNumber,
    title,
    branchName,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const main = (): void => {
  console.info('Sandcastle PRD workflow scaffold is installed.')
  console.info('Planner, implementer, reviewer, and merger phases land in child slices.')
}

if (process.argv[1]?.endsWith('/.sandcastle/main.ts') === true) {
  main()
}
