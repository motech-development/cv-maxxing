import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  MERGE_PROMPT_FILE,
  collectCompletedChildBranches,
  runMergeCompletedBranches,
  type ChildTaskExecutionResult,
  type MergePromptRunner,
  type PlannerPlan,
  type PlannedIssue,
} from '../main.js'

const parentIssue: PlannedIssue = {
  branchName: 'prd-117-replace-prd-orchestrator',
  number: 117,
  title: 'PRD: Replace PRD orchestrator with Sandcastle-native workflow',
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

const fulfilledChild = (
  child: PlannedIssue,
  implementationCommits: readonly { readonly sha: string }[],
  reviewCommits: readonly { readonly sha: string }[] = [],
): ChildTaskExecutionResult => ({
  branchName: child.branchName,
  child,
  implementationCommits,
  logFilePaths: [],
  reviewCommits,
  status: 'fulfilled',
})

const failedChild = (child: PlannedIssue): ChildTaskExecutionResult => ({
  branchName: child.branchName,
  child,
  error: 'failed',
  logFilePaths: [],
  status: 'failed',
})

describe('collectCompletedChildBranches', () => {
  it('keeps only fulfilled child branches that produced commits', () => {
    const withCommits = createChild(122)
    const withReviewCommits = createChild(125)
    const withoutCommits = createChild(123)
    const failed = createChild(124)

    expect(
      collectCompletedChildBranches([
        fulfilledChild(withCommits, [{ sha: 'implementation' }]),
        fulfilledChild(withReviewCommits, [], [{ sha: 'review' }]),
        fulfilledChild(withoutCommits, []),
        failedChild(failed),
      ]),
    ).toEqual([
      {
        branchName: withCommits.branchName,
        issue: withCommits,
      },
      {
        branchName: withReviewCommits.branchName,
        issue: withReviewCommits,
      },
    ])
  })
})

describe('runMergeCompletedBranches', () => {
  it('skips merge when no child branches produced commits', async () => {
    const calls: string[] = []
    const result = await runMergeCompletedBranches({
      childResults: [fulfilledChild(createChild(122), [])],
      plan: createPlan([createChild(122)]),
      runMergePrompt: async ({ promptFile }) => {
        calls.push(promptFile)
        await Promise.resolve()

        return {
          branchName: parentIssue.branchName,
          logFilePath: 'merge.log',
        }
      },
    })

    expect(calls).toEqual([])
    expect(result).toEqual({
      completedBranches: [],
      status: 'skipped',
    })
  })

  it('passes completed branch and issue lists to the merger prompt', async () => {
    const child = createChild(122)
    let receivedPromptFile = ''
    let receivedPromptArguments: Record<string, string | number | boolean> = {}
    const runMergePrompt: MergePromptRunner = async ({ promptArgs, promptFile }) => {
      receivedPromptFile = promptFile
      receivedPromptArguments = promptArgs
      await Promise.resolve()

      return {
        branchName: parentIssue.branchName,
        logFilePath: 'merge.log',
      }
    }

    const result = await runMergeCompletedBranches({
      childResults: [fulfilledChild(child, [{ sha: 'implementation' }])],
      plan: createPlan([child]),
      runMergePrompt,
    })

    expect(receivedPromptFile).toBe(MERGE_PROMPT_FILE)
    expect(JSON.parse(String(receivedPromptArguments.COMPLETED_BRANCHES))).toEqual([
      child.branchName,
    ])
    expect(JSON.parse(String(receivedPromptArguments.CHILD_ISSUES))).toEqual([
      {
        number: child.number,
        title: child.title,
      },
    ])
    expect(result).toEqual({
      branchName: parentIssue.branchName,
      completedBranches: [
        {
          branchName: child.branchName,
          issue: child,
        },
      ],
      logFilePath: 'merge.log',
      status: 'merged',
    })
  })
})

describe('merger prompt contract', () => {
  it('uses normal git merges and conflict handling without patching or rewriting history', async () => {
    const prompt = await readFile(MERGE_PROMPT_FILE, 'utf8')

    expect(prompt).toContain('course-video-manager')
    expect(prompt).toContain('{{COMPLETED_BRANCHES}}')
    expect(prompt).toContain('{{CHILD_ISSUES}}')
    expect(prompt).toContain('git merge')
    expect(prompt).toContain('merge conflicts')
    expect(prompt).not.toContain('git apply')
    expect(prompt).not.toContain('git commit --amend')
    expect(prompt).not.toContain('git rebase')
  })
})
