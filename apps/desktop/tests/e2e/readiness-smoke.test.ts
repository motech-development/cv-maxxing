import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

async function launchDesktopApp(environment: NodeJS.ProcessEnv = {}) {
  const combinedEnvironment = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...environment,
    }).filter(([, value]) => value !== undefined),
  ) as Record<string, string>

  return await electron.launch({
    args: ['dist/main/main.js'],
    cwd: process.cwd(),
    env: combinedEnvironment,
  })
}

test('restores the saved workspace route after the AI worker is already ready', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_STARTUP_DESTINATION: 'workspace_active',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Workspace restored' })).toBeVisible()
  await expect(page.getByText('Unlocked')).toBeVisible()
  await expect(page.getByText('Workspace active')).toBeVisible()
  await expect(
    page.getByText('The local AI worker is ready. Restoring your last tailored application.'),
  ).toBeVisible()

  await electronApp.close()
})

test('retries from an unavailable startup state after local repair', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'runtime_missing',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'ready',
    CV_MAXXING_STARTUP_DESTINATION: 'workspace_empty',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('button', { name: 'Retry check' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry check' }).click()
  await expect(page.getByText('Unlocked')).toBeVisible()
  await expect(page.getByText('Workspace empty')).toBeVisible()
  await expect(
    page.getByText('The local AI worker is ready. Returning you to your workspace.'),
  ).toBeVisible()

  await electronApp.close()
})

test('repairs missing auth and resumes the pending tailored application route', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'auth_missing',
    CV_MAXXING_AI_WORKER_SIGN_IN_STATUS: 'ready',
    CV_MAXXING_PENDING_GENERATION_COMMAND: JSON.stringify({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      vacancyText: 'Senior platform engineer',
    }),
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('button', { name: 'Continue sign-in' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue sign-in' }).click()
  await expect(page.getByRole('heading', { name: 'Resuming tailored application' })).toBeVisible()
  await expect(page.getByText('Workspace loading')).toBeVisible()
  await expect(
    page.getByText('The local AI worker is ready. Resuming your pending tailored application.'),
  ).toBeVisible()

  await electronApp.close()
})

test('fails closed on a bounded health-check timeout and offers a retry path', async () => {
  const electronApp = await launchDesktopApp({
    CHECKING_TIMEOUT_MS: '50',
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'hang',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByText('Checking', { exact: true })).toBeVisible()
  await expect(
    page.getByText(
      'The local AI worker health check timed out. Repair the local setup, then retry the check.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry check' })).toBeVisible()

  await electronApp.close()
})
