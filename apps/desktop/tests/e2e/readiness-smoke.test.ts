import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { _electron as electron } from 'playwright';

import { createOriginalCvNormalizationFixtureOutput } from './original-cv-normalization-fixture.js';

const temporaryDirectories: string[] = [];
const defaultOriginalCvNormalizationOutput = createOriginalCvNormalizationFixtureOutput();
const defaultVacancyNormalizationOutput = createVacancyNormalizationFixtureOutput();

interface VacancyNormalizationFixtureOverrides {
  bodyText?: string;
  employer?: string | null;
  location?: string | null;
  requirements?: string[];
  responsibilities?: string[];
  title?: string | null;
}

async function launchDesktopApp(environment: NodeJS.ProcessEnv = {}) {
  const combinedEnvironment = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...environment,
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT:
        environment.CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT ??
        defaultOriginalCvNormalizationOutput,
    }).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );

  return await electron.launch({
    args: ['dist/main/main.js'],
    cwd: process.cwd(),
    env: combinedEnvironment,
  });
}

test.afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
    }),
  );
});

async function expectActiveOriginalCv(page: Page, filename: string) {
  await expect(page.getByRole('heading', { name: 'Your CV' })).toBeVisible();
  await expect(page.getByText('Extracted profile')).toBeVisible();
  await expect(page.getByText(filename)).toBeVisible();
}

async function importOriginalCvFromFirstLaunch({
  filename,
  filePath,
  page,
}: {
  filename: string;
  filePath: string;
  page: Page;
}) {
  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();
  await page.getByLabel('Your CV file').setInputFiles(filePath);
  await expectActiveOriginalCv(page, filename);
}

async function openOriginalCvReplacementScreen(page: Page) {
  await page.getByRole('button', { name: 'Add a CV' }).click();
  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();
  await expect(
    page.getByText("Replacing your CV changes the one you'll use for new jobs."),
  ).toBeVisible();
}

async function openJobsFromYourCv(page: Page) {
  await page.getByRole('button', { name: 'Jobs' }).click();
  await expect(page.getByRole('heading', { name: 'Add a job' })).toBeVisible();
}

test('imports the first PDF original CV and lands on the populated Your CV screen', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

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
  await expect(page.getByRole('heading', { name: 'Your CV' })).toBeVisible();
  await expect(page.getByText('ada-lovelace.pdf')).toBeVisible();

  await electronApp.close();

  const databaseBytes = await readFile(path.join(testPaths.appDataRoot, 'app.db'));

  expect(databaseBytes.includes(Buffer.from('Ada Lovelace', 'utf8'))).toBe(false);
});

test('rejects unreadable original CV imports without leaving the first-launch flow', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer([]));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  const page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();
  await page.getByLabel('Your CV file').setInputFiles(testPaths.pdfPath);
  await expect(
    page.getByText("We couldn't read enough from this CV. Use a text-based PDF or DOCX.").first(),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();

  await electronApp.close();
});

test('rejects non-English original CV imports without leaving the first-launch flow', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.docxPath,
    createDocxDocumentBuffer([
      'Ada Lovelace',
      'Diseñadora principal de producto',
      'Resumen',
      'Diseña productos para usuarios técnicos con experiencia en flujos de trabajo complejos.',
      'Experiencia',
      'Diseñadora principal de producto | Analytical Engines Ltd',
      'Dirigió la creación de herramientas de escritorio para equipos técnicos.',
      'Habilidades',
      'Estrategia de producto, investigación UX, prototipado, comunicación',
    ]),
  );

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  const page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();
  await page.getByLabel('Your CV file').setInputFiles(testPaths.docxPath);
  await expect(
    page
      .getByText(
        'CV Maxxing v1 supports British English only. Use an English original CV to continue.',
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();

  await electronApp.close();
});

