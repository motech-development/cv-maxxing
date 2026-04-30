import { describe, expect, it } from 'vitest'

import {
  createRepoRunLockPath,
  createRunStatePath,
  evaluateCleanupPlan,
  evaluatePreflight,
  evaluateRunLock,
  formatRunStatus,
} from '../index.js'

const healthyPreflightInputs = {
  baselineRepoCommandsAvailable: true,
  ciPollingAvailable: true,
  cleanWorkingTree: true,
  codeRabbitAvailable: true,
  codexAvailable: true,
  dockerAvailable: true,
  githubReadWriteAvailable: true,
  gitPushAvailable: true,
  mainUpdateAvailable: true,
  nodeAvailable: true,
  pnpmAvailable: true,
  sandcastleAvailable: true,
  sandcastleDockerImageAvailable: true,
} as const

describe('run guardrails', () => {
  it('plans startup preflight across required operational capabilities', () => {
    expect(evaluatePreflight(healthyPreflightInputs)).toEqual({
      blockers: [],
      checks: [
        {
          name: 'clean working tree',
          passed: true,
        },
        {
          name: 'main can be updated',
          passed: true,
        },
        {
          name: 'GitHub read/write capability',
          passed: true,
        },
        {
          name: 'git push capability',
          passed: true,
        },
        {
          name: 'Docker availability',
          passed: true,
        },
        {
          name: 'Sandcastle availability',
          passed: true,
        },
        {
          name: 'Sandcastle Docker image (run `pnpm exec sandcastle docker build-image`)',
          passed: true,
        },
        {
          name: 'CodeRabbit availability',
          passed: true,
        },
        {
          name: 'Codex availability',
          passed: true,
        },
        {
          name: 'CI polling capability',
          passed: true,
        },
        {
          name: 'Node availability',
          passed: true,
        },
        {
          name: 'pnpm availability',
          passed: true,
        },
        {
          name: 'baseline repo commands availability',
          passed: true,
        },
      ],
      ready: true,
    })

    expect(
      evaluatePreflight({
        ...healthyPreflightInputs,
        cleanWorkingTree: false,
        sandcastleAvailable: false,
        sandcastleDockerImageAvailable: false,
      }).blockers,
    ).toEqual([
      'clean working tree',
      'Sandcastle availability',
      'Sandcastle Docker image (run `pnpm exec sandcastle docker build-image`)',
    ])
  })

  it('enforces one active PRD run per repo with local lock and remote PR detection', () => {
    expect(
      evaluateRunLock({
        existingLock: undefined,
        nowEpochMs: 1000,
        processIdsAlive: [],
        remoteAutomationPr: undefined,
      }),
    ).toEqual({
      action: 'acquire',
      blockers: [],
      recoverableStaleLock: false,
    })

    expect(
      evaluateRunLock({
        existingLock: {
          heartbeatEpochMs: 900,
          phase: 'running',
          pid: 42,
          prdIssueNumber: 80,
          runId: 'run-1',
        },
        nowEpochMs: 1000,
        processIdsAlive: [42],
        remoteAutomationPr: undefined,
      }),
    ).toEqual({
      action: 'block',
      blockers: ['Local run run-1 for PRD #80 is active on process 42'],
      recoverableStaleLock: false,
    })

    expect(
      evaluateRunLock({
        existingLock: undefined,
        nowEpochMs: 1000,
        processIdsAlive: [],
        remoteAutomationPr: {
          branchName: 'agent/prd-80-automate-prd-implementation',
          isDraft: true,
          prNumber: 12,
          prdIssueNumber: 80,
          url: 'https://github.com/motech-development/cv-maxxing/pull/12',
        },
      }),
    ).toEqual({
      action: 'resume-remote',
      blockers: [],
      recoverableStaleLock: false,
    })
  })

  it('recovers stale local locks only when the recorded process is not alive', () => {
    expect(
      evaluateRunLock({
        existingLock: {
          heartbeatEpochMs: 0,
          phase: 'running',
          pid: 99,
          prdIssueNumber: 80,
          runId: 'run-stale',
        },
        nowEpochMs: 900_000,
        processIdsAlive: [],
        remoteAutomationPr: undefined,
      }),
    ).toEqual({
      action: 'recover-stale-lock',
      blockers: [],
      recoverableStaleLock: true,
      recoveryNote:
        'Recover completed task state from GitHub and branch history, not from the stale lock.',
    })
  })

  it('keeps run state under .git/prd-orchestrator/runs/<run-id>', () => {
    expect(createRunStatePath('2026-04-28T160000Z-prd-80')).toBe(
      '.git/prd-orchestrator/runs/2026-04-28T160000Z-prd-80',
    )
    expect(createRepoRunLockPath()).toBe('.git/prd-orchestrator/lock.json')
  })

  it('formats status with active PRD, PR, phase, child progress, health, and link', () => {
    expect(
      formatRunStatus({
        activePrdIssueNumber: 80,
        blockers: ['waiting for CodeRabbit'],
        branchName: 'agent/prd-80-automate-prd-implementation',
        ciStatus: 'not started',
        codeRabbitStatus: 'reviewing',
        completedChildren: [81, 82],
        currentChildIssueNumber: 83,
        heartbeatIso: '2026-04-28T16:00:00.000Z',
        lastCommand: 'coderabbit review --agent',
        phase: 'reviewing-child',
        prNumber: 12,
        prUrl: 'https://github.com/motech-development/cv-maxxing/pull/12',
      }),
    ).toBe(`PRD Orchestrator Status
Active PRD: #80
PR: #12
Branch: agent/prd-80-automate-prd-implementation
Phase: reviewing-child
Current child: #83
Completed children: #81, #82
Blockers: waiting for CodeRabbit
Heartbeat: 2026-04-28T16:00:00.000Z
Last command: coderabbit review --agent
CodeRabbit: reviewing
CI: not started
PR link: https://github.com/motech-development/cv-maxxing/pull/12`)
  })

  it('formats useful status after a run has no active child left', () => {
    expect(
      formatRunStatus({
        activePrdIssueNumber: 80,
        blockers: [],
        branchName: 'agent/prd-80-automate-prd-implementation',
        ciStatus: 'passed',
        codeRabbitStatus: 'passed',
        completedChildren: [81, 82, 83],
        currentChildIssueNumber: undefined,
        heartbeatIso: undefined,
        lastCommand: 'final audit posted',
        phase: 'ready-for-review',
        prNumber: 12,
        prUrl: 'https://github.com/motech-development/cv-maxxing/pull/12',
      }),
    ).toContain(`Phase: ready-for-review
Current child: none
Completed children: #81, #82, #83
Blockers: none`)
  })

  it('applies cleanup retention without touching active runs or committed config', () => {
    expect(
      evaluateCleanupPlan({
        activeRunIds: ['run-active'],
        artifacts: [
          {
            category: 'run-log',
            lastModifiedEpochMs: 0,
            path: '.git/prd-orchestrator/runs/run-old/agent.log',
            runId: 'run-old',
          },
          {
            category: 'sandcastle-artifact',
            lastModifiedEpochMs: 0,
            path: '.sandcastle/logs/run-old.log',
            runId: 'run-old',
          },
          {
            category: 'sandbox-branch',
            lastModifiedEpochMs: 0,
            path: 'agent/prd-80-child-81',
            runId: 'run-old',
          },
          {
            category: 'container',
            lastModifiedEpochMs: 0,
            path: 'prd-orchestrator-run-old',
            runId: 'run-old',
          },
          {
            category: 'run-log',
            lastModifiedEpochMs: 0,
            path: '.git/prd-orchestrator/runs/run-active/agent.log',
            runId: 'run-active',
          },
          {
            category: 'committed-config',
            lastModifiedEpochMs: 0,
            path: '.sandcastle/Dockerfile',
          },
        ],
        nowEpochMs: 8 * 24 * 60 * 60 * 1000,
        retentionDays: 7,
      }),
    ).toEqual({
      preserve: ['.git/prd-orchestrator/runs/run-active/agent.log', '.sandcastle/Dockerfile'],
      remove: [
        '.git/prd-orchestrator/runs/run-old/agent.log',
        '.sandcastle/logs/run-old.log',
        'agent/prd-80-child-81',
        'prd-orchestrator-run-old',
      ],
    })
  })

  it('preserves active PRD runs, active Sandcastle artifacts, committed config, and live processes', () => {
    expect(
      evaluateCleanupPlan({
        activeRunIds: ['run-active'],
        artifacts: [
          {
            category: 'run-log',
            lastModifiedEpochMs: 0,
            path: '.git/prd-orchestrator/runs/run-active/agent.log',
            runId: 'run-active',
          },
          {
            category: 'sandcastle-artifact',
            lastModifiedEpochMs: 0,
            path: '.sandcastle/worktrees/run-active',
            runId: 'run-active',
          },
          {
            category: 'committed-config',
            lastModifiedEpochMs: 0,
            path: '.sandcastle/Dockerfile',
          },
          {
            category: 'container',
            lastModifiedEpochMs: 0,
            path: 'sandcastle-live',
            pid: 456,
          },
          {
            category: 'run-log',
            lastModifiedEpochMs: 0,
            path: '.git/prd-orchestrator/runs/run-old/agent.log',
            runId: 'run-old',
          },
        ],
        liveProcessIds: [456],
        nowEpochMs: 8 * 24 * 60 * 60 * 1000,
        retentionDays: 7,
      }),
    ).toEqual({
      preserve: [
        '.git/prd-orchestrator/runs/run-active/agent.log',
        '.sandcastle/worktrees/run-active',
        '.sandcastle/Dockerfile',
        'sandcastle-live',
      ],
      remove: ['.git/prd-orchestrator/runs/run-old/agent.log'],
    })
  })
})
