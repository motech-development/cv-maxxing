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
  branchName: 'prd-100-automate-prd-issue-workflow',
  number: 100,
  title: 'PRD: Automate PRD issue workflow',
}

const childIssue: PlannedIssue = {
  branchName: 'child-101-create-draft-pr',
  number: 101,
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
      'branch:prd-100-automate-prd-issue-workflow',
      'find:prd-100-automate-prd-issue-workflow',
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
    expect(createInput?.body).toContain('#100')
    expect(createInput?.body).toContain('#101')
    expect(createInput?.body).toContain('child-101-create-draft-pr')
    expect(result).toEqual({
      pullRequest: createdPullRequest,
      status: 'created',
    })
  })
})

describe('createDraftPullRequestBody', () => {
  it('keeps durable GitHub context concise', () => {
    const body = createDraftPullRequestBody({
      completedBranches: [
        {
          branchName: childIssue.branchName,
          issue: childIssue,
        },
      ],
      plan,
    })

    expect(body).toContain('Parent PRD: #100')
    expect(body).toContain('- #101 Create or reuse one draft PR')
    expect(body).toContain('child-101-create-draft-pr')
    expect(body).toContain('Draft: yes')
  })
})
