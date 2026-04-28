import { describe, expect, it } from 'vitest'

import {
  groupRunnableTasksByImpactSurface,
  planBlockedTaskContinuation,
  planRemediationAttempt,
} from '../index.js'

const taskA = {
  issueNumber: 101,
  surface: {
    designFiles: [],
    expectedFiles: ['tools/prd-orchestrator/src/a.ts'],
    expectedModules: ['@cv-maxxing/prd-orchestrator'],
    riskLevel: 'low',
    sharedContracts: [],
    tests: ['tools/prd-orchestrator/src/__tests__/a.test.ts'],
  },
} as const

const taskB = {
  issueNumber: 102,
  surface: {
    designFiles: [],
    expectedFiles: ['tools/prd-orchestrator/src/b.ts'],
    expectedModules: ['@cv-maxxing/prd-orchestrator/b'],
    riskLevel: 'low',
    sharedContracts: [],
    tests: ['tools/prd-orchestrator/src/__tests__/b.test.ts'],
  },
} as const

describe('full-run scheduler foundations', () => {
  it('groups currently unblocked child tasks into safe parallel batches when surfaces do not overlap', () => {
    expect(
      groupRunnableTasksByImpactSurface({
        tasks: [taskA, taskB],
      }),
    ).toEqual({
      batches: [
        {
          issueNumbers: [101, 102],
          mode: 'parallel',
          reason: 'impact surfaces do not overlap',
        },
      ],
    })
  })

  it('falls back to sequential execution for overlapping, shared, or uncertain surfaces', () => {
    expect(
      groupRunnableTasksByImpactSurface({
        tasks: [
          taskA,
          {
            issueNumber: 103,
            surface: {
              ...taskA.surface,
              expectedFiles: ['tools/prd-orchestrator/src/a.ts'],
            },
          },
        ],
      }).batches,
    ).toEqual([
      {
        issueNumbers: [101],
        mode: 'sequential',
        reason: 'impact surface overlaps with #103',
      },
      {
        issueNumbers: [103],
        mode: 'sequential',
        reason: 'impact surface overlaps with #101',
      },
    ])

    expect(
      groupRunnableTasksByImpactSurface({
        tasks: [
          {
            ...taskA,
            surface: {
              ...taskA.surface,
              designFiles: ['design/app.pen'],
            },
          },
          taskB,
        ],
      }).batches,
    ).toEqual([
      {
        issueNumbers: [101],
        mode: 'sequential',
        reason: 'shared design, snapshot, or contract surface requires serialization',
      },
      {
        issueNumbers: [102],
        mode: 'sequential',
        reason: 'shared design, snapshot, or contract surface requires serialization',
      },
    ])

    expect(
      groupRunnableTasksByImpactSurface({
        tasks: [
          {
            ...taskA,
            surface: {
              ...taskA.surface,
              riskLevel: 'high',
            },
          },
          taskB,
        ],
      }).batches,
    ).toEqual([
      {
        issueNumbers: [101],
        mode: 'sequential',
        reason: 'uncertain or high-risk impact surface',
      },
      {
        issueNumbers: [102],
        mode: 'sequential',
        reason: 'uncertain or high-risk impact surface',
      },
    ])
  })

  it('continues independent work when one child is blocked by a recoverable or external blocker', () => {
    expect(
      planBlockedTaskContinuation({
        blockedIssueNumber: 101,
        runnableIssueNumbers: [101, 102, 103],
      }),
    ).toEqual({
      continueIssueNumbers: [102, 103],
      recordBlockerForIssueNumber: 101,
      shouldContinue: true,
    })

    expect(
      planBlockedTaskContinuation({
        blockedIssueNumber: 101,
        runnableIssueNumbers: [101],
      }),
    ).toEqual({
      continueIssueNumbers: [],
      recordBlockerForIssueNumber: 101,
      shouldContinue: false,
    })
  })

  it('requires new evidence or changed strategy before repeating remediation attempts', () => {
    expect(
      planRemediationAttempt({
        lastAttempt: {
          evidenceFingerprint: 'lint:error-a',
          strategy: 'ask-worker-to-fix',
        },
        nextAttempt: {
          evidenceFingerprint: 'lint:error-a',
          strategy: 'ask-worker-to-fix',
        },
      }),
    ).toEqual({
      allowed: false,
      reason: 'Repeated remediation requires new evidence or a changed strategy.',
    })

    expect(
      planRemediationAttempt({
        lastAttempt: {
          evidenceFingerprint: 'lint:error-a',
          strategy: 'ask-worker-to-fix',
        },
        nextAttempt: {
          evidenceFingerprint: 'lint:error-b',
          strategy: 'reanalyze-impact',
        },
      }),
    ).toEqual({
      allowed: true,
      reason: 'Remediation has new evidence or a changed strategy.',
    })
  })
})
