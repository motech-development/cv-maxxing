import { describe, expect, it } from 'vitest'

import {
  classifyCodeRabbitFinding,
  planChildCodeRabbitReview,
  planCodeRabbitCommand,
  recordNonActionableFinding,
} from '../index.js'

const actionableCliFinding = {
  body: 'Prefer a typed parser before consuming unknown JSON.',
  id: 'cli-1',
  source: 'cli',
  title: 'Unsafe JSON parsing',
} as const

const actionablePrFinding = {
  body: 'The PR review says this branch update needs the same parser fix.',
  id: 'pr-review-1',
  source: 'github-pr-review',
  title: 'CodeRabbit PR review comment',
} as const

const actionableCheckFinding = {
  body: 'The CodeRabbit check reports a missing rerun guard.',
  id: 'check-1',
  source: 'github-check',
  title: 'CodeRabbit check finding',
} as const

describe('CodeRabbit child review handling', () => {
  it('plans CodeRabbit CLI review only after host verification has passed', () => {
    expect(
      planCodeRabbitCommand({
        childIssueNumber: 87,
        hostVerificationPassed: true,
        prNumber: 12,
      }),
    ).toEqual({
      command: 'coderabbit review --agent',
      phase: 'after-host-verification',
      required: true,
    })

    expect(
      planCodeRabbitCommand({
        childIssueNumber: 87,
        hostVerificationPassed: false,
        prNumber: 12,
      }),
    ).toEqual({
      blocker: 'CodeRabbit must wait for host-side verification to pass for #87',
      command: undefined,
      phase: 'after-host-verification',
      required: true,
    })
  })

  it('classifies CLI, GitHub PR review, and GitHub check findings as repair inputs', () => {
    expect(classifyCodeRabbitFinding(actionableCliFinding)).toEqual({
      finding: actionableCliFinding,
      kind: 'actionable',
      repairPrompt:
        'Fix CodeRabbit finding cli-1: Unsafe JSON parsing\n\nPrefer a typed parser before consuming unknown JSON.',
    })

    expect(classifyCodeRabbitFinding(actionablePrFinding)).toEqual({
      finding: actionablePrFinding,
      kind: 'actionable',
      repairPrompt:
        'Fix CodeRabbit finding pr-review-1: CodeRabbit PR review comment\n\nThe PR review says this branch update needs the same parser fix.',
    })

    expect(classifyCodeRabbitFinding(actionableCheckFinding)).toEqual({
      finding: actionableCheckFinding,
      kind: 'actionable',
      repairPrompt:
        'Fix CodeRabbit finding check-1: CodeRabbit check finding\n\nThe CodeRabbit check reports a missing rerun guard.',
    })
  })

  it('plans amend, force-push, PR review inspection, and rerun for actionable findings while draft', () => {
    expect(
      planChildCodeRabbitReview({
        branchName: 'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
        childCommitHash: 'abc123456789',
        childIssueNumber: 87,
        cliFindings: [actionableCliFinding],
        explicitBlocker: undefined,
        hostVerificationPassed: true,
        prIsDraft: true,
        prNumber: 12,
        prReviewFindings: [actionablePrFinding],
      }),
    ).toEqual({
      action: 'repair-and-rerun',
      amendCommit: {
        commitHash: 'abc123456789',
        mode: 'git commit --amend',
      },
      command: {
        command: 'coderabbit review --agent',
        phase: 'after-host-verification',
        required: true,
      },
      forcePush: {
        branchName: 'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
        mode: 'force-with-lease',
      },
      nonActionableFindings: [],
      prReviewInspection: {
        prNumber: 12,
        requiredAfterPush: true,
      },
      repairFindings: [
        {
          finding: actionableCliFinding,
          kind: 'actionable',
          repairPrompt:
            'Fix CodeRabbit finding cli-1: Unsafe JSON parsing\n\nPrefer a typed parser before consuming unknown JSON.',
        },
        {
          finding: actionablePrFinding,
          kind: 'actionable',
          repairPrompt:
            'Fix CodeRabbit finding pr-review-1: CodeRabbit PR review comment\n\nThe PR review says this branch update needs the same parser fix.',
        },
      ],
      rerun: {
        command: 'coderabbit review --agent',
        until: 'clean-or-explicit-blocker',
      },
    })
  })

  it('returns clean when CodeRabbit and PR review inspection have no findings', () => {
    expect(
      planChildCodeRabbitReview({
        branchName: 'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
        childCommitHash: 'abc123456789',
        childIssueNumber: 87,
        cliFindings: [],
        explicitBlocker: undefined,
        hostVerificationPassed: true,
        prIsDraft: true,
        prNumber: 12,
        prReviewFindings: [],
      }),
    ).toEqual({
      action: 'clean',
      amendCommit: undefined,
      command: {
        command: 'coderabbit review --agent',
        phase: 'after-host-verification',
        required: true,
      },
      forcePush: undefined,
      nonActionableFindings: [],
      prReviewInspection: {
        prNumber: 12,
        requiredAfterPush: true,
      },
      repairFindings: [],
      rerun: undefined,
    })
  })

  it('records conflicting findings with rationale when no CLI resolution mechanism exists', () => {
    const finding = {
      body: 'Use Redux for this state flow.',
      conflictsWith: 'project-instructions',
      id: 'pr-review-2',
      rationale: 'Project instructions explicitly forbid Redux.',
      source: 'github-pr-review',
      title: 'Use Redux',
    } as const

    expect(classifyCodeRabbitFinding(finding)).toEqual({
      finding,
      kind: 'non-actionable',
      record: {
        findingId: 'pr-review-2',
        rationale: 'Project instructions explicitly forbid Redux.',
        source: 'github-pr-review',
      },
    })
    expect(recordNonActionableFinding(finding)).toEqual({
      findingId: 'pr-review-2',
      rationale: 'Project instructions explicitly forbid Redux.',
      source: 'github-pr-review',
    })
  })

  it('documents explicit blockers instead of abandoning the review loop', () => {
    expect(
      planChildCodeRabbitReview({
        branchName: 'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
        childCommitHash: 'abc123456789',
        childIssueNumber: 87,
        cliFindings: [],
        explicitBlocker: 'CodeRabbit CLI exited with authentication failure.',
        hostVerificationPassed: true,
        prIsDraft: true,
        prNumber: 12,
        prReviewFindings: [],
      }),
    ).toMatchObject({
      action: 'blocked',
      blocker: 'CodeRabbit CLI exited with authentication failure.',
      rerun: undefined,
    })
  })
})
