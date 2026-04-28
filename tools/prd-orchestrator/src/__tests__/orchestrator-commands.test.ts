import { describe, expect, it } from 'vitest'

import { prdOrchestratorCommands, prdOrchestratorLifecycle } from '../index.js'

describe('PRD orchestrator command scaffold', () => {
  it('exposes the v1 command lifecycle in execution order', () => {
    expect(prdOrchestratorCommands.map((command) => command.name)).toEqual([
      'plan',
      'run --one-child',
      'resume-pr <number>',
      'status',
      'cleanup',
    ])
  })

  it('keeps planning and observability commands non-mutating', () => {
    const nonMutatingCommands = prdOrchestratorCommands
      .filter((command) => !command.mutatesRepository)
      .map((command) => command.name)

    expect(nonMutatingCommands).toEqual(['plan', 'status'])
  })

  it('records one draft PR per PRD as the initial lifecycle boundary', () => {
    expect(prdOrchestratorLifecycle).toEqual({
      automationOwner: '@cv-maxxing/prd-orchestrator',
      draftPullRequestPolicy: 'one draft PR per PRD',
      humanMergeBoundary: true,
      runStateRoot: '.git/prd-orchestrator/runs',
    })
  })
})
