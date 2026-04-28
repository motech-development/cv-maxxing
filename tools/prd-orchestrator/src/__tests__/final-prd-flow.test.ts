import { describe, expect, it } from 'vitest'

import {
  evaluateReadyForReviewGate,
  generateFinalPrdAcceptanceAudit,
  interpretGitHubActionsStatus,
  planGitHubActionsPolling,
  planResumePrRepair,
  validateAutomationPrOwnership,
} from '../index.js'

const automationPrBody = `# feat: automate PRD implementation from GitHub child tasks

## Automation

Managed by \`@cv-maxxing/prd-orchestrator\`.

Draft branch \`agent/prd-80-automate-prd-implementation\` is automation-owned and may be force-pushed while this PR remains draft.
`

const childTasks = [
  {
    acceptanceCriteria: ['Package exists.', 'Build passes.'],
    issueNumber: 81,
    title: 'Scaffold the PRD orchestrator workspace package',
    userStoriesAddressed: [1, 8],
  },
  {
    acceptanceCriteria: ['Final audit comment is generated.'],
    issueNumber: 88,
    title: 'Add automation PR repair and final PRD audit flow',
    userStoriesAddressed: [29, 37],
  },
] as const

describe('final PRD repair and audit flow', () => {
  it('validates resume-pr ownership from branch prefix and Automation section', () => {
    expect(
      validateAutomationPrOwnership({
        body: automationPrBody,
        branchName: 'agent/prd-80-automate-prd-implementation',
        prNumber: 12,
      }),
    ).toEqual({
      blockers: [],
      valid: true,
    })

    expect(
      validateAutomationPrOwnership({
        body: 'No automation section.',
        branchName: 'feature/manual-work',
        prNumber: 12,
      }),
    ).toEqual({
      blockers: [
        'PR #12 branch feature/manual-work is not an orchestrator PRD branch',
        'PR #12 body is missing the orchestrator Automation section',
      ],
      valid: false,
    })
  })

  it('polls GitHub Actions only after the full PRD implementation is pushed', () => {
    expect(
      planGitHubActionsPolling({
        allChildrenComplete: false,
        prdBranchPushed: true,
        prNumber: 12,
      }),
    ).toEqual({
      command: undefined,
      reason: 'GitHub Actions are deferred until all child tasks are complete and pushed.',
      shouldPoll: false,
    })

    expect(
      planGitHubActionsPolling({
        allChildrenComplete: true,
        prdBranchPushed: true,
        prNumber: 12,
      }),
    ).toEqual({
      command: undefined,
      reason: 'GitHub Actions polling requires the pushed PRD branch name.',
      shouldPoll: false,
    })

    expect(
      planGitHubActionsPolling({
        allChildrenComplete: true,
        branchName: 'agent/prd-80-automate-prd-implementation',
        prdBranchPushed: true,
        prNumber: 12,
      }),
    ).toEqual({
      command:
        'gh run list --branch agent/prd-80-automate-prd-implementation --json status,conclusion',
      reason: 'Full PRD implementation is pushed; poll CI before final audit.',
      shouldPoll: true,
    })
  })

  it('interprets GitHub Actions status for success, pending, failure, and blockers', () => {
    expect(
      interpretGitHubActionsStatus({
        runs: [
          {
            conclusion: 'success',
            name: 'desktop macos-15',
            status: 'completed',
          },
        ],
      }),
    ).toEqual({
      blockers: [],
      status: 'passed',
    })

    expect(
      interpretGitHubActionsStatus({
        runs: [
          {
            conclusion: undefined,
            name: 'desktop macos-15',
            status: 'in_progress',
          },
        ],
      }),
    ).toEqual({
      blockers: [],
      status: 'pending',
    })

    expect(
      interpretGitHubActionsStatus({
        runs: [
          {
            conclusion: 'failure',
            name: 'desktop macos-15',
            status: 'completed',
          },
        ],
      }),
    ).toEqual({
      blockers: ['GitHub Actions run desktop macos-15 failed with conclusion failure'],
      status: 'failed',
    })
  })

  it('plans resume-pr repair with return-to-draft, child amend, final cleanup, and force push', () => {
    expect(
      planResumePrRepair({
        childCommits: [
          {
            childIssueNumber: 81,
            commitHash: 'abc123456789',
          },
        ],
        findings: [
          {
            body: 'Fix the child commit.',
            childIssueNumber: 81,
            id: 'finding-1',
            source: 'github-pr-review',
            title: 'Child issue regression',
          },
          {
            body: 'Update final audit wording.',
            id: 'finding-2',
            source: 'github-check',
            title: 'Final cleanup',
          },
        ],
        ownership: {
          body: automationPrBody,
          branchName: 'agent/prd-80-automate-prd-implementation',
          prNumber: 12,
        },
        prIsDraft: false,
      }),
    ).toEqual({
      action: 'repair',
      amendChildCommits: [
        {
          childIssueNumber: 81,
          commitHash: 'abc123456789',
          findingIds: ['finding-1'],
        },
      ],
      blockers: [],
      finalCleanupCommit: {
        findingIds: ['finding-2'],
        message:
          'chore: address final PRD review findings\n\nFinal cleanup rationale:\n- finding-2: No child commit mapping context was available.',
        rationales: [
          {
            findingId: 'finding-2',
            rationale: 'No child commit mapping context was available.',
            source: 'github-check',
          },
        ],
      },
      forcePush: {
        branchName: 'agent/prd-80-automate-prd-implementation',
        mode: 'force-with-lease',
      },
      inspectCi: true,
      inspectCodeRabbit: true,
      nonActionableFindings: [],
      returnToDraft: true,
    })
  })

  it('maps live PR findings to child commits by commit hash or changed file', () => {
    expect(
      planResumePrRepair({
        childCommits: [
          {
            changedFiles: ['tools/prd-orchestrator/src/final-prd-flow.ts'],
            childIssueNumber: 81,
            commitHash: 'abc123456789',
          },
          {
            changedFiles: ['tools/prd-orchestrator/src/default-live-adapters.ts'],
            childIssueNumber: 88,
            commitHash: 'def123456789',
          },
        ],
        findings: [
          {
            body: 'The review comment was left on a child commit.',
            commitHash: 'abc123456789',
            id: 'finding-by-commit',
            source: 'github-pr-review',
            title: 'Commit-scoped finding',
          },
          {
            body: 'The inline comment was left on a file changed by child #88.',
            filePath: 'tools/prd-orchestrator/src/default-live-adapters.ts',
            id: 'finding-by-file',
            source: 'github-pr-review',
            title: 'File-scoped finding',
          },
        ],
        ownership: {
          body: automationPrBody,
          branchName: 'agent/prd-80-automate-prd-implementation',
          prNumber: 12,
        },
        prIsDraft: true,
      }),
    ).toMatchObject({
      action: 'repair',
      amendChildCommits: [
        {
          childIssueNumber: 81,
          commitHash: 'abc123456789',
          findingIds: ['finding-by-commit'],
        },
        {
          childIssueNumber: 88,
          commitHash: 'def123456789',
          findingIds: ['finding-by-file'],
        },
      ],
      finalCleanupCommit: undefined,
      returnToDraft: false,
    })
  })

  it('carries unmapped and ambiguous PR findings as final cleanup with rationale', () => {
    expect(
      planResumePrRepair({
        childCommits: [
          {
            changedFiles: ['shared.ts'],
            childIssueNumber: 81,
            commitHash: 'abc123456789',
          },
          {
            changedFiles: ['shared.ts'],
            childIssueNumber: 88,
            commitHash: 'def123456789',
          },
        ],
        findings: [
          {
            body: 'General PR summary finding.',
            id: 'finding-without-context',
            source: 'github-pr-review',
            title: 'Summary finding',
          },
          {
            body: 'The file was touched by multiple child commits.',
            filePath: 'shared.ts',
            id: 'ambiguous-file-finding',
            source: 'github-pr-review',
            title: 'Ambiguous file finding',
          },
        ],
        ownership: {
          body: automationPrBody,
          branchName: 'agent/prd-80-automate-prd-implementation',
          prNumber: 12,
        },
        prIsDraft: true,
      }),
    ).toMatchObject({
      action: 'repair',
      amendChildCommits: [],
      finalCleanupCommit: {
        findingIds: ['finding-without-context', 'ambiguous-file-finding'],
        rationales: [
          {
            findingId: 'finding-without-context',
            rationale: 'No child commit mapping context was available.',
            source: 'github-pr-review',
          },
          {
            findingId: 'ambiguous-file-finding',
            rationale: 'File shared.ts matched multiple child commits: #81, #88.',
            source: 'github-pr-review',
          },
        ],
      },
    })
  })

  it('records non-actionable PR findings with rationale instead of repairing them', () => {
    expect(
      planResumePrRepair({
        childCommits: [
          {
            changedFiles: ['tools/prd-orchestrator/src/final-prd-flow.ts'],
            childIssueNumber: 81,
            commitHash: 'abc123456789',
          },
        ],
        findings: [
          {
            body: 'Use Redux for this state flow.',
            conflictsWith: 'project-instructions',
            filePath: 'tools/prd-orchestrator/src/final-prd-flow.ts',
            id: 'non-actionable-finding',
            rationale: 'Project instructions explicitly forbid Redux.',
            source: 'github-pr-review',
            title: 'Use Redux',
          },
        ],
        ownership: {
          body: automationPrBody,
          branchName: 'agent/prd-80-automate-prd-implementation',
          prNumber: 12,
        },
        prIsDraft: true,
      }),
    ).toEqual({
      action: 'clean',
      amendChildCommits: [],
      blockers: [],
      finalCleanupCommit: undefined,
      forcePush: undefined,
      inspectCi: true,
      inspectCodeRabbit: true,
      nonActionableFindings: [
        {
          findingId: 'non-actionable-finding',
          rationale: 'Project instructions explicitly forbid Redux.',
          source: 'github-pr-review',
        },
      ],
      returnToDraft: false,
    })
  })

  it('blocks child-scoped resume findings when the target child commit cannot be found safely', () => {
    expect(
      planResumePrRepair({
        childCommits: [],
        findings: [
          {
            body: 'Fix the child commit.',
            childIssueNumber: 81,
            id: 'finding-1',
            source: 'github-pr-review',
            title: 'Child issue regression',
          },
        ],
        ownership: {
          body: automationPrBody,
          branchName: 'agent/prd-80-automate-prd-implementation',
          prNumber: 12,
        },
        prIsDraft: true,
      }),
    ).toEqual({
      action: 'blocked',
      amendChildCommits: [],
      blockers: ['Cannot safely find child commit for #81 while repairing finding finding-1'],
      finalCleanupCommit: undefined,
      forcePush: undefined,
      inspectCi: false,
      inspectCodeRabbit: false,
      nonActionableFindings: [],
      returnToDraft: false,
    })

    expect(
      planResumePrRepair({
        childCommits: [
          {
            childIssueNumber: 81,
            commitHash: 'abc123456789',
          },
          {
            childIssueNumber: 81,
            commitHash: 'def123456789',
          },
        ],
        findings: [
          {
            body: 'Fix the child commit.',
            childIssueNumber: 81,
            id: 'finding-1',
            source: 'github-pr-review',
            title: 'Child issue regression',
          },
        ],
        ownership: {
          body: automationPrBody,
          branchName: 'agent/prd-80-automate-prd-implementation',
          prNumber: 12,
        },
        prIsDraft: true,
      }),
    ).toMatchObject({
      action: 'blocked',
      blockers: [
        'Cannot safely choose between 2 child commits for #81 while repairing finding finding-1',
      ],
    })
  })

  it('generates a final PRD acceptance audit as a separate PR comment', () => {
    const audit = generateFinalPrdAcceptanceAudit({
      architectureChecks: ['No telemetry added.', 'No required web backend added.'],
      childTasks,
      ciStatus: 'passed',
      codeRabbitStatus: 'passed',
      mergeInstructions: 'Squash with title `feat: automate PRD implementation`.',
      parentPrdIssueNumber: 80,
      parentUserStories: [
        {
          issueNumbers: [81],
          storyNumber: 1,
        },
        {
          issueNumbers: [88],
          storyNumber: 37,
        },
      ],
      verificationEvidence: ['pnpm lint', 'pnpm --filter @cv-maxxing/prd-orchestrator test:unit'],
    })

    expect(audit).toContain('## Final PRD Acceptance Audit')
    expect(audit).toContain('Parent PRD: #80')
    expect(audit).toContain('- User story 37: #88')
    expect(audit).toContain('- #88 Add automation PR repair and final PRD audit flow')
    expect(audit).toContain('  - Final audit comment is generated.')
    expect(audit).toContain('- pnpm lint')
    expect(audit).toContain('- No required web backend added.')
    expect(audit).toContain('CodeRabbit: passed')
    expect(audit).toContain('GitHub Actions: passed')
    expect(audit).toContain('Squash with title `feat: automate PRD implementation`.')
  })

  it('marks ready for review only after every final gate passes', () => {
    expect(
      evaluateReadyForReviewGate({
        allChildrenComplete: true,
        ciStatus: 'passed',
        codeRabbitStatus: 'passed',
        finalAuditCommentPlanned: true,
        finalAuditCommentPosted: true,
        localGatesPassed: true,
      }),
    ).toEqual({
      blockers: [],
      ready: true,
    })

    expect(
      evaluateReadyForReviewGate({
        allChildrenComplete: false,
        ciStatus: 'pending',
        codeRabbitStatus: 'passed',
        finalAuditCommentPlanned: true,
        finalAuditCommentPosted: false,
        localGatesPassed: true,
      }),
    ).toEqual({
      blockers: [
        'not all child tasks are complete',
        'GitHub Actions status is pending',
        'final PRD acceptance audit has not been posted',
      ],
      ready: false,
    })
  })
})
