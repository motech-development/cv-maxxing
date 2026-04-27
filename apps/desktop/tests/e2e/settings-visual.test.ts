import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  importOriginalCvFromFirstLaunch,
  openLocalDataSettings,
  openSettings,
} from './visual/bootstrap.js'
import { visualScreenshotBudgets } from './visual/budgets.js'
import { createBaseOriginalCvLines, createPdfDocumentBuffer } from './visual/fixtures.js'
import {
  cleanupVisualTestArtifacts,
  createVisualTestPaths,
  hideScrollbars,
  launchDesktopApp,
} from './visual/launch-desktop-app.js'

test.afterEach(async () => {
  await cleanupVisualTestArtifacts()
})

test('captures the settings AI screen', async () => {
  const testPaths = await createVisualTestPaths()

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()))

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  })
  await openSettings(page)
  await expect(page.getByText('Using')).toBeVisible()
  await expect(page.getByText('Codex')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Get help' })).toHaveCount(0)
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('settings-ai-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['settings-ai-screen.png'],
  })

  await electronApp.close()
})

test('captures the settings local data screen', async () => {
  const testPaths = await createVisualTestPaths()
  const browserCookiesPath = path.join(
    testPaths.appDataRoot,
    'browser-sessions',
    'vacancy-browser-session',
    'Cookies',
  )

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()))
  await mkdir(path.dirname(browserCookiesPath), {
    recursive: true,
  })
  await writeFile(browserCookiesPath, 'top-secret-cookie', 'utf8')

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  })
  await openLocalDataSettings(page)
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('settings-local-data-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['settings-local-data-screen.png'],
  })

  await electronApp.close()
})
