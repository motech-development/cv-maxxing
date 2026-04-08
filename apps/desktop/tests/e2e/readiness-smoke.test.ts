import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

test('opens on the AI worker readiness gate before any workspace surface', async () => {
  const electronApp = await electron.launch({
    args: ['dist/main/main.js'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'checking',
    },
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'AI worker setup' })).toBeVisible()
  await expect(page.getByText('AI worker readiness gate')).toBeVisible()
  await expect(
    page.getByText('Original CV import, job vacancy drafts, and tailored application generation'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Waiting for startup check' })).toBeDisabled()

  await electronApp.close()
})
