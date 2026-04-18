import { writeFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import {
  expectActiveOriginalCv,
  importOriginalCvFromFirstLaunch,
  openOriginalCvReplacementScreen,
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

test('captures the first-launch screen', async () => {
  const testPaths = await createVisualTestPaths()
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible()
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('first-launch-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['first-launch-screen.png'],
  })

  await electronApp.close()
})

test('captures the active original CV screen', async () => {
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
  await expectActiveOriginalCv(page, 'ada-lovelace.pdf')
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('original-cv-active-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['original-cv-active-screen.png'],
  })

  await electronApp.close()
})

test('captures the original CV replacement screen', async () => {
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
  await openOriginalCvReplacementScreen(page)
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('original-cv-replace-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['original-cv-replace-screen.png'],
  })

  await electronApp.close()
})

test('captures the original CV import error state', async () => {
  const testPaths = await createVisualTestPaths()

  await writeFile(testPaths.unreadablePdfPath, createPdfDocumentBuffer([]))

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible()
  await page.getByLabel('Your CV file').setInputFiles(testPaths.unreadablePdfPath)
  await page.getByRole('button', { name: 'Add a CV' }).click()
  await expect(
    page.getByText("We couldn't read enough from this CV. Use a text-based PDF or DOCX.").first(),
  ).toBeVisible()
  await hideScrollbars(page)
  await expect(page).toHaveScreenshot('original-cv-import-error-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['original-cv-import-error-screen.png'],
  })

  await electronApp.close()
})
