import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  createTailoredApplicationFromPastedVacancy,
  importOriginalCvFromFirstLaunch,
  openJobsFromYourCv,
  openSettings,
} from './visual/bootstrap.js';
import { visualScreenshotBudgets } from './visual/budgets.js';
import {
  createBaseOriginalCvLines,
  createGenerationResultFixture,
  createMultiPageGenerationResultFixture,
  createPastedVacancyFixture,
  createPdfDocumentBuffer,
} from './visual/fixtures.js';
import {
  cleanupVisualTestArtifacts,
  createVisualTestPaths,
  hideScrollbars,
  importedTimestampMask,
  launchDesktopApp,
} from './visual/launch-desktop-app.js';

test.afterEach(async () => {
  await cleanupVisualTestArtifacts();
});

async function expectStableTailoredApplicationPreview(page: Page) {
  await expect
    .poll(
      async () => {
        return (await page.locator('body').textContent()) ?? '';
      },
      {
        timeout: 15_000,
      },
    )
    .toContain('Senior platform engineer');
  await expect(page.getByRole('heading', { name: 'Senior platform engineer' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Page 1 of \d+/u)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel('CV PDF preview')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { exact: true, name: 'CV' })).toBeVisible();
  await expect(page.getByRole('button', { exact: true, name: 'Cover letter' })).toBeVisible();
  await expect(page.getByText('About this job')).toBeVisible();
  await expect(page.getByText('Highlighted in your CV')).toBeVisible();
  await expect(page.getByText('Worth checking')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save CV and cover letter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete this job' })).toBeVisible();
}

test('captures the workspace active adapted CV screen', async () => {
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
  await expectStableTailoredApplicationPreview(page);
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('workspace-active-adapted-cv-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: importedTimestampMask(page),
    maxDiffPixels: visualScreenshotBudgets['workspace-active-adapted-cv-screen.png'],
  });

  await electronApp.close();
});

test('captures the workspace active cover letter screen', async () => {
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
  await expectStableTailoredApplicationPreview(page);
  await page.getByRole('button', { exact: true, name: 'Cover letter' }).click();
  await expect(page.getByLabel('Cover letter PDF preview')).toBeVisible({
    timeout: 15_000,
  });
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('workspace-active-cover-letter-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: importedTimestampMask(page),
    maxDiffPixels: visualScreenshotBudgets['workspace-active-cover-letter-screen.png'],
  });

  await electronApp.close();
});

test('captures the workspace generation overlay', async () => {
  const testPaths = await createVisualTestPaths();

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_DELAY_MS: '5000',
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
  await page.getByLabel('Job description').fill(createPastedVacancyFixture());
  await page.getByLabel('Job description').press('Tab');
  await page.getByRole('button', { name: 'Check job details' }).nth(1).dispatchEvent('click');
  await expect(page.getByText(/Job (details|preview)/)).toBeVisible();
  await page.getByRole('button', { name: 'Tailor your CV' }).click();
  await expect(page.getByRole('status', { name: 'Tailoring your CV...' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('workspace-generation-overlay-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-generation-overlay-screen.png'],
  });

  await electronApp.close();
});

test('captures the workspace application error banner when PDF export fails', async () => {
  const testPaths = await createVisualTestPaths();
  const invalidExportPath = path.join(
    testPaths.rootDirectoryPath,
    'missing-directory',
    'Ada Lovelace - Senior platform engineer - adapted-cv.pdf',
  );

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
    CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH: invalidExportPath,
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
  await expectStableTailoredApplicationPreview(page);
  await page.getByRole('button', { name: 'Save CV and cover letter' }).click();
  await expect(
    page.getByText(
      "We couldn't save the PDF. Check that the destination folder is available on this Mac, then try again.",
    ),
  ).toBeVisible();
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('workspace-application-error-banner-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: importedTimestampMask(page),
    maxDiffPixels: visualScreenshotBudgets['workspace-application-error-banner-screen.png'],
  });

  await electronApp.close();
});

test('captures the second page of a multi-page tailored CV preview', async () => {
  test.setTimeout(90_000);

  const testPaths = await createVisualTestPaths();

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(
      createMultiPageGenerationResultFixture(),
    ),
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
    expectPreview: false,
    page,
    vacancyText: createPastedVacancyFixture(),
  });
  await expectStableTailoredApplicationPreview(page);
  await expect(page.getByRole('button', { exact: true, name: 'Cover letter' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { exact: true, name: 'Cover letter' }).click();
  await expect(page.getByLabel('Cover letter PDF preview')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/Page 1 of (?:[2-9]|[1-9]\d+)/u)).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText(/Page 2 of (?:[2-9]|[1-9]\d+)/u)).toBeVisible();
  await hideScrollbars(page);
  await expect(page.locator('[data-testid="pdf-preview-toolbar"]')).toHaveScreenshot(
    'workspace-multipage-preview-page-2.png',
    {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixels: visualScreenshotBudgets['workspace-multipage-preview-page-2.png'],
    },
  );

  await electronApp.close();
});

test('captures ambient activity on settings while a tailored application preview reloads', async () => {
  const testPaths = await createVisualTestPaths();

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  let electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  let page = await electronApp.firstWindow();

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
  await openSettings(page);

  await electronApp.close();

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'workspace',
    CV_MAXXING_TAILORED_APPLICATION_PREVIEW_DELAY_MS: '15000',
  });

  page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { exact: true, level: 1, name: 'AI' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('status', { name: 'Background activity' })).toBeVisible({
    timeout: 15_000,
  });
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('settings-ambient-activity-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['settings-ambient-activity-screen.png'],
  });

  await electronApp.close();
});
