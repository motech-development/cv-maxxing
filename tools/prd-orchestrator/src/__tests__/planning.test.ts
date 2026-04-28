import { describe, expect, it } from 'vitest'

import {
  createDryRunPlan,
  isOpenPrdIssue,
  parseChildTaskIssue,
  renderDryRunPlan,
} from '../index.js'

const parentPrdBody = `## Problem Statement

Existing coordination is manual.

## User Stories

1. As a maintainer, I want the orchestrator to select the first available PRD.
2. As a maintainer, I want child dependencies parsed into a DAG.
3. As a maintainer, I want HITL tasks to block unattended runs.

## Implementation Decisions

- Detect parent PRDs by open issue titles beginning with \`PRD:\`.
- Discover child tasks by parsing \`## Parent PRD\` sections.

## Testing Decisions

- Unit tests should cover PRD detection and DAG validation.
`

const childOneBody = `## Parent PRD

#80

## What to build

Implement deterministic PRD detection.

## Acceptance criteria

- [ ] Open PRD issues are detected by the existing \`PRD:\` title prefix.
- [ ] PRDs without child issues are ignored as unavailable.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
`

const childTwoBody = `## Parent PRD

#80

## What to build

Implement child dependency planning.

## Acceptance criteria

- [ ] Child dependencies are parsed into a DAG.

## Blocked by

- Blocked by #81

## User stories addressed

- User story 2
`

const childThreeBody = `## Parent PRD

#80

## What to build

Block unattended work when decisions are unresolved.

## Acceptance criteria

- [ ] HITL markers block unattended eligibility.

## Blocked by

- Blocked by #82

## User stories addressed

- User story 3
`

