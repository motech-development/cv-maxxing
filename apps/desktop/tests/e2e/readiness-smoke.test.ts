import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { _electron as electron } from 'playwright'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { createOriginalCvNormalizationFixtureOutput } from './original-cv-normalization-fixture.js'

const temporaryDirectories: string[] = []
const defaultOriginalCvNormalizationOutput = createOriginalCvNormalizationFixtureOutput()

async function launchDesktopApp(environment: NodeJS.ProcessEnv = {}) {
  const combinedEnvironment = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...environment,
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT:
        environment.CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT ??
        defaultOriginalCvNormalizationOutput,
    }).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string'
    }),
  )

  return await electron.launch({
    args: ['dist/main/main.js'],
    cwd: process.cwd(),
    env: combinedEnvironment,
  })
}

test.afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      })
    }),
  )
})

test('imports the first PDF original CV and lands on the workspace-empty screen', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await expect(page.getByText('No tailored applications yet')).toBeVisible()
  await expect(page.getByText('Active original CV', { exact: true })).toBeVisible()
  await expect(page.getByText('ada-lovelace.pdf')).toBeVisible()

  await electronApp.close()

  const databaseBytes = await readFile(path.join(testPaths.appDataRoot, 'app.db'))

  expect(databaseBytes.includes(Buffer.from('Ada Lovelace', 'utf8'))).toBe(false)
})

test('rejects unreadable original CV imports without leaving the first-launch flow', async () => {
  const testPaths = await createOriginalCvTestPaths()

  await writeFile(testPaths.pdfPath, createPdfDocumentBuffer([]))

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(
    page.getByText('This original CV could not be read reliably. Use a text-based PDF or DOCX.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()

  await electronApp.close()
})

test('rejects non-English original CV imports without leaving the first-launch flow', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.docxPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(
    page.getByText(
      'CV Maxxing v1 supports British English only. Use an English original CV to continue.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()

  await electronApp.close()
})

test('replaces the active original CV from the workspace with a DOCX snapshot', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )
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
  )

  let electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  let page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await expect(page.getByText('ada-lovelace.pdf')).toBeVisible()

  await electronApp.close()

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT:
      createOriginalCvNormalizationFixtureOutput({
        experience: [
          'Staff Product Designer | Analytical Engines Ltd | 2022 — Present\nRefined import and adaptation workflows for complex authoring tools.',
        ],
        headline: 'Staff Product Designer',
        skills: ['Design systems', 'Desktop UX', 'Content strategy'],
        summary: 'Product designer adapting CVs for desktop AI tooling.',
      }),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  })

  page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await expect(page.getByText('ada-lovelace.pdf')).toBeVisible()
  await page.getByLabel('Replacement original CV file').setInputFiles(testPaths.docxPath)
  await page.getByRole('button', { name: 'Replace original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await expect(page.getByText('ada-lovelace-revised.docx')).toBeVisible()
  await expect(page.getByText('2 snapshots')).toBeVisible()

  await electronApp.close()

  const databaseBytes = await readFile(path.join(testPaths.appDataRoot, 'app.db'))

  expect(databaseBytes.includes(Buffer.from('Ada Lovelace', 'utf8'))).toBe(false)
  expect(databaseBytes.includes(Buffer.from('Staff Product Designer', 'utf8'))).toBe(false)
})

test('rejects an unreadable original CV replacement without leaving the workspace', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )
  await writeFile(testPaths.unreadablePdfPath, createPdfDocumentBuffer([]))

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page.getByLabel('Replacement original CV file').setInputFiles(testPaths.unreadablePdfPath)
  await page.getByRole('button', { name: 'Replace original CV' }).click()
  await expect(
    page.getByText('This original CV could not be read reliably. Use a text-based PDF or DOCX.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await expect(page.getByText('ada-lovelace.pdf')).toBeVisible()
  await expect(page.getByText('1 snapshot')).toBeVisible()

  await electronApp.close()
})

test('captures a LinkedIn vacancy through the internal browser session and restores a ready preview in the app shell', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )

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
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page.getByLabel('Vacancy URL').fill('https://www.linkedin.com/jobs/view/123456')
  await page.getByRole('button', { name: 'Review vacancy from URL' }).click()
  await expect(page.getByText('Senior Product Designer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adapt CV' })).toBeEnabled()

  await electronApp.close()

  const persistedPlaintext = await readDirectoryText(testPaths.appDataRoot)

  expect(persistedPlaintext.includes('top-secret-token')).toBe(false)
  expect(persistedPlaintext.includes('sessionToken')).toBe(false)
})

