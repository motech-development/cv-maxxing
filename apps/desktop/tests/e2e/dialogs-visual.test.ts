import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  createTailoredApplicationFromPastedVacancy,
  importOriginalCvFromFirstLaunch,
  openJobsFromYourCv,
  openLocalDataSettings,
} from './visual/bootstrap.js';
import { visualScreenshotBudgets } from './visual/budgets.js';
import {
  createBaseOriginalCvLines,
  createGenerationResultFixture,
  createPastedVacancyFixture,
  createPdfDocumentBuffer,
} from './visual/fixtures.js';
import {
  cleanupVisualTestArtifacts,
  createVisualTestPaths,
  hideScrollbars,
  launchDesktopApp,
} from './visual/launch-desktop-app.js';

test.afterEach(async () => {
  await cleanupVisualTestArtifacts();
});

test('captures the draft discard dialog', async () => {
  const testPaths = await createVisualTestPaths();

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  const page = await electronApp.firstWindow();

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  });
  await openJobsFromYourCv(page);
  await page.getByLabel('Job description').fill(createPastedVacancyFixture());
  await page.getByRole('button', { exact: true, name: 'Add a job' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard this job draft?' });

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveScreenshot('workspace-discard-draft-dialog.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-discard-draft-dialog.png'],
  });

  await electronApp.close();
});

test('captures the saved job delete dialog', async () => {
  const testPaths = await createVisualTestPaths();

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  const page = await electronApp.firstWindow();

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  });
  await openJobsFromYourCv(page);
  await createTailoredApplicationFromPastedVacancy({
    page,
    vacancyText: createPastedVacancyFixture(),
  });
  await page.getByRole('button', { name: 'Delete this job' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this job?' });

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveScreenshot('workspace-saved-job-delete-dialog.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-saved-job-delete-dialog.png'],
  });

  await electronApp.close();
});

test('captures the settings reset local data dialog', async () => {
  const testPaths = await createVisualTestPaths();

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  const page = await electronApp.firstWindow();

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  });
  await openLocalDataSettings(page);
  await page.getByRole('button', { name: 'Reset local app data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset local app data?' });

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveScreenshot('workspace-settings-reset-dialog.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-settings-reset-dialog.png'],
  });

  await electronApp.close();
});

test('captures the settings reset local data dialog with a shared runtime alert', async () => {
  const testPaths = await createVisualTestPaths();

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
    CV_MAXXING_TEST_RESET_LOCAL_APP_DATA_ERROR:
      "We couldn't reset your app data right now. Try again.",
  });

  const page = await electronApp.firstWindow();

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  });
  await openLocalDataSettings(page);
  await page.getByRole('button', { name: 'Reset local app data' }).click();

  const dialog = page.getByRole('dialog', { name: 'Reset local app data?' });

  await expect(dialog).toBeVisible();
  await page.getByLabel('Type RESET to confirm destructive reset').fill('RESET');
  await dialog.getByRole('button', { name: 'Reset local app data' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(
    dialog.getByText("We couldn't reset your app data right now. Try again."),
  ).toBeVisible();
  await hideScrollbars(page);
  await expect(dialog).toHaveScreenshot('workspace-settings-reset-dialog-error.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-settings-reset-dialog-error.png'],
  });

  await electronApp.close();
});
