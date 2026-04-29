import { describe, expect, it } from 'vitest'

import {
  enforceWriteSurface,
  planFailureRecovery,
  planOneChildTransaction,
  renderOneChildTransactionPlan,
  selectVerificationCommands,
  validatePencilVerificationEvidence,
} from '../index.js'

const parentPrdBody = `## Problem Statement

Existing coordination is manual.

## User Stories

1. As a maintainer, I want one draft PR per PRD.
2. As a maintainer, I want write-surface enforcement.
3. As a maintainer, I want host-side verification.

## Implementation Decisions

- Create or resume branch \`agent/prd-<number>-<slug>\`.
- Keep workers on local sandbox branches by default.
`

const completedChildBody = `## Parent PRD

#80

## What to build

Scaffold the orchestrator package.

## Acceptance criteria

- [ ] Package exists.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
`

const selectedChildBody = `## Parent PRD

#80

## What to build

Implement the first live child-task transaction end to end.

## Acceptance criteria

- [ ] The worker implementation diff is checked against the impact-analysis write surface before application.
- [ ] Host-side verification runs on the PRD branch before committing.

## Blocked by

- Blocked by #85

## User stories addressed

- User story 2
- User story 3
`

const issues = [
  {
    body: parentPrdBody,
    number: 80,
    state: 'OPEN',
    title: 'PRD: Automate PRD implementation from GitHub child tasks',
  },
  {
    body: completedChildBody,
    number: 85,
    state: 'OPEN',
    title: 'Wire Sandcastle Docker impact analysis with Codex',
  },
  {
    body: selectedChildBody,
    number: 86,
    state: 'OPEN',
    title: 'Implement one child task end to end through the draft PR',
  },
] as const

const impactAnalysis = {
  designFiles: ['design/app.pen'],
  expectedFiles: ['tools/prd-orchestrator/src/one-child-transaction.ts'],
  expectedModules: ['@cv-maxxing/prd-orchestrator'],
  riskLevel: 'medium',
  sharedContracts: ['OneChildTransactionPlan'],
  tests: ['tools/prd-orchestrator/src/__tests__/one-child-transaction.test.ts'],
} as const