test('replaces the active CV from the workspace with a DOCX file', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );
  await writeFile(
    testPaths.docxPath,
    createDocxDocumentBuffer([
      'Ada Lovelace',
      'Staff Product Designer',
      'Summary',
      'Product designer adapting CVs for desktop AI tooling.',
      'Experience',
      'Staff Product Designer | Analytical Engines Ltd',
      'Refined import and adaptation workflows for complex authoring tools.',
      'Skills',
      'Design systems, desktop UX, content strategy',
    ]),
  );

  let electronApp = await launchDesktopApp({
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

  await electronApp.close();

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT:
      createOriginalCvNormalizationFixtureOutput({
        experience: [
          {
            dateRange: '2022 — Present',
            employer: 'Analytical Engines Ltd',
            roleTitle: 'Staff Product Designer',
            summary: 'Refined import and adaptation workflows for complex authoring tools.',
          },
        ],
        headline: 'Staff Product Designer',
        skills: ['Design systems', 'Desktop UX', 'Content strategy'],
        summary: 'Product designer adapting CVs for desktop AI tooling.',
      }),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  });

  page = await electronApp.firstWindow();

  await expectActiveOriginalCv(page, 'ada-lovelace.pdf');
  await openOriginalCvReplacementScreen(page);
  await page.getByLabel('Your CV file').setInputFiles(testPaths.docxPath);
  await expectActiveOriginalCv(page, 'ada-lovelace-revised.docx');
  await expect(
    page.getByText(
      "Add a CV to use a different one for future jobs. Your saved jobs won't change.",
    ),
  ).toBeVisible();

  await electronApp.close();

  const databaseBytes = await readFile(path.join(testPaths.appDataRoot, 'app.db'));

  expect(databaseBytes.includes(Buffer.from('Ada Lovelace', 'utf8'))).toBe(false);
  expect(databaseBytes.includes(Buffer.from('Staff Product Designer', 'utf8'))).toBe(false);
});

test('rejects an unreadable original CV replacement without leaving the workspace', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );
  await writeFile(testPaths.unreadablePdfPath, createPdfDocumentBuffer([]));

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
  await openOriginalCvReplacementScreen(page);
  await page.getByLabel('Your CV file').setInputFiles(testPaths.unreadablePdfPath);
  await expect(
    page.getByText("We couldn't read enough from this CV. Use a text-based PDF or DOCX.").first(),
  ).toBeVisible();
  await expect(page.getByText('ada-lovelace.pdf')).toBeVisible();
  await expect(
    page.getByText("Replacing your CV changes the one you'll use for new jobs."),
  ).toBeVisible();

  await electronApp.close();
});

test('captures a LinkedIn vacancy through the internal browser session and restores a ready preview in the app shell', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: JSON.stringify({
      kind: 'success',
      normalizedVacancy: {
        bodyText:
          'Lead product design for authenticated desktop workflows. Partner with engineering and research.',
        employer: 'Example Labs',
        location: 'London, United Kingdom',
        requirements: ['Experience shipping workflow software.'],
        responsibilities: ['Lead product design for authenticated desktop workflows.'],
        title: 'Senior Product Designer',
      },
    }),
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
    CV_MAXXING_VACANCY_BROWSER_SESSION_CLOSE_AFTER_LOAD: 'true',
    CV_MAXXING_VACANCY_BROWSER_SESSION_HTML: [
      '<html>',
      '<head><script>localStorage.setItem("sessionToken","top-secret-token")</script></head>',
      '<body>',
      '<main>',
      '<h1>Senior Product Designer</h1>',
      '<p>Example Labs</p>',
      '<p>London, United Kingdom</p>',
      '<section><h2>Responsibilities</h2><ul><li>Lead product design for authenticated desktop workflows.</li><li>Partner with engineering and research.</li></ul></section>',
      '<section><h2>Requirements</h2><ul><li>Experience shipping workflow software.</li><li>Excellent written communication.</li></ul></section>',
      '<input type="hidden" name="sessionToken" value="top-secret-token" />',
      '</main>',
      '</body>',
      '</html>',
    ].join(''),
    CV_MAXXING_VACANCY_BROWSER_SESSION_RESOLVED_URL: 'https://www.linkedin.com/jobs/view/123456',
  });

  const page = await electronApp.firstWindow();

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  });
  await openJobsFromYourCv(page);
  await page.getByLabel('Job link').fill('https://www.linkedin.com/jobs/view/123456');
  await page.getByRole('button', { name: 'Check job details' }).first().click();
  await expect(page.getByText('Senior Product Designer')).toBeVisible();
  await expect(page.getByText('About the job')).toBeVisible();
  await expect(page.getByText("What you'll be doing")).toBeVisible();
  await expect(page.getByText("What they're looking for")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tailor your CV' })).toBeEnabled();

  await electronApp.close();

  const persistedPlaintext = await readDirectoryText(testPaths.appDataRoot);

  expect(persistedPlaintext.includes('top-secret-token')).toBe(false);
  expect(persistedPlaintext.includes('sessionToken')).toBe(false);
});

