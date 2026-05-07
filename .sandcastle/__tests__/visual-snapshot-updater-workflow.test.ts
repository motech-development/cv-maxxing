import { readFile } from 'node:fs/promises'

import { check } from 'prettier'
import { describe, expect, it } from 'vitest'

const WORKFLOW_FILE = '.github/workflows/update-desktop-visual-snapshots.yml'

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
    const forkGuardIndex = workflow.indexOf('Refuse fork pull requests')
    const checkoutIndex = workflow.indexOf('Check out pull request branch')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('pr_number:')
    expect(workflow).toContain('required: true')
    expect(workflow).toContain('runs-on: macos-15')
    expect(workflow).toContain('pull-requests: read')
    expect(workflow).toContain('contents: write')
    expect(workflow).toMatch(/PR_NUMBER: \$\{\{ inputs\.pr_number \}\}/u)
    expect(workflow).toMatch(/gh pr view "\$\{PR_NUMBER\}"/u)
    expect(workflow).toContain('--json headRefName,headRefOid,headRepository,headRepositoryOwner')
    expect(workflow).toContain('head_repository_name')
    expect(workflow).toContain('head_repository_owner')
    expect(workflow).toContain('head_ref_name')
    expect(workflow).toContain('head_ref_oid')
    expect(workflow).toContain('Refuse fork pull requests')
    expect(workflow).toContain('Check out pull request branch')
    expect(forkGuardIndex).toBeGreaterThan(-1)
    expect(checkoutIndex).toBeGreaterThan(-1)
    expect(forkGuardIndex).toBeLessThan(checkoutIndex)
  })

  it('commits only desktop visual snapshot PNG updates required by issue 128', async () => {
    const workflow = await readFile(WORKFLOW_FILE, 'utf8')
    const checkoutIndex = workflow.indexOf('Check out pull request branch')
    const updateIndex = workflow.indexOf('Run desktop visual snapshot update')
    const commitIndex = workflow.indexOf('Commit desktop visual snapshot updates')
    const worktreeCheckIndex = workflow.indexOf('git ls-files --modified --deleted --others')
    const snapshotStagingIndex = workflow.indexOf(
      "git add -- 'apps/desktop/tests/e2e/*-snapshots/*.png'",
    )

    expect(workflow).toContain('uses: pnpm/action-setup@v5')
    expect(workflow).toContain('uses: actions/setup-node@v6')
    expect(workflow).toContain('node-version-file: .nvmrc')
    expect(workflow).toContain('cache: pnpm')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm --filter @cv-maxxing/desktop test:visual:update')
    expect(workflow).toContain("git add -- 'apps/desktop/tests/e2e/*-snapshots/*.png'")
    expect(workflow).toContain('git ls-files --modified --deleted --others --exclude-standard')
    expect(workflow).toContain('git diff --cached --quiet --exit-code')
    expect(workflow).toContain('test(desktop): update visual snapshots')
    expect(workflow).toMatch(
      /PULL_HEAD_REF: \$\{\{ steps\.pull-request\.outputs\.head_ref_name \}\}/u,
    )
    expect(workflow).toMatch(/git push origin "HEAD:\$\{PULL_HEAD_REF\}"/u)
    expect(workflow).not.toContain('git merge')
    expect(workflow).not.toContain('git rebase')
    expect(checkoutIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(checkoutIndex)
    expect(commitIndex).toBeGreaterThan(updateIndex)
    expect(worktreeCheckIndex).toBeGreaterThan(commitIndex)
    expect(snapshotStagingIndex).toBeGreaterThan(worktreeCheckIndex)
  })

  it('uploads failure diagnostics without PR comments required by issue 129', async () => {
    const workflow = await readFile(WORKFLOW_FILE, 'utf8')
    const updateIndex = workflow.indexOf('Run desktop visual snapshot update')
    const uploadIndex = workflow.indexOf('Upload Playwright artifacts')

    expect(workflow).toContain('if: failure()')
    expect(workflow).toContain('uses: actions/upload-artifact@v7')
    expect(workflow).toContain('if-no-files-found: ignore')
    expect(workflow).toContain('apps/desktop/playwright-report')
    expect(workflow).toContain('apps/desktop/test-results')
    expect(workflow).not.toContain('gh pr comment')
    expect(workflow).not.toContain('gh issue comment')
    expect(workflow).not.toContain('actions/github-script')
    expect(updateIndex).toBeGreaterThan(-1)
    expect(uploadIndex).toBeGreaterThan(-1)
    expect(uploadIndex).toBeGreaterThan(updateIndex)
  })
})
