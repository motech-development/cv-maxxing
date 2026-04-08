import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { strToU8, zipSync } from 'fflate'
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

test('imports the first PDF original CV after the readiness gate passes', async () => {
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
  await expect(page.getByRole('heading', { name: 'Original CV active' })).toBeVisible()
  await expect(page.getByText('ada-lovelace.pdf')).toBeVisible()
  await expect(page.getByText('1 snapshots stored')).toBeVisible()

  await electronApp.close()

  const databaseBytes = await readFile(path.join(testPaths.appDataRoot, 'app.db'))

  expect(databaseBytes.includes(Buffer.from('Ada Lovelace', 'utf8'))).toBe(false)
})

test('replaces the active original CV with a DOCX snapshot inside the workspace route', async () => {
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

  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Original CV active' })).toBeVisible()
  await page.getByLabel('Original CV file').setInputFiles(testPaths.docxPath)
  await page.getByRole('button', { name: 'Replace original CV' }).click()
  await expect(page.getByText('ada-lovelace-revised.docx')).toBeVisible()
  await expect(page.getByText('2 snapshots stored')).toBeVisible()

  await electronApp.close()
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

test('retries from an unavailable startup state after local repair', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'runtime_missing',
    CV_MAXXING_AI_WORKER_RETRY_STATUS: 'ready',
    CV_MAXXING_STARTUP_DESTINATION: 'workspace_empty',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('button', { name: 'Retry check' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry check' }).click()
  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await expect(
    page.getByText('Import a PDF or DOCX original CV to unlock the rest of the workspace.'),
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

test('fetches a deterministic vacancy URL and renders a ready preview inside the workspace', async () => {
  const testPaths = await createOriginalCvTestPaths()
  const jobServer = await createJobServer({
    html: [
      '<html>',
      '<head><title>Senior Product Designer at Example Labs - Greenhouse</title></head>',
      '<body>',
      '<main>',
      '<h1>Senior Product Designer</h1>',
      '<p>Example Labs</p>',
      '<p>London, United Kingdom</p>',
      '<section><h2>Responsibilities</h2><ul><li>Lead product design for desktop workflows.</li><li>Partner with engineering and research.</li></ul></section>',
      '<section><h2>Requirements</h2><ul><li>Experience shipping workflow software.</li><li>Excellent written communication.</li></ul></section>',
      '</main>',
      '</body>',
      '</html>',
    ].join(''),
    path: '/example/jobs/123',
  })

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

  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Original CV active' })).toBeVisible()
  await page.getByLabel('Job vacancy URL').fill(jobServer.url)
  await page.getByRole('button', { name: 'Fetch vacancy' }).click()
  await expect(page.getByText('Generic')).toBeVisible()
  await expect(page.getByText('Senior Product Designer')).toBeVisible()
  await expect(page.getByText('Example Labs')).toBeVisible()
  await expect(page.getByText('Ready for adaptation')).toBeVisible()

  await electronApp.close()
  await jobServer.close()

  const databaseBytes = await readFile(path.join(testPaths.appDataRoot, 'app.db'))

  expect(
    databaseBytes.includes(Buffer.from('Experience shipping workflow software.', 'utf8')),
  ).toBe(false)
})

test('shows the browser-assisted fallback for LinkedIn vacancy URLs without discarding the draft', async () => {
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

  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Original CV active' })).toBeVisible()
  await page.getByLabel('Job vacancy URL').fill('https://www.linkedin.com/jobs/view/123456')
  await page.getByRole('button', { name: 'Fetch vacancy' }).click()
  await expect(page.getByText('Needs browser sign-in')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open internal browser session' })).toBeVisible()
  await expect(
    page.getByText(
      'Open the internal browser session for authenticated pages, or paste the full job text instead.',
    ),
  ).toBeVisible()
  await expect(page.getByLabel('Job vacancy URL')).toHaveValue(
    'https://www.linkedin.com/jobs/view/123456',
  )

  await electronApp.close()
})

test('reviews pasted vacancy text inside the workspace when the user uses the fallback path', async () => {
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

  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await expect(page.getByRole('heading', { name: 'Original CV active' })).toBeVisible()
  await page
    .getByLabel('Reference vacancy URL')
    .fill('https://jobs.example.com/senior-product-designer')
  await page
    .getByLabel('Pasted vacancy text')
    .fill(
      [
        'Senior Product Designer',
        'Example Labs',
        'London, United Kingdom',
        'Responsibilities',
        'Lead product design for AI-assisted desktop workflows.',
        'Requirements',
        'Strong written communication.',
      ].join('\n'),
    )
  await page.getByRole('button', { name: 'Use pasted vacancy text' }).click()
  await expect(page.getByText('Generic')).toBeVisible()
  await expect(
    page.getByText('Lead product design for AI-assisted desktop workflows.').first(),
  ).toBeVisible()
  await expect(page.getByText('Ready for adaptation')).toBeVisible()

  await electronApp.close()
})

async function createOriginalCvTestPaths(): Promise<{
  appDataRoot: string
  docxPath: string
  pdfPath: string
}> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-e2e-original-cv-'))

  temporaryDirectories.push(rootDirectoryPath)

  return {
    appDataRoot: path.join(rootDirectoryPath, 'app-data'),
    docxPath: path.join(rootDirectoryPath, 'ada-lovelace-revised.docx'),
    pdfPath: path.join(rootDirectoryPath, 'ada-lovelace.pdf'),
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

async function createJobServer({ html, path: routePath }: { html: string; path: string }): Promise<{
  close: () => Promise<void>
  url: string
}> {
  const server = createServer((request, response) => {
    if (request.url !== routePath) {
      response.writeHead(404)
      response.end('not found')

      return
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
    })
    response.end(html)
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })

  const address = server.address()

  if (address === null || typeof address === 'string') {
    throw new TypeError('Failed to determine the local vacancy server address.')
  }

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)

            return
          }

          resolve()
        })
      })
    },
    url: `http://127.0.0.1:${String(address.port)}${routePath}`,
  }
}

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