test('returns cleanly to the vacancy intake with blocking guidance when the internal browser session still exposes an incomplete page', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: JSON.stringify({
      kind: 'success',
      normalizedVacancy: {
        bodyText: 'Only a partial vacancy summary is available.',
        employer: null,
        location: null,
        requirements: [],
        responsibilities: [],
        title: 'Untitled vacancy',
      },
    }),
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
    CV_MAXXING_VACANCY_BROWSER_SESSION_CLOSE_AFTER_LOAD: 'true',
    CV_MAXXING_VACANCY_BROWSER_SESSION_HTML: [
      '<html>',
      '<body>',
      '<main>',
      '<h1>Sign in to view this job</h1>',
      '<p>Join LinkedIn or sign in to continue.</p>',
      '</main>',
      '</body>',
      '</html>',
    ].join(''),
    CV_MAXXING_VACANCY_BROWSER_SESSION_RESOLVED_URL: 'https://www.linkedin.com/jobs/view/123456',
  });

  const page = await electronApp.firstWindow();

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  });
  await openJobsFromYourCv(page);
  await page.getByLabel('Job link').fill('https://www.linkedin.com/jobs/view/123456');
  await page.getByRole('button', { name: 'Check job details' }).first().click();
  await expect
    .poll(
      async () => {
        return (await page.locator('body').textContent()) ?? '';
      },
      {
        timeout: 15_000,
      },
    )
    .toContain('Add the full job responsibilities or requirements before tailoring your CV.');
  await expect(
    page.getByText('Add the full job responsibilities or requirements before tailoring your CV.'),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Open the job page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tailor your CV' })).toBeDisabled();
  await expect(page.getByLabel('Job link')).toHaveValue(
    'https://www.linkedin.com/jobs/view/123456',
  );

  await electronApp.close();
});

test('blocks a non-English pasted vacancy, preserves the draft, and keeps Tailor your CV disabled', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: createVacancyNormalizationFixtureOutput({
      bodyText: [
        'Ingeniero de plataforma',
        'Example Labs',
        'Madrid, Espana',
        'Responsabilidades',
        'Disenar productos para usuarios tecnicos con equipos de ingenieria.',
        'Colaborar con investigacion y operaciones.',
        'Requisitos',
        'Experiencia enviando software de flujo de trabajo.',
        'Comunicacion escrita solida.',
      ].join('\n'),
      employer: 'Example Labs',
      location: 'Madrid, Espana',
      requirements: [
        'Experiencia enviando software de flujo de trabajo.',
        'Comunicacion escrita solida.',
      ],
      responsibilities: [
        'Disenar productos para usuarios tecnicos con equipos de ingenieria.',
        'Colaborar con investigacion y operaciones.',
      ],
      title: 'Ingeniero de plataforma',
    }),
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  const page = await electronApp.firstWindow();
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
  await expect(page.getByLabel('Job link')).toHaveValue(
    'https://jobs.example.com/platform-engineer-es',
  );
  await expect(page.getByLabel('Job description')).toHaveValue(nonEnglishVacancyText);
  await expect(page.getByRole('button', { name: 'Tailor your CV' })).toBeDisabled();

  await electronApp.close();
});

test('retries from an unavailable startup state and returns to first launch after repair', async () => {
  const testPaths = await createOriginalCvTestPaths();

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'runtime_missing',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'workspace',
  });

  const page = await electronApp.firstWindow();

  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a CV' })).toBeVisible();

  await electronApp.close();
});

