import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const temporaryDirectories: string[] = []

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
    .fill('Senior platform engineer\nBuild reliable desktop tooling for technical users.')
  await page.getByRole('button', { name: 'Start tailoring from text' }).click()
  await expect(page.getByRole('heading', { name: 'Connect the local AI worker' })).toBeVisible()

  await electronApp.close()

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'auth_missing',
    CV_MAXXING_AI_WORKER_SIGN_IN_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  })

  page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Connect the local AI worker' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue sign-in' }).click()
  await expect(page.getByRole('heading', { name: 'Generating tailored application' })).toBeVisible()
  await expect(page.getByText('Senior platform engineer')).toBeVisible()
  await page.getByRole('button', { name: 'Open tailored application' }).click()

  await electronApp.close()

  electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
  })

  page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Tailored application' })).toBeVisible()

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

async function createOriginalCvTestPaths(): Promise<{
  appDataRoot: string
  pdfPath: string
}> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-e2e-original-cv-'))

  temporaryDirectories.push(rootDirectoryPath)

  return {
    appDataRoot: path.join(rootDirectoryPath, 'app-data'),
    pdfPath: path.join(rootDirectoryPath, 'ada-lovelace.pdf'),
  }
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

function escapePdfText(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('(', String.raw`\(`)
    .replaceAll(')', String.raw`\)`)
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
