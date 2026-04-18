import { expect, test } from '@playwright/test'

import { visualScreenshotBudgets } from './visual/budgets.js'
import {
  cleanupVisualTestArtifacts,
  hideScrollbars,
  launchDesktopApp,
} from './visual/launch-desktop-app.js'

test.afterEach(async () => {
  await cleanupVisualTestArtifacts()
})

test('captures the AI checking screen', async () => {
  const electronApp = await launchDesktopApp({
    CHECKING_TIMEOUT_MS: '60000',
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'hang',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { level: 1, name: 'Getting AI ready' })).toBeVisible()
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('ai-worker-checking-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['ai-worker-checking-screen.png'],
  })

  await electronApp.close()
})

test('captures the AI sign-in-required screen', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'auth_missing',
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { level: 1, name: 'Connect AI' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('ai-worker-sign-in-required-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['ai-worker-sign-in-required-screen.png'],
  })

  await electronApp.close()
})

test('captures the AI unavailable screen', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'runtime_missing',
    CV_MAXXING_STARTUP_DESTINATION: 'workspace',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { level: 1, name: 'Connect AI' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('ai-worker-unavailable-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['ai-worker-unavailable-screen.png'],
  })

  await electronApp.close()
})