test('returns to the workspace overlay after sign-in repair for a pending generation command', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_DELAY_MS: '5000',
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'auth_missing',
    CV_MAXXING_AI_WORKER_SIGN_IN_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: defaultVacancyNormalizationOutput,
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
  await page
    .getByLabel('Job description')
    .fill(
      [
        'Senior platform engineer',
        'Analytical Engines Ltd',
        'London, United Kingdom',
        '',
        'Responsibilities',
        '- Build reliable desktop tooling for technical users.',
        '- Partner with design and infrastructure teams.',
        '',
        'Requirements',
        '- Experience shipping workflow software.',
        '- Strong written communication.',
      ].join('\n'),
    );
  await page.getByLabel('Job description').press('Tab');
  await expect(page.getByRole('button', { name: 'Check job details' }).nth(1)).toBeEnabled();
  await page.getByRole('button', { name: 'Check job details' }).nth(1).dispatchEvent('click');
  await expect(page.getByText(/Job (details|preview)/)).toBeVisible();
  await page.getByRole('button', { name: 'Tailor your CV' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Add a job' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Tailoring your CV...' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open tailored application' })).toHaveCount(0);

  await electronApp.close();
});

test('returns to the workspace with a visible error when generation fails contract validation', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(
      createGenerationResultFixture({
        coverLetter: {
          body: [{} as never],
        },
      }),
    ),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: defaultVacancyNormalizationOutput,
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
  await page
    .getByLabel('Job description')
    .fill(
      [
        'Senior platform engineer',
        'Example Labs',
        'London, United Kingdom',
        '',
        'Responsibilities',
        '- Build reliable desktop tooling for technical users.',
        '- Partner with design and infrastructure teams.',
        '',
        'Requirements',
        '- Experience shipping workflow software.',
        '- Strong written communication.',
      ].join('\n'),
    );
  await page.getByRole('button', { name: 'Check job details' }).nth(1).dispatchEvent('click');
  await expect(page.getByText(/Job (details|preview)/)).toBeVisible();
  await page.getByRole('button', { name: 'Tailor your CV' }).click();
  await expect(
    page.getByText("We couldn't finish your CV and cover letter. Try tailoring this job again."),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: 'Add a job' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open add a job' })).toBeVisible();

  await electronApp.close();
});

test('persists pending generation before repair and clears it after completion', async () => {
  const testPaths = await createOriginalCvTestPaths();

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

  let electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'auth_missing',
    CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: defaultVacancyNormalizationOutput,
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
  await page
    .getByLabel('Job description')
    .fill(
      [
        'Senior platform engineer',
        'Analytical Engines Ltd',
        'London, United Kingdom',
        '',
        'Responsibilities',
        '- Build reliable desktop tooling for technical users.',
        '- Partner with design and infrastructure teams.',
        '',
        'Requirements',
        '- Experience shipping workflow software.',
        '- Strong written communication.',
      ].join('\n'),
    );
  await page.getByLabel('Job description').press('Tab');
  await expect(page.getByRole('button', { name: 'Check job details' }).nth(1)).toBeEnabled();
  await page.getByRole('button', { name: 'Check job details' }).nth(1).dispatchEvent('click');
  await expect(page.getByText(/Job (details|preview)/)).toBeVisible();
  await page.getByRole('button', { name: 'Tailor your CV' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

  await electronApp.close();

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  });

  page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { name: 'Senior platform engineer' })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(1000);

  await electronApp.close();

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  });

  page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { name: 'Senior platform engineer' })).toBeVisible();

  await electronApp.close();
});