test('returns cleanly to the vacancy intake with blocking guidance when the internal browser session still exposes an incomplete page', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )

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
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page.getByLabel('Vacancy URL').fill('https://www.linkedin.com/jobs/view/123456')
  await page.getByRole('button', { name: 'Review vacancy from URL' }).click()
  await expect
    .poll(
      async () => {
        return (await page.locator('body').textContent()) ?? ''
      },
      {
        timeout: 15_000,
      },
    )
    .toContain('Add the full job responsibilities or requirements before adapting this CV.')
  await expect(
    page.getByText('Add the full job responsibilities or requirements before adapting this CV.'),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: 'Adapt CV' })).toBeDisabled()
  await expect(page.getByLabel('Vacancy URL')).toHaveValue(
    'https://www.linkedin.com/jobs/view/123456',
  )

  await electronApp.close()
})

test('blocks a non-English pasted vacancy, preserves the draft, and keeps Adapt CV disabled', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()
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
  ].join('\n')

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page.getByLabel('Vacancy URL').fill('https://jobs.example.com/platform-engineer-es')
  await page.getByLabel('Job vacancy text').fill(nonEnglishVacancyText)
  await page.getByRole('button', { name: 'Review pasted vacancy' }).click()
  await expect(
    page.getByText(
      'CV Maxxing v1 supports British English only. Review an English job vacancy before adapting this CV.',
    ),
  ).toBeVisible()
  await expect(page.getByLabel('Vacancy URL')).toHaveValue(
    'https://jobs.example.com/platform-engineer-es',
  )
  await expect(page.getByLabel('Job vacancy text')).toHaveValue(nonEnglishVacancyText)
  await expect(page.getByRole('button', { name: 'Adapt CV' })).toBeDisabled()

  await electronApp.close()
})

test('retries from an unavailable startup state and returns to first launch after repair', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'runtime_missing',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'ready',
    CV_MAXXING_STARTUP_DESTINATION: 'workspace_empty',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Repair the local AI worker' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry check' }).click()
  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await expect(page.getByText('Add your original CV')).toBeVisible()

  await electronApp.close()
})

test('keeps workspace_loading explicit after sign-in repair for a pending generation command', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'auth_missing',
    CV_MAXXING_AI_WORKER_SIGN_IN_STATUS: 'ready',
    CV_MAXXING_PENDING_GENERATION_COMMAND: JSON.stringify({
      commandId: 'command-123',
      originalCvId: 'original-cv-123',
      originalCvLabel: 'ada-lovelace.pdf',
      vacancyId: 'vacancy-123',
      vacancyDraft: {
        text: 'Senior platform engineer',
        url: 'https://jobs.example.com/roles/123',
      },
    }),
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Connect the local AI worker' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue sign-in' }).click()
  await expect(page.getByRole('heading', { name: 'Generating tailored application' })).toBeVisible()
  await expect(page.getByText('Tailoring in progress')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open tailored application' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abandon draft' })).toBeVisible()

  await electronApp.close()
})

test('returns to the workspace with a visible error when generation fails contract validation', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(
      createGenerationResultFixture({
        coverLetter: {
          body: [{} as never],
        },
      }),
    ),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page
    .getByLabel('Job vacancy text')
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
    )
  await page.getByRole('button', { name: 'Review pasted vacancy' }).dispatchEvent('click')
  await expect(page.getByText('Vacancy preview', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Adapt CV' }).click()
  await expect(
    page.getByText('Generated tailored application failed contract validation.'),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await expect(page.getByText('No tailored applications yet')).toBeVisible()

  await electronApp.close()
})

test('persists pending generation before repair and clears it after completion', async () => {
  const testPaths = await createOriginalCvTestPaths()

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
  )

  let electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'auth_missing',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  let page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page
    .getByLabel('Job vacancy text')
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
    )
  await page.getByLabel('Job vacancy text').press('Tab')
  await expect(page.getByRole('button', { name: 'Review pasted vacancy' })).toBeEnabled()
  await page.getByRole('button', { name: 'Review pasted vacancy' }).dispatchEvent('click')
  await expect(page.getByText('Vacancy preview', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Adapt CV' }).click()
  await expect(page.getByRole('heading', { name: 'Connect the local AI worker' })).toBeVisible()

  await electronApp.close()

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  })

  page = await electronApp.firstWindow()

  await expect(
    page.getByRole('heading', { name: 'Senior platform engineer · Analytical Engines Ltd' }),
  ).toBeVisible({
    timeout: 15_000,
  })
  await page.waitForTimeout(1000)

  await electronApp.close()

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  })

  page = await electronApp.firstWindow()

  await expect(
    page.getByRole('heading', { name: 'Senior platform engineer · Analytical Engines Ltd' }),
  ).toBeVisible()

  await electronApp.close()
})