describe('PRD planning from GitHub Markdown', () => {
  it('detects only open issues with the PRD title prefix as PRDs', () => {
    expect(
      isOpenPrdIssue({
        body: parentPrdBody,
        number: 80,
        state: 'OPEN',
        title: 'PRD: Automate PRD implementation',
      }),
    ).toBe(true)

    expect(
      isOpenPrdIssue({
        body: parentPrdBody,
        number: 80,
        state: 'CLOSED',
        title: 'PRD: Automate PRD implementation',
      }),
    ).toBe(false)

    expect(
      isOpenPrdIssue({
        body: childOneBody,
        number: 81,
        state: 'OPEN',
        title: 'Scaffold the PRD orchestrator workspace package',
      }),
    ).toBe(false)
  })

  it('parses child task sections for parent, scope, acceptance, blockers, and user stories', () => {
    expect(
      parseChildTaskIssue({
        body: childTwoBody,
        number: 82,
        state: 'OPEN',
        title: 'Build PRD and child-task planning from GitHub Markdown',
      }),
    ).toEqual({
      acceptanceCriteria: ['Child dependencies are parsed into a DAG.'],
      blockedBy: [81],
      hitlMarkers: [],
      issueNumber: 82,
      parentPrdNumber: 80,
      title: 'Build PRD and child-task planning from GitHub Markdown',
      userStoriesAddressed: [2],
      whatToBuild: 'Implement child dependency planning.',
    })
  })

  it('rejects child tasks without acceptance criteria and blocks HITL markers', () => {
    const plan = createDryRunPlan([
      {
        body: parentPrdBody,
        number: 80,
        state: 'OPEN',
        title: 'PRD: Automate PRD implementation',
      },
      {
        body: childOneBody.replace(/## Acceptance criteria[\S\s]*?## Blocked by/, '## Blocked by'),
        number: 81,
        state: 'OPEN',
        title: 'Scaffold the PRD orchestrator workspace package',
      },
      {
        body: childThreeBody
          .replace(
            'Block unattended work when decisions are unresolved.',
            'HITL: decide whether this should run unattended.',
          )
          .replace('- Blocked by #82', 'None - can start immediately.'),
        number: 83,
        state: 'OPEN',
        title: 'Block unresolved decisions',
      },
    ])

    expect(plan.selectedPrd?.blockers).toEqual([
      '#81 has no acceptance criteria',
      '#83 contains HITL/unresolved-decision markers',
      'User story 2 is not covered by child tasks',
    ])
  })

  it('does not treat acceptance criteria about HITL marker handling as HITL markers', () => {
    const plan = createDryRunPlan([
      {
        body: parentPrdBody,
        number: 80,
        state: 'OPEN',
        title: 'PRD: Automate PRD implementation',
      },
      {
        body: childThreeBody.replace(
          '- [ ] HITL markers block unattended eligibility.',
          '- [ ] HITL or unresolved-decision markers block unattended eligibility.',
        ),
        number: 83,
        state: 'OPEN',
        title: 'Block unresolved decisions',
      },
    ])

    expect(plan.selectedPrd?.blockers).not.toContain(
      '#83 contains HITL/unresolved-decision markers',
    )
  })

  it('builds a child dependency DAG and reports invalid references or cycles', () => {
    expect(
      createDryRunPlan([
        {
          body: parentPrdBody,
          number: 80,
          state: 'OPEN',
          title: 'PRD: Automate PRD implementation',
        },
        {
          body: childOneBody,
          number: 81,
          state: 'OPEN',
          title: 'Scaffold the PRD orchestrator workspace package',
        },
        {
          body: childTwoBody,
          number: 82,
          state: 'OPEN',
          title: 'Build PRD and child-task planning from GitHub Markdown',
        },
        {
          body: childThreeBody,
          number: 83,
          state: 'OPEN',
          title: 'Block unresolved decisions',
        },
      ]).selectedPrd?.childTaskDag,
    ).toEqual([
      {
        dependencies: [],
        issueNumber: 81,
      },
      {
        dependencies: [81],
        issueNumber: 82,
      },
      {
        dependencies: [82],
        issueNumber: 83,
      },
    ])

    expect(
      createDryRunPlan([
        {
          body: parentPrdBody,
          number: 80,
          state: 'OPEN',
          title: 'PRD: Automate PRD implementation',
        },
        {
          body: childOneBody.replace('None - can start immediately.', 'Blocked by #999'),
          number: 81,
          state: 'OPEN',
          title: 'Scaffold the PRD orchestrator workspace package',
        },
      ]).selectedPrd?.blockers,
    ).toContain('#81 depends on unknown child issue #999')

    expect(
      createDryRunPlan([
        {
          body: parentPrdBody,
          number: 80,
          state: 'OPEN',
          title: 'PRD: Automate PRD implementation',
        },
        {
          body: childOneBody.replace('None - can start immediately.', 'Blocked by #82'),
          number: 81,
          state: 'OPEN',
          title: 'Scaffold the PRD orchestrator workspace package',
        },
        {
          body: childTwoBody,
          number: 82,
          state: 'OPEN',
          title: 'Build PRD and child-task planning from GitHub Markdown',
        },
      ]).selectedPrd?.blockers,
    ).toContain('Child task dependencies contain a cycle')
  })

  it('ignores PRDs without child issues and renders a read-only dry-run plan', () => {
    const plan = createDryRunPlan([
      {
        body: parentPrdBody,
        number: 79,
        state: 'OPEN',
        title: 'PRD: Ignore me because I have no child tasks',
      },
      {
        body: parentPrdBody,
        number: 80,
        state: 'OPEN',
        title: 'PRD: Automate PRD implementation',
      },
      {
        body: childOneBody,
        number: 81,
        state: 'OPEN',
        title: 'Scaffold the PRD orchestrator workspace package',
      },
      {
        body: childTwoBody,
        number: 82,
        state: 'OPEN',
        title: 'Build PRD and child-task planning from GitHub Markdown',
      },
    ])

    expect(plan.unavailablePrds).toEqual([
      {
        issueNumber: 79,
        reason: 'PRD has no child issues',
      },
    ])
    expect(plan.selectedPrd?.issueNumber).toBe(80)
    expect(plan.selectedPrd?.warnings).toEqual([
      'Parent implementation/testing decisions require manual coverage review',
    ])
    expect(plan.selectedPrd?.nextExecutableTasks).toEqual([81])
    expect(renderDryRunPlan(plan)).toContain('Selected PRD: #80 PRD: Automate PRD implementation')
    expect(renderDryRunPlan(plan)).toContain('Next executable tasks: #81')
    expect(renderDryRunPlan(plan)).toContain('Writes: none')
  })
})