test('renders the stored adapted CV PDF artifact and exports a readable non-overwriting PDF', async () => {
  const testPaths = await createOriginalCvTestPaths();
  const requestedExportPath = path.join(
    path.dirname(testPaths.pdfPath),
    'Ada Lovelace - Senior platform engineer - adapted-cv.pdf',
  );
  const resolvedExportPath = path.join(
    path.dirname(testPaths.pdfPath),
    'Ada Lovelace - Senior platform engineer - adapted-cv (2).pdf',
  );

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );
  await writeFile(requestedExportPath, Buffer.from('already-here', 'utf8'));

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT: defaultVacancyNormalizationOutput,
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
    CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH: requestedExportPath,
  });

  const page = await electronApp.firstWindow();
  const externalRequests: string[] = [];

  page.on('request', (request) => {
    const requestUrl = request.url();

    if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
      externalRequests.push(requestUrl);
    }
  });

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  });
  await openJobsFromYourCv(page);
  await page
    .getByLabel('Job description')
    .fill(
      [
        'Senior platform engineer',
        'Example Labs',
        'London, United Kingdom',
        '',
        'Responsibilities',
        '- Build reliable desktop tooling for technical users.',
        '- Partner with design and infrastructure teams.',
        '',
        'Requirements',
        '- Experience shipping workflow software.',
        '- Strong written communication.',
      ].join('\n'),
    );
  await page.getByLabel('Job description').press('Tab');
  await page.getByRole('button', { name: 'Check job details' }).nth(1).dispatchEvent('click');
  await expect(page.getByText(/Job (details|preview)/)).toBeVisible();
  await page.getByRole('button', { name: 'Tailor your CV' }).click();

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
  const savedJobButton = page.getByRole('button', { name: 'Open senior platform engineer' });

  await expect(savedJobButton).toBeVisible();
  await expect(savedJobButton.getByText('Example Labs')).toBeVisible();
  await expect(page.getByRole('button', { exact: true, name: 'CV' })).toBeVisible();
  await expect(page.getByRole('button', { exact: true, name: 'Cover letter' })).toBeVisible();
  await expect(page.getByText('About this job')).toBeVisible();
  await expect(page.getByText('Highlighted in your CV')).toBeVisible();
  await expect(page.getByText('Worth checking')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete this job' })).toBeVisible();
  await expect(page.getByText('Page 1 of 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete this job' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this job?' })).toBeVisible();
  await expect(
    page.getByText('This permanently removes the saved CV and cover letter for this job.'),
  ).toBeVisible();
  await expect(page.getByText('Cancel keeps this job exactly as it is now.')).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Delete this job?' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  await page.getByRole('button', { name: 'Save CV and cover letter' }).click();

  await expect
    .poll(async () => {
      try {
        await readFile(resolvedExportPath);

        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);

  const exportedPdfText = await extractPdfTextFromFile(resolvedExportPath);
  const normalizedExportedPdfText = exportedPdfText.replaceAll(/\s+/g, ' ');

  expect(normalizedExportedPdfText).toContain('Ada Lovelace');
  expect(normalizedExportedPdfText).toContain('Principal Product Designer');
  expect(normalizedExportedPdfText).toMatch(
    /Design leader shaping truthful desktop work\s*fl\s*ow products for technical users/u,
  );
  expect(normalizedExportedPdfText).toContain('Analytical Engines Ltd');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Show Local data settings' }).click();
  await expect(page.getByRole('heading', { name: 'Local data' })).toBeVisible();
  await expect(page.getByText('App version')).toBeVisible();
  await expect(page.getByText('Privacy guardrails')).toHaveCount(0);
  await expect(page.getByText('Telemetry')).toHaveCount(0);
  await expect(page.getByText('Automatic update checks')).toHaveCount(0);
  expect(externalRequests).toStrictEqual([]);

  await electronApp.close();
});

test('does not infer a saved tailored application from the unified workspace startup destination', async () => {
  const testPaths = await createOriginalCvTestPaths();

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'workspace',
  });

  const page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();

  await electronApp.close();
});

test('does not show recovery actions in connected AI settings', async () => {
  const testPaths = await createOriginalCvTestPaths();

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'runtime_missing',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  const page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'AI' })).toBeVisible();
  await expect(page.getByText('Using')).toBeVisible();
  await expect(page.getByText('Codex')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get help' })).toHaveCount(0);

  await electronApp.close();
});

test('clears job-site browser data from settings without deleting the active original CV', async () => {
  const testPaths = await createOriginalCvTestPaths();
  const browserCookiesPath = path.join(
    testPaths.appDataRoot,
    'browser-sessions',
    'vacancy-browser-session',
    'Cookies',
  );

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );
  await mkdir(path.dirname(browserCookiesPath), {
    recursive: true,
  });
  await writeFile(browserCookiesPath, 'top-secret-cookie', 'utf8');

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
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Show Local data settings' }).click();
  await expect(page.getByRole('heading', { name: 'Local data' })).toBeVisible();
  await expect(page.getByText('App version')).toBeVisible();
  await expect(page.getByText('Privacy guardrails')).toHaveCount(0);
  await expect(page.getByText('Telemetry')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear browser data' }).click();
  await expect(page.getByText('Job-site browser data cleared.')).toBeVisible();
  await page.getByRole('button', { name: 'Jobs' }).click();
  await expect(page.getByRole('heading', { name: 'Add a job' })).toBeVisible();
  await page.getByRole('button', { name: 'Your CV' }).click();
  await expectActiveOriginalCv(page, 'ada-lovelace.pdf');

  await electronApp.close();

  await expect(readFile(browserCookiesPath)).rejects.toThrow();
  await expect(readFile(path.join(testPaths.appDataRoot, 'app.db'))).resolves.toBeDefined();
});