describe('one-child transaction planning', () => {
  it('selects one unblocked child and plans PRD branch, draft PR, and local worker branch', () => {
    const plan = planOneChildTransaction({
      childCommitHash: 'abc123456789',
      codeRabbitStatus: 'passed',
      completedChildIssueNumbers: [85],
      dependencyChangeJustification: undefined,
      existingLedger: [],
      impactAnalysis,
      issues,
      mainBranchStatus: {
        clean: true,
        currentBranch: 'main',
        upToDate: true,
      },
      remoteAutomationPr: undefined,
      verificationEvidence: ['pnpm lint', 'pnpm --filter @cv-maxxing/prd-orchestrator typecheck'],
      workerChangedFiles: [
        'tools/prd-orchestrator/src/one-child-transaction.ts',
        'tools/prd-orchestrator/src/__tests__/one-child-transaction.test.ts',
      ],
    })

    expect(plan.status).toBe('ready-to-commit')
    expect(plan.prdBranchName).toBe(
      'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
    )
    expect(plan.draftPullRequest).toMatchObject({
      action: 'create',
      draft: true,
      title: 'feat: automate PRD implementation from GitHub child tasks',
    })
    expect(plan.selectedChild?.issueNumber).toBe(86)
    expect(plan.workerRun).toEqual({
      branchName: 'agent/prd-80-child-86-implement-one-child-task-end-to-end-through-the-draft-pr',
      pushToRemote: false,
      receivesGitHubMutationCredentials: false,
    })
    expect(plan.hostApplication).toEqual({
      applyWorkerDiffOnBranch: 'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
      startsFromCleanUpToDateMain: true,
    })
    expect(plan.commitMessage).toContain(
      'feat: implement one child task end to end through the draft PR',
    )
    expect(plan.commitMessage).toContain('Closes #86')
    expect(plan.prBodyAfterChildUpdate).toContain(
      '| #86 | Implement one child task end to end through the draft PR | complete | `abc1234` | pnpm lint; pnpm --filter @cv-maxxing/prd-orchestrator typecheck | passed |',
    )
    expect(plan.push).toEqual({
      branchName: 'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
      mode: 'force-with-lease',
    })
  })

  it('keeps generated branch slugs within a safe length', () => {
    const longTitleIssues = issues.map((issue) =>
      issue.number === 86
        ? {
            ...issue,
            title:
              'Implement one child task with a deliberately long title that would otherwise exceed branch name limits during automated full PRD execution',
          }
        : issue,
    )
    const plan = planOneChildTransaction({
      childCommitHash: 'abc123456789',
      codeRabbitStatus: 'passed',
      completedChildIssueNumbers: [85],
      dependencyChangeJustification: undefined,
      existingLedger: [],
      impactAnalysis,
      issues: longTitleIssues,
      mainBranchStatus: {
        clean: true,
        currentBranch: 'main',
        upToDate: true,
      },
      remoteAutomationPr: undefined,
      verificationEvidence: ['pnpm lint'],
      workerChangedFiles: ['tools/prd-orchestrator/src/one-child-transaction.ts'],
    })

    expect(plan.workerRun?.branchName.length).toBeLessThanOrEqual(102)
  })

  it('uses a safe fallback for generated branch slugs when titles have no alphanumeric text', () => {
    const punctuationOnlyIssues = issues.map((issue) =>
      issue.number === 80 || issue.number === 86
        ? {
            ...issue,
            title: issue.number === 80 ? 'PRD: !!!' : '...',
          }
        : issue,
    )
    const plan = planOneChildTransaction({
      childCommitHash: 'abc123456789',
      codeRabbitStatus: 'passed',
      completedChildIssueNumbers: [85],
      dependencyChangeJustification: undefined,
      existingLedger: [],
      impactAnalysis,
      issues: punctuationOnlyIssues,
      mainBranchStatus: {
        clean: true,
        currentBranch: 'main',
        upToDate: true,
      },
      remoteAutomationPr: undefined,
      verificationEvidence: ['pnpm lint'],
      workerChangedFiles: ['tools/prd-orchestrator/src/one-child-transaction.ts'],
    })

    expect(plan.prdBranchName).toBe('agent/prd-80-untitled')
    expect(plan.workerRun?.branchName).toBe('agent/prd-80-child-86-untitled')
  })

  it('resumes an existing automation draft PR instead of planning a second PR', () => {
    const plan = planOneChildTransaction({
      childCommitHash: 'abc123456789',
      codeRabbitStatus: 'passed',
      completedChildIssueNumbers: [85],
      dependencyChangeJustification: undefined,
      existingLedger: [],
      impactAnalysis,
      issues,
      mainBranchStatus: {
        clean: true,
        currentBranch: 'main',
        upToDate: true,
      },
      remoteAutomationPr: {
        branchName: 'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
        isDraft: true,
        prNumber: 12,
        prdIssueNumber: 80,
        url: 'https://github.com/motech-development/cv-maxxing/pull/12',
      },
      verificationEvidence: ['pnpm lint'],
      workerChangedFiles: ['tools/prd-orchestrator/src/one-child-transaction.ts'],
    })

    expect(plan.draftPullRequest).toMatchObject({
      action: 'resume',
      branchName: 'agent/prd-80-automate-prd-implementation-from-github-child-tasks',
      prNumber: 12,
      url: 'https://github.com/motech-development/cv-maxxing/pull/12',
    })
  })

  it('uses the remote automation branch as the single PRD branch when resuming', () => {
    const plan = planOneChildTransaction({
      childCommitHash: 'abc123456789',
      codeRabbitStatus: 'passed',
      completedChildIssueNumbers: [85],
      dependencyChangeJustification: undefined,
      existingLedger: [],
      impactAnalysis,
      issues,
      mainBranchStatus: {
        clean: true,
        currentBranch: 'main',
        upToDate: true,
      },
      remoteAutomationPr: {
        branchName: 'agent/prd-80-resumed-from-github',
        isDraft: true,
        prNumber: 12,
        prdIssueNumber: 80,
        url: 'https://github.com/motech-development/cv-maxxing/pull/12',
      },
      verificationEvidence: ['pnpm lint'],
      workerChangedFiles: ['tools/prd-orchestrator/src/one-child-transaction.ts'],
    })

    expect(plan.prdBranchName).toBe('agent/prd-80-resumed-from-github')
    expect(plan.draftPullRequest).toMatchObject({
      action: 'resume',
      branchName: 'agent/prd-80-resumed-from-github',
    })
    expect(plan.hostApplication.applyWorkerDiffOnBranch).toBe('agent/prd-80-resumed-from-github')
    expect(plan.prBodyAfterChildUpdate).toContain(
      'Draft branch `agent/prd-80-resumed-from-github` is automation-owned',
    )
    expect(plan.push).toEqual({
      branchName: 'agent/prd-80-resumed-from-github',
      mode: 'force-with-lease',
    })
  })

  it('enforces impact-analysis write surfaces with design and dependency exceptions', () => {
    expect(
      enforceWriteSurface({
        changedFiles: [
          'tools/prd-orchestrator/src/one-child-transaction.ts',
          'design/app.pen',
          'pnpm-lock.yaml',
          'tools/prd-orchestrator/package.json',
        ],
        dependencyChangeJustification: 'Sandcastle transaction adapter dependency is required.',
        impactAnalysis,
      }),
    ).toEqual({
      action: 'accept',
      allowedFiles: [
        'tools/prd-orchestrator/src/one-child-transaction.ts',
        'design/app.pen',
        'pnpm-lock.yaml',
        'tools/prd-orchestrator/package.json',
      ],
      dependencyChanges: ['pnpm-lock.yaml', 'tools/prd-orchestrator/package.json'],
      unexpectedFiles: [],
    })

    expect(
      enforceWriteSurface({
        changedFiles: ['apps/desktop/src/main.ts'],
        dependencyChangeJustification: undefined,
        impactAnalysis,
      }),
    ).toMatchObject({
      action: 'reanalyse',
      unexpectedFiles: ['apps/desktop/src/main.ts'],
    })
  })

  it('allows changed files declared as shared contract surfaces', () => {
    expect(
      enforceWriteSurface({
        changedFiles: ['tools/prd-orchestrator/src/index.ts'],
        dependencyChangeJustification: undefined,
        impactAnalysis: {
          ...impactAnalysis,
          expectedFiles: [],
          sharedContracts: ['tools/prd-orchestrator/src/index.ts'],
        },
      }),
    ).toMatchObject({
      action: 'accept',
      allowedFiles: ['tools/prd-orchestrator/src/index.ts'],
      unexpectedFiles: [],
    })
  })

  it('selects host verification commands from affected modules and targeted tests', () => {
    expect(selectVerificationCommands(impactAnalysis)).toEqual([
      'pnpm lint',
      'pnpm --filter @cv-maxxing/desktop typecheck',
      'pnpm --filter @cv-maxxing/prd-orchestrator typecheck',
      'pnpm --filter @cv-maxxing/desktop test:visual',
      "pnpm --filter @cv-maxxing/prd-orchestrator test:unit -- 'tools/prd-orchestrator/src/__tests__/one-child-transaction.test.ts'",
    ])

    expect(
      selectVerificationCommands({
        designFiles: ['design/app.pen'],
        expectedFiles: ['apps/desktop/src/renderer/App.tsx'],
        expectedModules: ['@cv-maxxing/desktop'],
        riskLevel: 'medium',
        sharedContracts: [],
        tests: [],
      }),
    ).toContain('pnpm --filter @cv-maxxing/desktop test:visual')

    expect(
      selectVerificationCommands({
        designFiles: [],
        expectedFiles: ['tools/prd-orchestrator/src/planning.ts'],
        expectedModules: ['@cv-maxxing/prd-orchestrator/planning'],
        riskLevel: 'low',
        sharedContracts: [],
        tests: ['tools/prd-orchestrator/src/__tests__/planning.test.ts'],
      }),
    ).toContain(
      "pnpm --filter @cv-maxxing/prd-orchestrator test:unit -- 'tools/prd-orchestrator/src/__tests__/planning.test.ts'",
    )

    expect(
      selectVerificationCommands({
        designFiles: [],
        expectedFiles: ['design/cv.pen'],
        expectedModules: ['@cv-maxxing/prd-orchestrator'],
        pencilRequiredDesignFiles: ['design/cv.pen'],
        riskLevel: 'medium',
        sharedContracts: [],
        tests: ["tools/prd-orchestrator/src/__tests__/quoted path's test.ts"],
      }),
    ).toContain('pnpm --filter @cv-maxxing/desktop test:visual')
    expect(
      selectVerificationCommands({
        designFiles: [],
        expectedFiles: ['design/cv.pen'],
        expectedModules: ['@cv-maxxing/prd-orchestrator'],
        pencilRequiredDesignFiles: ['design/cv.pen'],
        riskLevel: 'medium',
        sharedContracts: [],
        tests: ["tools/prd-orchestrator/src/__tests__/quoted path's test.ts"],
      }),
    ).toContain(
      String.raw`pnpm --filter @cv-maxxing/prd-orchestrator test:unit -- 'tools/prd-orchestrator/src/__tests__/quoted path'\''s test.ts'`,
    )
  })

  it('blocks commits when changed .pen files lack Pencil verification evidence', () => {
    const plan = planOneChildTransaction({
      childCommitHash: undefined,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers: [85],
      dependencyChangeJustification: undefined,
      existingLedger: [],
      impactAnalysis,
      issues,
      mainBranchStatus: {
        clean: true,
        currentBranch: 'main',
        upToDate: true,
      },
      remoteAutomationPr: undefined,
      verificationEvidence: ['pnpm lint', 'pnpm --filter @cv-maxxing/desktop test:visual'],
      workerChangedFiles: ['design/app.pen'],
    })

    expect(plan.status).toBe('blocked')
    expect(plan.blockers).toEqual([
      'Pencil verification evidence missing for .pen design changes: design/app.pen. Provide Pencil screenshot evidence or saved persistence evidence before committing.',
    ])
    expect(plan.pencilVerificationDecision).toEqual({
      missingEvidenceFiles: ['design/app.pen'],
      requiredFiles: ['design/app.pen'],
      satisfied: false,
    })
  })

  it('accepts .pen changes when Pencil screenshot or persistence evidence is present', () => {
    expect(
      validatePencilVerificationEvidence({
        changedFiles: ['design/app.pen'],
        impactAnalysis,
        verificationEvidence: ['Pencil screenshot captured for design/app.pen'],
      }),
    ).toEqual({
      missingEvidenceFiles: [],
      requiredFiles: ['design/app.pen'],
      satisfied: true,
    })
    expect(
      validatePencilVerificationEvidence({
        changedFiles: ['design/app.pen'],
        impactAnalysis,
        verificationEvidence: ['Pencil persistence verified via git diff for design/app.pen'],
      }),
    ).toMatchObject({
      satisfied: true,
    })
  })

  it('does not force Pencil verification for non-design tasks', () => {
    expect(
      validatePencilVerificationEvidence({
        changedFiles: ['tools/prd-orchestrator/src/one-child-transaction.ts'],
        impactAnalysis,
        verificationEvidence: ['pnpm lint'],
      }),
    ).toEqual({
      missingEvidenceFiles: [],
      requiredFiles: ['design/app.pen'],
      satisfied: true,
    })

    expect(
      validatePencilVerificationEvidence({
        changedFiles: ['design/cv.html'],
        impactAnalysis: {
          ...impactAnalysis,
          designFiles: ['design/cv.html'],
        },
        verificationEvidence: [],
      }),
    ).toMatchObject({
      satisfied: true,
    })
  })

  it('records blockers when clean up-to-date main or write-surface checks fail', () => {
    const plan = planOneChildTransaction({
      childCommitHash: undefined,
      codeRabbitStatus: 'not run',
      completedChildIssueNumbers: [85],
      dependencyChangeJustification: undefined,
      existingLedger: [],
      impactAnalysis,
      issues,
      mainBranchStatus: {
        clean: false,
        currentBranch: 'feature/orchestration',
        upToDate: false,
      },
      remoteAutomationPr: undefined,
      verificationEvidence: [],
      workerChangedFiles: ['apps/desktop/src/main.ts'],
    })

    expect(plan.status).toBe('blocked')
    expect(plan.blockers).toEqual([
      'run --one-child must start from clean, up-to-date main',
      'worker diff touched files outside impact-analysis write surface: apps/desktop/src/main.ts',
    ])
    expect(plan.prBodyAfterChildUpdate).toContain(
      '| #86 | Implement one child task end to end through the draft PR | blocked | - | blocked before commit | not run |',
    )
  })

  it('plans evidence-based recovery instead of stopping at recoverable failures', () => {
    expect(planFailureRecovery({ failure: 'unexpected-write-surface' })).toEqual({
      action: 'reanalyse-write-surface',
      reason: 'Unexpected worker changes require fresh impact analysis before application.',
    })
    expect(planFailureRecovery({ failure: 'verification-failed' })).toEqual({
      action: 'repair-worker-output',
      reason: 'Host verification failed on the PRD branch after applying worker output.',
    })
    expect(planFailureRecovery({ failure: 'external-blocker' })).toEqual({
      action: 'record-blocker',
      reason: 'No autonomous progress remains; record the blocker in run state and PR ledger.',
    })
  })

  it('renders a concise run --one-child transaction preview', () => {
    const plan = planOneChildTransaction({
      childCommitHash: 'abc123456789',
      codeRabbitStatus: 'passed',
      completedChildIssueNumbers: [85],
      dependencyChangeJustification: undefined,
      existingLedger: [],
      impactAnalysis,
      issues,
      mainBranchStatus: {
        clean: true,
        currentBranch: 'main',
        upToDate: true,
      },
      remoteAutomationPr: undefined,
      verificationEvidence: ['pnpm lint'],
      workerChangedFiles: ['tools/prd-orchestrator/src/one-child-transaction.ts'],
    })

    expect(renderOneChildTransactionPlan(plan)).toContain(
      'Selected child: #86 Implement one child task end to end through the draft PR',
    )
    expect(renderOneChildTransactionPlan(plan)).toContain('Worker branch: agent/prd-80-child-86')
  })
})
