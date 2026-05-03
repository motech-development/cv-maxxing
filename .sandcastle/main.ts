export const MAX_ITERATIONS = 10
export const MAX_PARALLEL_CHILDREN = 4

export const PLANNER_PROMPT_FILE = '.sandcastle/prompts/plan-prd.md'
export const IMPLEMENT_PROMPT_FILE = '.sandcastle/prompts/implement-child.md'
export const REVIEW_PROMPT_FILE = '.sandcastle/prompts/review-child.md'
export const MERGE_PROMPT_FILE = '.sandcastle/prompts/merge-children.md'

export const COMPLETION_SIGNAL = '</task>'
export const PLAN_SIGNAL = '</plan>'
export const NO_WORK_SIGNAL = '</no-work>'

export const createPrdBranchName = (issueNumber: number, title: string): string =>
  `prd-${String(issueNumber)}-${slugify(title)}`

export const createChildBranchName = (issueNumber: number, title: string): string =>
  `child-${String(issueNumber)}-${slugify(title)}`

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replaceAll(/^-+|-+$/g, '')

  return slug.length > 0 ? slug : 'task'
}

const main = (): void => {
  console.info('Sandcastle PRD workflow scaffold is installed.')
  console.info('Planner, implementer, reviewer, and merger phases land in child slices.')
}

main()
