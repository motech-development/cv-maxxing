import { readFile } from 'node:fs/promises'

import { check } from 'prettier'
import { describe, expect, it } from 'vitest'

const WORKFLOW_FILE = '.github/workflows/update-desktop-visual-snapshots.yml'

describe('desktop visual snapshot updater workflow', () => {
  it('is valid formatted YAML', async () => {
    const workflow = await readFile(WORKFLOW_FILE, 'utf8')

    await expect(check(workflow, { parser: 'yaml' })).resolves.toBe(true)
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
    expect(workflow).toMatch(/gh pr view "\$\{\{ inputs\.pr_number \}\}"/u)
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
})
