import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

import { createOriginalCvNormalizationFixtureOutput } from './original-cv-normalization-fixture.js'

const temporaryDirectories: string[] = []
const defaultOriginalCvNormalizationOutput = createOriginalCvNormalizationFixtureOutput()

const visualScreenshotBudgets = {
  'ai-worker-repair-screen.png': 2000,
  'first-launch-screen.png': 4000,
  'workspace-active-adapted-cv-screen.png': 24_000,
  'workspace-empty-screen.png': 8000,
} as const

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

test('captures the first-launch screen', async () => {
  const testPaths = await createOriginalCvTestPaths()
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Import your original CV' })).toBeVisible()
  await expect(page).toHaveScreenshot('first-launch-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['first-launch-screen.png'],
  })

  await electronApp.close()
})

test('captures the AI worker repair screen', async () => {
  const electronApp = await launchDesktopApp({
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'runtime_missing',
    CV_MAXXING_STARTUP_DESTINATION: 'workspace_empty',
  })

  const page = await electronApp.firstWindow()

  await expect(page.getByRole('heading', { name: 'Repair the local AI worker' })).toBeVisible()
  await expect(page).toHaveScreenshot('ai-worker-repair-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['ai-worker-repair-screen.png'],
  })

  await electronApp.close()
})

test('captures the workspace-empty state after the original CV import', async () => {
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
  await expect(page.getByRole('heading', { name: 'Create a tailored application' })).toBeVisible()
  await expect(page).toHaveScreenshot('workspace-empty-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: visualScreenshotBudgets['workspace-empty-screen.png'],
  })

  await electronApp.close()
})

test('captures the workspace-active adapted CV preview', async () => {
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
    CV_MAXXING_AI_WORKER_GENERATION_OUTPUT: JSON.stringify(createGenerationResultFixture()),
    CV_MAXXING_AI_WORKER_PREFLIGHT_STATUS: 'ready',
    CV_MAXXING_LOCAL_APP_DATA_ROOT: testPaths.appDataRoot,
    CV_MAXXING_STARTUP_DESTINATION: 'first_launch',
  })

  const page = await electronApp.firstWindow()

  await page.getByLabel('Original CV file').setInputFiles(testPaths.pdfPath)
  await page.getByRole('button', { name: 'Import original CV' }).click()
  await page.getByLabel('Job vacancy text').fill(createPastedVacancyFixture())
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
  await expect(page.getByLabel('Adapted CV PDF preview')).toBeVisible()
  await expect(page).toHaveScreenshot('workspace-active-adapted-cv-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.getByLabel('Adapted CV PDF preview'), page.getByText(/^Imported /u)],
    maxDiffPixels: visualScreenshotBudgets['workspace-active-adapted-cv-screen.png'],
  })

  await electronApp.close()
})

async function createOriginalCvTestPaths(): Promise<{
  appDataRoot: string
  pdfPath: string
}> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-e2e-visual-'))

  temporaryDirectories.push(rootDirectoryPath)

  return {
    appDataRoot: path.join(rootDirectoryPath, 'app-data'),
    pdfPath: path.join(rootDirectoryPath, 'ada-lovelace.pdf'),
  }
}

function createGenerationResultFixture() {
  return {
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
}

function createPastedVacancyFixture(): string {
  return [
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
  ].join('\n')
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
