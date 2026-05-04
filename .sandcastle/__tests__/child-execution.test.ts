import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  IMPLEMENT_PROMPT_FILE,
  MAX_PARALLEL_CHILDREN,
  REVIEW_PROMPT_FILE,
  executeChildTask,
  runPlannedChildTasks,
  type ChildTaskPromptRunner,
  type PlannerPlan,
  type PlannedIssue,
} from '../main.js'

const parentIssue: PlannedIssue = {
  branchName: 'prd-100-automate-prd-issue-workflow',
  number: 100,
  title: 'PRD: Automate PRD issue workflow',
}

const createChild = (number: number): PlannedIssue => ({
  branchName: `child-${String(number)}-task-${String(number)}`,
  number,
  title: `Task ${String(number)}`,
})

const createPlan = (children: readonly PlannedIssue[]): PlannerPlan => ({
  children,
  parentIssue,
})

const failSandcastleWorker: ChildTaskPromptRunner = () =>
  Promise.reject(new Error('Sandcastle worker failed'))

const failReviewAfterImplementation: ChildTaskPromptRunner = ({ taskKind }) => {
  if (taskKind === 'review') {
    return Promise.reject(new Error('Review failed'))
  }

  return Promise.resolve({
    branchName: 'child-121-run-sandcastle-implementer',
    commits: [{ sha: 'implementation' }],
    logFilePath: 'implementation.log',
  })
}

describe('runPlannedChildTasks', () => {
  it('runs planned children with the bounded parallelism limit', async () => {
    let activeChildren = 0
    let maxActiveChildren = 0
    const children = Array.from({ length: MAX_PARALLEL_CHILDREN + 2 }, (_, index) =>
      createChild(index + 1),
    )

    const results = await runPlannedChildTasks({
      executeChild: async ({ child }) => {
        activeChildren += 1
        maxActiveChildren = Math.max(maxActiveChildren, activeChildren)
        await Promise.resolve()
        activeChildren -= 1

        return {
          branchName: child.branchName,
          child,
          implementationCommits: [{ sha: `${String(child.number)}-implementation` }],
          logFilePaths: [],
          reviewCommits: [{ sha: `${String(child.number)}-review` }],
          status: 'fulfilled',
        }
      },
      plan: createPlan(children),
    })

    expect(maxActiveChildren).toBe(MAX_PARALLEL_CHILDREN)
    expect(results).toHaveLength(children.length)
  })
})

describe('executeChildTask', () => {
  it('runs the reviewer only after implementation produced commits', async () => {
    const calls: string[] = []
    const runPrompt: ChildTaskPromptRunner = async ({ promptFile }) => {
      calls.push(promptFile)
      await Promise.resolve()

      return {
        branchName: 'child-121-run-sandcastle-implementer',
        commits: [{ sha: `${promptFile}-commit` }],
        logFilePath: `${promptFile}.log`,
      }
    }

    const result = await executeChildTask({
      child: createChild(121),
      parentIssue,
      runPrompt,
    })

    expect(calls).toEqual([IMPLEMENT_PROMPT_FILE, REVIEW_PROMPT_FILE])
    expect(result).toMatchObject({
      branchName: 'child-121-run-sandcastle-implementer',
      status: 'fulfilled',
    })
  })

  it('skips the reviewer when implementation produced no commits', async () => {
    const calls: string[] = []
    const runPrompt: ChildTaskPromptRunner = async ({ promptFile }) => {
      calls.push(promptFile)
      await Promise.resolve()

      return {
        branchName: 'child-121-run-sandcastle-implementer',
        commits: [],
        logFilePath: `${promptFile}.log`,
      }
    }

    const result = await executeChildTask({
      child: createChild(121),
      parentIssue,
      runPrompt,
    })

    expect(calls).toEqual([IMPLEMENT_PROMPT_FILE])
    expect(result).toMatchObject({
      reviewCommits: [],
      status: 'fulfilled',
    })
  })

  it('returns failed child branches with log evidence instead of recovering them', async () => {
    const result = await executeChildTask({
      child: createChild(121),
      parentIssue,
      runPrompt: failSandcastleWorker,
    })

    expect(result).toEqual({
      branchName: 'child-121-task-121',
      child: createChild(121),
      error: 'Sandcastle worker failed',
      logFilePaths: [],
      status: 'failed',
    })
  })

  it('preserves implementation logs when review fails', async () => {
    const result = await executeChildTask({
      child: createChild(121),
      parentIssue,
      runPrompt: failReviewAfterImplementation,
    })

    expect(result).toEqual({
      branchName: 'child-121-task-121',
      child: createChild(121),
      error: 'Review failed',
      logFilePaths: ['implementation.log'],
      status: 'failed',
    })
  })
})

describe('child execution prompt contracts', () => {
  it('documents implementation and review behavior without history rewriting', async () => {
    const implementPrompt = await readFile(IMPLEMENT_PROMPT_FILE, 'utf8')
    const reviewPrompt = await readFile(REVIEW_PROMPT_FILE, 'utf8')
    const combinedPrompts = `${implementPrompt}\n${reviewPrompt}`

    expect(implementPrompt).toContain('gh issue view {{CHILD_ISSUE_NUMBER}}')
    expect(implementPrompt).toContain('gh issue view {{PARENT_ISSUE_NUMBER}}')
    expect(implementPrompt).toContain('pnpm')
    expect(implementPrompt).toContain('linting, type-checking, and relevant tests')
    expect(implementPrompt).toContain('Follow TDD')
    expect(implementPrompt).toContain('coderabbit review --agent')
    expect(implementPrompt).toContain('Do not skip git hooks')
    expect(reviewPrompt).toContain('Parent branch: {{PARENT_BRANCH_NAME}}')
    expect(reviewPrompt).toContain('git diff {{PARENT_BRANCH_NAME}}..HEAD')
    expect(reviewPrompt).not.toContain('git diff main..HEAD')
    expect(reviewPrompt).toContain('meaningful tests')
    expect(reviewPrompt).toContain('commit')
    expect(combinedPrompts).not.toContain('git commit --amend')
    expect(combinedPrompts).not.toContain('git rebase')
    expect(combinedPrompts).not.toContain('git checkout HEAD~')
    expect(combinedPrompts).not.toContain('resume')
    expect(combinedPrompts).not.toContain('recovery')
  })
})