test('requires RESET before destructive local reset and returns to first launch after cleanup', async () => {
  const testPaths = await createOriginalCvTestPaths();
  const browserCookiesPath = path.join(
    testPaths.appDataRoot,
    'browser-sessions',
    'vacancy-browser-session',
    'Cookies',
  );

  await writeFile(
    testPaths.pdfPath,
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products for technical users.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Led product design for AI-assisted desktop tooling.',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );
  await mkdir(path.dirname(browserCookiesPath), {
    recursive: true,
  });
  await writeFile(browserCookiesPath, 'top-secret-cookie', 'utf8');

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET: 'true',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  });

  const page = await electronApp.firstWindow();

  await importOriginalCvFromFirstLaunch({
    filename: 'ada-lovelace.pdf',
    filePath: testPaths.pdfPath,
    page,
  });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Show Local data settings' }).click();
  await page.getByRole('button', { name: 'Reset local app data' }).click();
  const resetDialog = page.getByRole('dialog', { name: 'Reset local app data?' });
  const resetButton = resetDialog.getByRole('button', { name: 'Reset local app data' });
  await expect(resetButton).toBeDisabled();
  await page.getByLabel('Type RESET to confirm destructive reset').fill('RESET');
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible();

  await electronApp.close();

  await expect(readFile(browserCookiesPath)).rejects.toThrow();
  const persistedText = await readDirectoryText(testPaths.appDataRoot);

  expect(persistedText).not.toContain('Ada Lovelace');
  expect(persistedText).not.toContain('Principal Product Designer');
});

async function createOriginalCvTestPaths(): Promise<{
  appDataRoot: string;
  docxPath: string;
  pdfPath: string;
  unreadablePdfPath: string;
}> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-e2e-original-cv-'));

  temporaryDirectories.push(rootDirectoryPath);

  return {
    appDataRoot: path.join(rootDirectoryPath, 'app-data'),
    docxPath: path.join(rootDirectoryPath, 'ada-lovelace-revised.docx'),
    pdfPath: path.join(rootDirectoryPath, 'ada-lovelace.pdf'),
    unreadablePdfPath: path.join(rootDirectoryPath, 'unreadable.pdf'),
  };
}

function createGenerationResultFixture(overrides?: {
  coverLetter?: Partial<{
    body: {
      text: string;
    }[];
    closing: {
      text: string;
    };
    date: string;
    greeting: string;
    opening: {
      text: string;
    };
    signature: string;
  }>;
}) {
  const baseFixture = {
    adaptationSummary: {
      emphasized: [
        {
          text: 'Emphasises desktop workflow design for technical users.',
        },
      ],
      gaps: [
        'The vacancy asks for workflow-software shipping experience; the original CV shows related desktop-tooling design work but does not claim engineering ownership.',
      ],
      omitted: [
        {
          text: 'Compresses broader research language so the desktop-tooling evidence stays primary.',
        },
      ],
      validationHints: ['Keep interview examples grounded in shipped desktop workflow tooling.'],
    },
    adaptedCv: {
      candidateName: 'Ada Lovelace',
      certifications: null,
      coreSkills: {
        items: [
          {
            text: 'Product strategy',
          },
          {
            text: 'UX research',
          },
        ],
      },
      education: null,
      experience: {
        items: [
          {
            bullets: [
              {
                text: 'Led product design for AI-assisted desktop tooling used by technical teams.',
              },
            ],
            dateRange: '2022 — Present',
            employer: 'Analytical Engines Ltd',
            location: 'London',
            roleTitle: 'Principal Product Designer',
          },
        ],
      },
      focus: null,
      header: {
        intro: {
          text: 'Design leader shaping truthful desktop workflow products for technical users.',
        },
      },
      headline: {
        text: 'Principal Product Designer',
      },
      impactHighlights: null,
      languages: null,
      profile: {
        summary: {
          text: 'Design leader adapting complex desktop workflow products for technical users.',
        },
      },
      references: {
        kind: 'references',
      },
      selectedWork: null,
      tools: null,
    },
    coverLetter: {
      body: [
        {
          text: 'I have led product design for AI-assisted desktop tooling, which aligns with your focus on reliable tooling for technical users.',
        },
      ],
      closing: {
        text: 'I would welcome the chance to discuss how that experience could support Analytical Engines Ltd.',
      },
      date: '9 April 2026',
      greeting: 'Dear Hiring Manager,',
      opening: {
        text: 'I am applying for the Senior platform engineer role at Analytical Engines Ltd.',
      },
      signature: 'Ada Lovelace',
    },
    trace: {
      model: 'gpt-5.4-codex',
      provider: 'codex',
      sessionId: 'session-123',
    },
  };

  const coverLetter = {
    ...baseFixture.coverLetter,
    ...overrides?.coverLetter,
  };

  return {
    ...baseFixture,
    coverLetter,
  };
}

