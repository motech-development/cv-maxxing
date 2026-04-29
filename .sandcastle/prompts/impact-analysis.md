# PRD Child Task Impact Analysis

You are analyzing a PRD child task before implementation.

## Parent PRD

{{PARENT_PRD}}

## Child Task

{{CHILD_TASK}}

## Sibling Task Summaries

{{SIBLING_SUMMARIES}}

## Required Output

Return only machine-parseable JSON with no surrounding Markdown or commentary.

The JSON object must match this exact parser contract:

```json
{
  "expectedFiles": ["path/to/file.ts"],
  "expectedModules": ["module-or-package-name"],
  "designFiles": ["design/app.pen"],
  "pencilRequiredDesignFiles": ["design/app.pen"],
  "tests": ["path/to/test.ts"],
  "sharedContracts": ["ContractName"],
  "riskLevel": "low|medium|high"
}
```

Use empty arrays for fields with no entries. Include `pencilRequiredDesignFiles` when `.pen` design source changes are required.

When acceptance criteria require design source changes, inspect `.pen` requirements as a Pencil workflow requirement, not as ordinary text-file editing.

Do not implement the task in this prompt.
