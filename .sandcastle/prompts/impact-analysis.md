# PRD Child Task Impact Analysis

You are analyzing a PRD child task before implementation.

## Parent PRD

{{PARENT_PRD}}

## Child Task

{{CHILD_TASK}}

## Sibling Task Summaries

{{SIBLING_SUMMARIES}}

## Required Output

Return a concise impact analysis with:

- expected write surfaces
- design files, with `.pen` files identified as Pencil-required surfaces
- shared files or contracts that make parallel execution risky
- required quality gates
- blockers that require human input

When acceptance criteria require design source changes, inspect `.pen` requirements as a Pencil workflow requirement, not as ordinary text-file editing.

Do not implement the task in this prompt.
