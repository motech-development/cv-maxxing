import { readFile } from 'node:fs/promises'

import { check } from 'prettier'
import { describe, expect, it } from 'vitest'

const WORKFLOW_FILE = '.github/workflows/update-desktop-visual-snapshots.yml'

const getWorkflowBlock = (workflow: string, startMarker: string, endMarker?: string): string => {
  const startIndex = workflow.indexOf(startMarker)
  const endIndex = endMarker === undefined ? workflow.length : workflow.indexOf(endMarker)

  expect(startIndex).toBeGreaterThan(-1)
  expect(endIndex).toBeGreaterThan(startIndex)

  return workflow.slice(startIndex, endIndex)
}

describe('desktop visual snapshot updater workflow', () => {
  it('is valid formatted YAML', async () => {
    const workflow = await readFile(WORKFLOW_FILE, 'utf8')

    await expect(
      check(workflow, {
        filepath: WORKFLOW_FILE,
        parser: 'yaml',
        singleQuote: true,
      }),
    ).resolves.toBe(true)
  })

  it('defines the guarded manual dispatch required by issue 127', async () => {
    const workflow = await readFile(WORKFLOW_FILE, 'utf8')
    const dispatchBlock = getWorkflowBlock(workflow, 'workflow_dispatch:', 'permissions:')
    const permissionsBlock = getWorkflowBlock(workflow, 'permissions:', 'jobs:')
    const jobBlock = getWorkflowBlock(workflow, 'update-desktop-visual-snapshots:', 'steps:')
    const resolveBlock = getWorkflowBlock(
      workflow,
      'Resolve pull request metadata',
      'Refuse fork pull requests',
    )
    const forkGuardBlock = getWorkflowBlock(
      workflow,
      'Refuse fork pull requests',
      'Check out pull request branch',
    )
    const forkGuardIndex = workflow.indexOf('Refuse fork pull requests')
    const checkoutIndex = workflow.indexOf('Check out pull request branch')

    expect(dispatchBlock).toContain('pr_number:')
    expect(dispatchBlock).toContain('required: true')
    expect(jobBlock).toContain('runs-on: macos-15')
    expect(permissionsBlock).toContain('pull-requests: read')
    expect(permissionsBlock).toContain('contents: write')
    expect(resolveBlock).toMatch(/PR_NUMBER: \$\{\{ inputs\.pr_number \}\}/u)
    expect(resolveBlock).toMatch(/gh pr view "\$\{PR_NUMBER\}"/u)
    expect(resolveBlock).toContain(
      '--json headRefName,headRefOid,headRepository,headRepositoryOwner',
    )
    expect(resolveBlock).toContain('head_repository_name')
    expect(resolveBlock).toContain('head_repository_owner')
    expect(resolveBlock).toContain('head_ref_name')
    expect(resolveBlock).toContain('head_ref_oid')
    expect(forkGuardBlock).toContain('PULL_HEAD_OWNER')
    expect(forkGuardBlock).toContain('PULL_HEAD_REPO')
    expect(forkGuardIndex).toBeGreaterThan(-1)
    expect(checkoutIndex).toBeGreaterThan(-1)
    expect(forkGuardIndex).toBeLessThan(checkoutIndex)
  })

  it('commits only desktop visual snapshot PNG updates required by issue 128', async () => {
    const workflow = await readFile(WORKFLOW_FILE, 'utf8')
    const checkoutIndex = workflow.indexOf('Check out pull request branch')
    const pnpmSetupBlock = getWorkflowBlock(workflow, 'Set up pnpm', 'Set up Node.js')
    const nodeSetupBlock = getWorkflowBlock(workflow, 'Set up Node.js', 'Install dependencies')
    const installBlock = getWorkflowBlock(
      workflow,
      'Install dependencies',
      'Run desktop visual snapshot update',
    )
    const updateBlock = getWorkflowBlock(
      workflow,
      'Run desktop visual snapshot update',
      'Commit desktop visual snapshot updates',
    )
    const commitBlock = getWorkflowBlock(
      workflow,
      'Commit desktop visual snapshot updates',
      'Upload Playwright artifacts',
    )
    const updateIndex = workflow.indexOf('Run desktop visual snapshot update')
    const commitIndex = workflow.indexOf('Commit desktop visual snapshot updates')
    const worktreeCheckIndex = commitBlock.indexOf('git ls-files --modified --deleted --others')
    const snapshotStagingIndex = commitBlock.indexOf(
      "git add -- 'apps/desktop/tests/e2e/*-snapshots/*.png'",
    )

    expect(pnpmSetupBlock).toContain('uses: pnpm/action-setup@v5')
    expect(nodeSetupBlock).toContain('uses: actions/setup-node@v6')
    expect(nodeSetupBlock).toContain('node-version-file: .nvmrc')
    expect(nodeSetupBlock).toContain('cache: pnpm')
    expect(installBlock).toContain('pnpm install --frozen-lockfile')
    expect(updateBlock).toContain('pnpm --filter @cv-maxxing/desktop test:visual:update')
    expect(commitBlock).toContain("git add -- 'apps/desktop/tests/e2e/*-snapshots/*.png'")
    expect(commitBlock).toContain('git ls-files --modified --deleted --others --exclude-standard')
    expect(commitBlock).toContain('git diff --cached --quiet --exit-code')
    expect(commitBlock).toContain('test(desktop): update visual snapshots')
    expect(commitBlock).toMatch(
      /PULL_HEAD_REF: \$\{\{ steps\.pull-request\.outputs\.head_ref_name \}\}/u,
    )
    expect(commitBlock).toMatch(/git push origin "HEAD:\$\{PULL_HEAD_REF\}"/u)
    expect(commitBlock).not.toContain('git merge')
    expect(commitBlock).not.toContain('git rebase')
    expect(checkoutIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(checkoutIndex)
    expect(commitIndex).toBeGreaterThan(updateIndex)
    expect(worktreeCheckIndex).toBeGreaterThan(-1)
    expect(snapshotStagingIndex).toBeGreaterThan(worktreeCheckIndex)
  })

  it('uploads failure diagnostics without PR comments required by issue 129', async () => {
    const workflow = await readFile(WORKFLOW_FILE, 'utf8')
    const uploadBlock = getWorkflowBlock(workflow, 'Upload Playwright artifacts')
    const updateIndex = workflow.indexOf('Run desktop visual snapshot update')
    const uploadIndex = workflow.indexOf('Upload Playwright artifacts')

    expect(uploadBlock).toContain('if: failure()')
    expect(uploadBlock).toContain('uses: actions/upload-artifact@v7')
    expect(uploadBlock).toContain('if-no-files-found: ignore')
    expect(uploadBlock).toContain('apps/desktop/playwright-report')
    expect(uploadBlock).toContain('apps/desktop/test-results')
    expect(workflow).not.toContain('gh pr comment')
    expect(workflow).not.toContain('gh issue comment')
    expect(workflow).not.toContain('actions/github-script')
    expect(updateIndex).toBeGreaterThan(-1)
    expect(uploadIndex).toBeGreaterThan(-1)
    expect(uploadIndex).toBeGreaterThan(updateIndex)
  })
})
