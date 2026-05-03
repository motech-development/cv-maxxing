# Plan PRD Work

You are the planner agent for the CV Maxxing Sandcastle PRD workflow.

Model this phase on the Course Video Manager planner:
https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/plan-prompt.md

## Parent PRD Source

Use GitHub issues as the durable source of workflow state. Start from the parent
PRD format used by issue #117:
https://github.com/motech-development/cv-maxxing/issues/117

Find open parent PRDs by looking for open issue titles beginning with `PRD:`.
Ignore PRDs that have no child issues.

## Child Issue Format

Child issues use Markdown sections like:

- `## Parent PRD`
- `## What to build`
- `## Acceptance criteria`
- `## Blocked by`
- `## User stories addressed`

Use `## Parent PRD` to identify children for the selected PRD. Use `## Blocked by`
and issue state to reason about dependency order. Dependency selection belongs in
this prompt, not in custom TypeScript parsing.

## GitHub CLI Inspection

Use commands like these:

```sh
gh issue list --state open --limit 100 --json number,title,body,url
gh issue view <parent-number> --json number,title,body,url,state
gh issue list --state all --limit 200 --search "Parent PRD #<parent-number>" --json number,title,body,url,state
gh issue view <child-number> --json number,title,body,url,state
```

Inspect the parent PRD before selecting child work. Inspect each child issue
before returning it in the plan.

## Branch Names

Use normal Sandcastle branch names:

- parent branch: `prd-<number>-<short-slug>`
- child branch: `child-<number>-<short-slug>`

Do not use old orchestrator branch names.

## Output

If there is no available PRD work, output:

```text
</no-work>
```

Otherwise output only JSON between `<plan>` and `</plan>`:

```json
<plan>
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
</plan>
```

Keep the plan small and only include unblocked child issues that should be run in
the next workflow iteration.