test('renders the stored adapted CV PDF artifact and exports a readable non-overwriting PDF', async () => {
  const testPaths = await createOriginalCvTestPaths()
  const requestedExportPath = path.join(
    path.dirname(testPaths.pdfPath),
    'Ada Lovelace - Senior platform engineer - adapted-cv.pdf',
  )
  const resolvedExportPath = path.join(
    path.dirname(testPaths.pdfPath),
    'Ada Lovelace - Senior platform engineer - adapted-cv (2).pdf',
  )

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
  )
  await writeFile(requestedExportPath, Buffer.from('already-here', 'utf8'))

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
    CV_MAXXING_TEST_ADAPTED_CV_EXPORT_PATH: requestedExportPath,
  })

  const page = await electronApp.firstWindow()
  const externalRequests: string[] = []

  page.on('request', (request) => {
    const requestUrl = request.url()

    if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
      externalRequests.push(requestUrl)
    }
  })

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page
    .getByLabel('Job vacancy text')
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
    )
  await page.getByLabel('Job vacancy text').press('Tab')
  await page.getByRole('button', { name: 'Review pasted vacancy' }).dispatchEvent('click')
  await expect(page.getByText('Vacancy preview', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Adapt CV' }).click()

  await expect
    .poll(
      async () => {
        return (await page.locator('body').textContent()) ?? ''
      },
      {
        timeout: 15_000,
      },
    )
    .toContain('Senior platform engineer · Example Labs')

  await expect(
    page.getByRole('heading', { name: 'Senior platform engineer · Example Labs' }),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText('Page 1 of 1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  await page.getByRole('button', { name: 'Export PDF' }).click()

  await expect
    .poll(async () => {
      try {
        await readFile(resolvedExportPath)

        return true
      } catch {
        return false
      }
    })
    .toBe(true)

  const exportedPdfText = await extractPdfTextFromFile(resolvedExportPath)
  const normalizedExportedPdfText = exportedPdfText.replaceAll(/\s+/g, ' ')

  expect(normalizedExportedPdfText).toContain('Ada Lovelace')
  expect(normalizedExportedPdfText).toContain('Principal Product Designer')
  expect(normalizedExportedPdfText).toMatch(
    /Design leader shaping truthful desktop work\s*fl\s*ow products for technical users/u,
  )
  expect(normalizedExportedPdfText).toContain('Analytical Engines Ltd')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Show Local data settings' }).click()
  await expect(page.getByRole('heading', { name: 'Local data' })).toBeVisible()
  await expect(page.getByText('App version')).toBeVisible()
  await expect(page.getByText('Telemetry')).toBeVisible()
  await expect(page.getByText('Analytics')).toBeVisible()
  await expect(page.getByText('Crash reporting')).toBeVisible()
  await expect(page.getByText('Remote config')).toBeVisible()
  await expect(page.getByText('Runtime font CDN calls')).toBeVisible()
  await expect(page.getByText('Automatic update checks')).toBeVisible()
  await expect(page.getByText('Blocked').first()).toBeVisible()
  expect(externalRequests).toStrictEqual([])

  await electronApp.close()
})

test('keeps workspace_active explicit when the saved startup destination requests it', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_STARTUP_DESTINATION: 'workspace_active',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Tailored application' })).toBeVisible()

  await electronApp.close()
})

test('retries the AI worker from settings and routes back to repair when the fresh check fails', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'runtime_missing',
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'AI worker' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry status check' }).click()
  await expect(page.getByRole('heading', { name: 'Repair the local AI worker' })).toBeVisible()

  await electronApp.close()
})

test('clears job-site browser data from settings without deleting the active original CV', async () => {
  const testPaths = await createOriginalCvTestPaths()
  const browserCookiesPath = path.join(
    testPaths.appDataRoot,
    'browser-sessions',
    'vacancy-browser-session',
    'Cookies',
  )

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
  )
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

  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Show Local data settings' }).click()
  await expect(page.getByRole('heading', { name: 'Local data' })).toBeVisible()
  await expect(page.getByText('App version')).toBeVisible()
  await expect(page.getByText('Telemetry')).toBeVisible()
  await page.getByRole('button', { name: 'Clear browser data' }).click()
  await expect(page.getByText('Internal job-site browser data cleared.')).toBeVisible()
  await page.getByRole('button', { name: 'Job vacancies' }).click()
  await expect(page.getByText('ada-lovelace.pdf')).toBeVisible()

  await electronApp.close()

  await expect(readFile(browserCookiesPath)).rejects.toThrow()
  await expect(readFile(path.join(testPaths.appDataRoot, 'app.db'))).resolves.toBeDefined()
})

