import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  NO_WORK_SIGNAL,
  PLANNER_PROMPT_FILE,
  PLAN_END_SIGNAL,
  PLAN_START_SIGNAL,
  parsePlannerOutput,
} from '../main.js'

describe('parsePlannerOutput', () => {
  it('parses planned child issues from the planner JSON payload', () => {
    const result = parsePlannerOutput(`
      Planner notes that should be ignored.
      ${PLAN_START_SIGNAL}
      {
        "parentIssue": {
          "number": 100,
          "title": "PRD: Automate PRD issue workflow",
          "branchName": "prd-100-automate-prd-issue-workflow"
        },
        "children": [
          {
            "number": 101,
            "title": "Implement the first workflow slice",
            "branchName": "child-101-implement-first-workflow-slice"
          }
        ]
      }
      ${PLAN_END_SIGNAL}
    `)

    expect(result).toEqual({
      kind: 'plan',
      plan: {
        parentIssue: {
          number: 100,
          title: 'PRD: Automate PRD issue workflow',
          branchName: 'prd-100-automate-prd-issue-workflow',
        },
        children: [
          {
            number: 101,
            title: 'Implement the first workflow slice',
            branchName: 'child-101-implement-first-workflow-slice',
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
})

describe('planner prompt contract', () => {
  it('documents the GitHub issue inspection commands and JSON output contract', async () => {
    const prompt = await readFile(PLANNER_PROMPT_FILE, 'utf8')

    expect(prompt).toContain('gh issue list')
    expect(prompt).toContain('gh issue view')
    expect(prompt).toContain('"number"')
    expect(prompt).toContain('"title"')
    expect(prompt).toContain('"branchName"')
    expect(prompt).toContain('## Parent PRD')
    expect(prompt).toContain('## Blocked by')
  })
})
