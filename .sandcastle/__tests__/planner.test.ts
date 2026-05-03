import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { NO_WORK_SIGNAL, PLAN_END_SIGNAL, PLAN_START_SIGNAL, parsePlannerOutput } from '../main.js'

describe('parsePlannerOutput', () => {
  it('parses planned child issues from the planner JSON payload', () => {
    const result = parsePlannerOutput(`
      Planner notes that should be ignored.
      ${PLAN_START_SIGNAL}
      {
        "parentIssue": {
          "number": 117,
          "title": "PRD: Replace PRD orchestrator with Sandcastle-native workflow",
          "branchName": "prd-117-replace-prd-orchestrator"
        },
        "children": [
          {
            "number": 120,
            "title": "Add Sandcastle planner for PRD and child issue selection",
            "branchName": "child-120-add-sandcastle-planner"
          }
        ]
      }
      ${PLAN_END_SIGNAL}
    `)

    expect(result).toEqual({
      kind: 'plan',
      plan: {
        parentIssue: {
          number: 117,
          title: 'PRD: Replace PRD orchestrator with Sandcastle-native workflow',
          branchName: 'prd-117-replace-prd-orchestrator',
        },
        children: [
          {
            number: 120,
            title: 'Add Sandcastle planner for PRD and child issue selection',
            branchName: 'child-120-add-sandcastle-planner',
          },
        ],
      },
    })
  })

  it('handles the planner no-work signal without requiring JSON', () => {
    expect(parsePlannerOutput(`No unblocked PRD work remains. ${NO_WORK_SIGNAL}`)).toEqual({
      kind: 'no-work',
    })
  })

  it('rejects old orchestrator branch naming in planner output', () => {
    expect(() =>
      parsePlannerOutput(`
        ${PLAN_START_SIGNAL}
        {
          "parentIssue": {
            "number": 117,
            "title": "PRD: Replace PRD orchestrator with Sandcastle-native workflow",
            "branchName": "agent/prd-orchestrator-117"
          },
          "children": []
        }
        ${PLAN_END_SIGNAL}
      `),
    ).toThrow('old PRD orchestrator branch naming')
  })
})

describe('planner prompt contract', () => {
  it('documents the GitHub issue inspection commands and JSON output contract', async () => {
    const prompt = await readFile('.sandcastle/prompts/plan-prd.md', 'utf8')

    expect(prompt).toContain('https://github.com/motech-development/cv-maxxing/issues/117')
    expect(prompt).toContain('gh issue list')
    expect(prompt).toContain('gh issue view')
    expect(prompt).toContain('"number"')
    expect(prompt).toContain('"title"')
    expect(prompt).toContain('"branchName"')
    expect(prompt).toContain('## Parent PRD')
    expect(prompt).toContain('## Blocked by')
    expect(prompt).not.toContain('agent/prd-orchestrator')
    expect(prompt).not.toContain('ledger')
  })
})
