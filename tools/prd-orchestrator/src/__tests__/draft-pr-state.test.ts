import { describe, expect, it } from 'vitest'

import {
  createChildCommitMessage,
  generateDraftPrBody,
  generateMergeInstructions,
  generatePrdConventionalCommitTitle,
  reconcileDraftPrStateFromCommits,
} from '../index.js'

const childTasks = [
  {
    issueNumber: 81,
    title: 'Scaffold the PRD orchestrator workspace package',
  },
  {
    issueNumber: 82,
    title: 'Build PRD and child-task planning from GitHub Markdown',
  },
] as const

describe('PRD draft pull-request state', () => {
  it('generates the PRD-level Conventional Commit title from the PRD issue title', () => {
    expect(
      generatePrdConventionalCommitTitle(
        'PRD: Automate PRD implementation from GitHub child tasks',
      ),
    ).toBe('feat: automate PRD implementation from GitHub child tasks')
  })

  it('generates merge instructions with the PRD title and all closing footers', () => {
    expect(
      generateMergeInstructions({
        childTasks,
        parentPrdIssueNumber: 80,
        prdTitle: 'PRD: Automate PRD implementation from GitHub child tasks',
      }),
    ).toBe(`## Squash Merge Instructions

Use this exact squash commit title:

\`\`\`text
feat: automate PRD implementation from GitHub child tasks
\`\`\`

Include these closing footers in the squash commit body:

\`\`\`text
Closes #80
Closes #81
Closes #82
\`\`\`

Human review and merge are required. The orchestrator must not merge this PR.`)
  })

  it('generates a draft PR body with automation ownership and child progress ledger', () => {
    expect(
      generateDraftPrBody({
        branchName: 'agent/prd-80-automate-prd-implementation',
        childTasks,
        ledger: [
          {
            codeRabbitStatus: 'passed',
            issueNumber: 81,
            shortCommitHash: 'abc1234',
            status: 'complete',
            verificationStatus: 'lint, typecheck, tests passed',
          },
          {
            codeRabbitStatus: 'pending',
            issueNumber: 82,
            status: 'pending',
            verificationStatus: 'not run',
          },
        ],
        parentPrdIssueNumber: 80,
        prdTitle: 'PRD: Automate PRD implementation from GitHub child tasks',
      }),
    ).toContain(`## Automation

Managed by \`@cv-maxxing/prd-orchestrator\`.

Draft branch \`agent/prd-80-automate-prd-implementation\` is automation-owned and may be force-pushed while this PR remains draft.

Human review and merge are required. The orchestrator must not merge this PR.`)

    expect(
      generateDraftPrBody({
        branchName: 'agent/prd-80-automate-prd-implementation',
        childTasks: [
          {
            issueNumber: 81,
            title: 'Parser | planning\nflow',
          },
        ],
        ledger: [
          {
            codeRabbitStatus: 'needs | review',
            issueNumber: 81,
            shortCommitHash: 'abc1234',
            status: 'complete',
            verificationStatus: 'lint\npassed',
          },
        ],
        parentPrdIssueNumber: 80,
        prdTitle: 'PRD: Automate PRD implementation from GitHub child tasks',
      }),
    ).toContain(
      '| #81 | Parser \\| planning flow | complete | `abc1234` | lint passed | needs \\| review |',
    )

    expect(
      generateDraftPrBody({
        branchName: 'agent/prd-80-automate-prd-implementation',
        childTasks,
        ledger: [
          {
            codeRabbitStatus: 'passed',
            issueNumber: 81,
            shortCommitHash: 'abc1234',
            status: 'complete',
            verificationStatus: 'lint, typecheck, tests passed',
          },
          {
            codeRabbitStatus: 'pending',
            issueNumber: 82,
            status: 'pending',
            verificationStatus: 'not run',
          },
        ],
        parentPrdIssueNumber: 80,
        prdTitle: 'PRD: Automate PRD implementation from GitHub child tasks',
      }),
    ).toContain(
      '| #81 | Scaffold the PRD orchestrator workspace package | complete | `abc1234` | lint, typecheck, tests passed | passed |',
    )
  })

  it('creates child Conventional Commit messages with evidence and child closure', () => {
    expect(
      createChildCommitMessage({
        acceptanceEvidence: [
          'PR body includes automation ownership.',
          'Merge instructions include all closure footers.',
        ],
        childIssueNumber: 83,
        childTitle: 'Generate PRD draft PR state, ledger, and merge instructions',
        verificationEvidence: ['pnpm --filter @cv-maxxing/prd-orchestrator test:unit'],
      }),
    ).toBe(`feat: generate PRD draft PR state, ledger, and merge instructions

Acceptance evidence:
- PR body includes automation ownership.
- Merge instructions include all closure footers.

Verification evidence:
- pnpm --filter @cv-maxxing/prd-orchestrator test:unit

Closes #83`)
  })

  it('reconciles stale PR body ledger data from commits containing child closing footers', () => {
    expect(
      reconcileDraftPrStateFromCommits({
        childTasks,
        commits: [
          {
            body: 'Acceptance evidence:\n- Parser handles child issues.\n\nCloses #82',
            hash: 'def4567890',
            subject: 'feat: build PRD planning core',
          },
        ],
        existingLedger: [
          {
            codeRabbitStatus: 'pending',
            issueNumber: 81,
            status: 'pending',
            verificationStatus: 'not run',
          },
          {
            codeRabbitStatus: 'pending',
            issueNumber: 82,
            status: 'pending',
            verificationStatus: 'not run',
          },
        ],
      }),
    ).toEqual([
      {
        codeRabbitStatus: 'pending',
        issueNumber: 81,
        status: 'pending',
        verificationStatus: 'not run',
      },
      {
        codeRabbitStatus: 'pending',
        issueNumber: 82,
        shortCommitHash: 'def4567',
        status: 'complete',
        verificationStatus: 'recorded in commit def4567',
      },
    ])
  })

  it('recovers interrupted run progress from commits while preserving PR body ledger state', () => {
    expect(
      reconcileDraftPrStateFromCommits({
        childTasks: [
          ...childTasks,
          {
            issueNumber: 83,
            title: 'Block unresolved decisions',
          },
        ],
        commits: [
          {
            body: 'Acceptance evidence:\n- Parser handles child issues.\n\nCloses #82',
            hash: 'def4567890',
            subject: 'feat: build PRD planning core',
          },
        ],
        existingLedger: [
          {
            codeRabbitStatus: 'passed',
            issueNumber: 81,
            shortCommitHash: 'abc1234',
            status: 'complete',
            verificationStatus: 'recorded in commit abc1234',
          },
          {
            codeRabbitStatus: 'pending',
            issueNumber: 83,
            status: 'blocked',
            verificationStatus: 'external blocker recorded',
          },
        ],
      }),
    ).toEqual([
      {
        codeRabbitStatus: 'passed',
        issueNumber: 81,
        shortCommitHash: 'abc1234',
        status: 'complete',
        verificationStatus: 'recorded in commit abc1234',
      },
      {
        codeRabbitStatus: 'pending',
        issueNumber: 82,
        shortCommitHash: 'def4567',
        status: 'complete',
        verificationStatus: 'recorded in commit def4567',
      },
      {
        codeRabbitStatus: 'pending',
        issueNumber: 83,
        status: 'blocked',
        verificationStatus: 'external blocker recorded',
      },
    ])
  })
})