test('requires RESET before destructive local reset and returns to first launch after cleanup', async () => {
  const testPaths = await createOriginalCvTestPaths()
  const browserCookiesPath = path.join(
    testPaths.appDataRoot,
    'browser-sessions',
    'vacancy-browser-session',
    'Cookies',
  )

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
  )
  await mkdir(path.dirname(browserCookiesPath), {
    recursive: true,
  })
  await writeFile(browserCookiesPath, 'top-secret-cookie', 'utf8')

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_DISABLE_APP_RELAUNCH_ON_RESET: 'true',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Show Local data settings' }).click()

  const resetButton = page.getByRole('button', { name: 'Reset local app data' })

  await expect(resetButton).toBeDisabled()
  await page.getByLabel('Type RESET to confirm destructive reset').fill('RESET')
  await expect(resetButton).toBeEnabled()
  await resetButton.click()
  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()

  await electronApp.close()

  await expect(readFile(browserCookiesPath)).rejects.toThrow()
  const persistedText = await readDirectoryText(testPaths.appDataRoot)

  expect(persistedText).not.toContain('Ada Lovelace')
  expect(persistedText).not.toContain('Principal Product Designer')
})

async function createOriginalCvTestPaths(): Promise<{
  appDataRoot: string
  docxPath: string
  pdfPath: string
  unreadablePdfPath: string
}> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-e2e-original-cv-'))

  temporaryDirectories.push(rootDirectoryPath)

  return {
    appDataRoot: path.join(rootDirectoryPath, 'app-data'),
    docxPath: path.join(rootDirectoryPath, 'ada-lovelace-revised.docx'),
    pdfPath: path.join(rootDirectoryPath, 'ada-lovelace.pdf'),
    unreadablePdfPath: path.join(rootDirectoryPath, 'unreadable.pdf'),
  }
}

function createGenerationResultFixture(overrides?: {
  coverLetter?: Partial<{
    body: {
      text: string
    }[]
    closing: {
      text: string
    }
    date: string
    greeting: string
    opening: {
      text: string
    }
    signature: string
  }>
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
  }

  const coverLetter = {
    ...baseFixture.coverLetter,
    ...overrides?.coverLetter,
  }

  return {
    ...baseFixture,
    coverLetter,
  }
}

function createDocxDocumentBuffer(lines: string[]): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${lines
      .map((line) => {
        return `<w:p><w:r><w:t>${escapeXmlText(line)}</w:t></w:r></w:p>`
      })
      .join('')}
  </w:body>
</w:document>`

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
  )
}

function createPdfDocumentBuffer(lines: string[]): Buffer {
  const contentStream = [
    'BT',
    '/F1 12 Tf',
    '50 760 Td',
    ...lines.flatMap((line, index) => {
      const command = `(${escapePdfText(line)}) Tj`

      if (index === 0) {
        return [command]
      }

      return ['0 -18 Td', command]
    }),
    'ET',
  ].join('\n')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${String(Buffer.byteLength(contentStream, 'utf8'))} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8')

  pdf += `xref
0 ${String(objects.length + 1)}
0000000000 65535 f 
${offsets
  .slice(1)
  .map((offset) => {
    return `${String(offset).padStart(10, '0')} 00000 n `
  })
  .join('\n')}
trailer
<< /Size ${String(objects.length + 1)} /Root 1 0 R >>
startxref
${String(xrefOffset)}
%%EOF`

  return Buffer.from(pdf, 'utf8')
}

async function readDirectoryText(rootPath: string): Promise<string> {
  const entries = await readdir(rootPath, {
    recursive: true,
    withFileTypes: true,
  })
  const files = entries.filter((entry) => {
    return entry.isFile()
  })
  const fileContents = await Promise.all(
    files.map(async (entry) => {
      return await readFile(path.join(entry.parentPath, entry.name))
    }),
  )

  return Buffer.concat(fileContents).toString('utf8')
}

async function extractPdfTextFromFile(pdfPath: string): Promise<string> {
  const pdfBytes = await readFile(pdfPath)
  const pdfDocument = await getDocument(new Uint8Array(pdfBytes)).promise
  const pageTexts = await Promise.all(
    Array.from({ length: pdfDocument.numPages }, async (_, index) => {
      const page = await pdfDocument.getPage(index + 1)
      const textContent = await page.getTextContent()

      return textContent.items
        .map((item) => {
          return 'str' in item ? item.str : ''
        })
        .join(' ')
    }),
  )

  return pageTexts.join('\n')
}

function escapePdfText(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('(', String.raw`\(`)
    .replaceAll(')', String.raw`\)`)
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

test('fails closed on a bounded health-check timeout and offers a retry path', async () => {
  const electronApp = await launchDesktopApp({
    CHECKING_TIMEOUT_MS: '50',
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'hang',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Repair the local AI worker' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry check' })).toBeVisible()

  await electronApp.close()
})
