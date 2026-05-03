import { describe, expect, it } from 'vitest'

import {
  createDraftPullRequestBody,
  createOrReusePrdDraftPullRequest,
  type DraftPullRequest,
  type DraftPullRequestGateway,
  type PlannerPlan,
  type PlannedIssue,
} from '../main.js'

const parentIssue: PlannedIssue = {
  branchName: 'prd-117-replace-prd-orchestrator',
  number: 117,
  title: 'PRD: Replace PRD orchestrator with Sandcastle-native workflow',
}

const childIssue: PlannedIssue = {
  branchName: 'child-123-create-draft-pr',
  number: 123,
  title: 'Create or reuse one draft PR for the Sandcastle PRD branch',
}

const plan: PlannerPlan = {
  children: [childIssue],
  parentIssue,
}

const existingPullRequest: DraftPullRequest = {
  isDraft: true,
  number: 12,
  url: 'https://github.com/motech-development/cv-maxxing/pull/12',
}

const createdPullRequest: DraftPullRequest = {
  isDraft: true,
  number: 13,
  url: 'https://github.com/motech-development/cv-maxxing/pull/13',
}

describe('createOrReusePrdDraftPullRequest', () => {
  it('reuses an existing open draft PR for the parent PRD branch', async () => {
    const calls: string[] = []
    const gateway: DraftPullRequestGateway = {
      createDraftPullRequest: async () => {
        calls.push('create')
        await Promise.resolve()

        return createdPullRequest
      },
      ensureParentBranch: async (branchName) => {
        calls.push(`branch:${branchName}`)
        await Promise.resolve()
      },
      findDraftPullRequest: async (branchName) => {
        calls.push(`find:${branchName}`)
        await Promise.resolve()

        return existingPullRequest
      },
    }

    const result = await createOrReusePrdDraftPullRequest({
      gateway,
      plan,
    })

    expect(calls).toEqual([
      'branch:prd-117-replace-prd-orchestrator',
      'find:prd-117-replace-prd-orchestrator',
    ])
    expect(result).toEqual({
      pullRequest: existingPullRequest,
      status: 'reused',
    })
  })

  it('creates one draft PR when none exists for the parent PRD branch', async () => {
    let createInput: Parameters<DraftPullRequestGateway['createDraftPullRequest']>[0] | undefined
    const pullRequests: readonly DraftPullRequest[] = []
    const gateway: DraftPullRequestGateway = {
      createDraftPullRequest: async (input) => {
        createInput = input
        await Promise.resolve()

        return createdPullRequest
      },
      ensureParentBranch: async () => {
        await Promise.resolve()
      },
      findDraftPullRequest: async () => {
        await Promise.resolve()

        return pullRequests.find(({ isDraft }) => isDraft)
      },
    }

    const result = await createOrReusePrdDraftPullRequest({
      completedBranches: [
        {
          branchName: childIssue.branchName,
          issue: childIssue,
        },
      ],
      gateway,
      plan,
    })

    expect(createInput).toMatchObject({
      branchName: parentIssue.branchName,
      draft: true,
      title: parentIssue.title,
    })
    expect(createInput?.body).toContain('#117')
    expect(createInput?.body).toContain('#123')
    expect(createInput?.body).toContain('child-123-create-draft-pr')
    expect(result).toEqual({
      pullRequest: createdPullRequest,
      status: 'created',
    })
  })
})

describe('createDraftPullRequestBody', () => {
  it('keeps durable GitHub context concise without old ledger or audit sections', () => {
    const body = createDraftPullRequestBody({
      completedBranches: [
        {
          branchName: childIssue.branchName,
          issue: childIssue,
        },
      ],
      plan,
    })

    expect(body).toContain('Parent PRD: #117')
    expect(body).toContain('- #123 Create or reuse one draft PR')
    expect(body).toContain('child-123-create-draft-pr')
    expect(body).toContain('Draft: yes')
    expect(body).not.toContain('Closes #')
    expect(body).not.toContain('ledger')
    expect(body).not.toContain('run-state database')
    expect(body).not.toContain('final acceptance audit')
    expect(body).not.toContain('ready for review')
  })
})