function createVacancyNormalizationFixtureOutput(
  overrides: VacancyNormalizationFixtureOverrides = {},
): string {
  const normalizedVacancy = {
    bodyText:
      overrides.bodyText ??
      'Build reliable desktop tooling for technical users. Partner with design and infrastructure teams. Experience shipping workflow software. Strong written communication.',
    employer: overrides.employer ?? 'Example Labs',
    location: overrides.location ?? 'London, United Kingdom',
    requirements: overrides.requirements ?? [
      'Experience shipping workflow software.',
      'Strong written communication.',
    ],
    responsibilities: overrides.responsibilities ?? [
      'Build reliable desktop tooling for technical users.',
      'Partner with design and infrastructure teams.',
    ],
    title: overrides.title ?? 'Senior platform engineer',
  };

  return JSON.stringify({
    kind: 'success',
    normalizedVacancy,
  });
}

function createDocxDocumentBuffer(lines: string[]): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${lines
      .map((line) => {
        return `<w:p><w:r><w:t>${escapeXmlText(line)}</w:t></w:r></w:p>`;
      })
      .join('')}
  </w:body>
</w:document>`;

  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />
</Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" />
</Relationships>`),
      'word/document.xml': strToU8(documentXml),
    }),
  );
}

function createPdfDocumentBuffer(lines: string[]): Buffer {
  const contentStream = [
    'BT',
    '/F1 12 Tf',
    '50 760 Td',
    ...lines.flatMap((line, index) => {
      const command = `(${escapePdfText(line)}) Tj`;

      if (index === 0) {
        return [command];
      }

      return ['0 -18 Td', command];
    }),
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${String(Buffer.byteLength(contentStream, 'utf8'))} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');

  pdf += `xref
0 ${String(objects.length + 1)}
0000000000 65535 f 
${offsets
  .slice(1)
  .map((offset) => {
    return `${String(offset).padStart(10, '0')} 00000 n `;
  })
  .join('\n')}
trailer
<< /Size ${String(objects.length + 1)} /Root 1 0 R >>
startxref
${String(xrefOffset)}
%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

async function readDirectoryText(rootPath: string): Promise<string> {
  const entries = await readdir(rootPath, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries.filter((entry) => {
    return entry.isFile();
  });
  const fileContents = await Promise.all(
    files.map(async (entry) => {
      return await readFile(path.join(entry.parentPath, entry.name));
    }),
  );

  return Buffer.concat(fileContents).toString('utf8');
}

async function extractPdfTextFromFile(pdfPath: string): Promise<string> {
  const pdfBytes = await readFile(pdfPath);
  const pdfDocument = await getDocument(new Uint8Array(pdfBytes)).promise;
  const pageTexts = await Promise.all(
    Array.from({ length: pdfDocument.numPages }, async (_, index) => {
      const page = await pdfDocument.getPage(index + 1);
      const textContent = await page.getTextContent();

      return textContent.items
        .map((item) => {
          return 'str' in item ? item.str : '';
        })
        .join(' ');
    }),
  );

  return pageTexts.join('\n');
}

function escapePdfText(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('(', String.raw`\(`)
    .replaceAll(')', String.raw`\)`);
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

test('fails closed on a bounded health-check timeout and offers a retry path', async () => {
  const testPaths = await createOriginalCvTestPaths();

  const electronApp = await launchDesktopApp({
    CHECKING_TIMEOUT_MS: '50',
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'hang',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  });

  const page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { level: 1, name: 'Connect AI' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

  await electronApp.close();
});
