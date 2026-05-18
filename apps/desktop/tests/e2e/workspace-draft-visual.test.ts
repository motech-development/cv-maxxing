import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  importOriginalCvFromFirstLaunch,
  openJobsFromYourCv,
  reviewPastedVacancy,
} from './visual/bootstrap.js';
import { visualScreenshotBudgets } from './visual/budgets.js';
import {
  createBaseOriginalCvLines,
  createEditableDraftVacancyFixture,
  createPastedVacancyFixture,
  createPdfDocumentBuffer,
  createVacancyNormalizationFixtureOutput,
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

test('captures the workspace empty screen', async () => {
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
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('workspace-empty-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-empty-screen.png'],
  });

  await electronApp.close();
});

test('captures the workspace editable draft screen', async () => {
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
  await page.getByLabel('Job link').fill('https://jobs.example.com/staff-platform-designer');
  await page.getByLabel('Job description').fill(createEditableDraftVacancyFixture());
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('workspace-editable-draft-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-editable-draft-screen.png'],
  });

  await electronApp.close();
});

test('captures the workspace reviewed draft screen', async () => {
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
  await reviewPastedVacancy({
    page,
    vacancyText: createPastedVacancyFixture(),
  });
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('workspace-reviewed-draft-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-reviewed-draft-screen.png'],
  });

  await electronApp.close();
});

test('captures the workspace review error screen', async () => {
  const testPaths = await createVisualTestPaths();
  const nonEnglishVacancyText = [
    'Ingeniero de plataforma',
    'Example Labs',
    'Madrid, España',
    '',
    'Responsabilidades',
    '- Diseñar productos para usuarios técnicos con equipos de ingeniería.',
    '- Colaborar con investigación y operaciones.',
    '',
    'Requisitos',
    '- Experiencia enviando software de flujo de trabajo.',
    '- Comunicación escrita sólida.',
  ].join('\n');

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer(createBaseOriginalCvLines()));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: createVacancyNormalizationFixtureOutput({
      bodyText: [
        'Ingeniero de plataforma',
        'Example Labs',
        'Madrid, España',
        'Responsabilidades',
        'Diseñar productos para usuarios técnicos con equipos de ingeniería.',
        'Colaborar con investigación y operaciones.',
        'Requisitos',
        'Experiencia enviando software de flujo de trabajo.',
        'Comunicación escrita sólida.',
      ].join('\n'),
      employer: 'Example Labs',
      location: 'Madrid, España',
      requirements: [],
      responsibilities: [],
      title: 'Ingeniero de plataforma',
    }),
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
  await page.getByLabel('Job link').fill('https://jobs.example.com/platform-engineer-es');
  await page.getByLabel('Job description').fill(nonEnglishVacancyText);
  await page.getByRole('button', { name: 'Check job details' }).nth(1).click();
  await expect(
    page.getByText(
      'CV Maxxing v1 supports British English only. Review an English job before tailoring your CV.',
    ),
  ).toBeVisible();
  await hideScrollbars(page);
  await expect(page).toHaveScreenshot('workspace-review-error-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-review-error-screen.png'],
  });

  await electronApp.close();
});
