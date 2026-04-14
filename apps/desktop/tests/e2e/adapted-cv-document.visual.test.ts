import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

import { createAdaptedCvDocument } from '../../src/main/adapted-cv-document.js'
import type { AdaptedCvModel } from '../../src/shared/tailored-application.js'

const require = createRequire(import.meta.url)
const temporaryDirectories: string[] = []
const manrope400Url = pathToFileURL(
  require.resolve('@fontsource/manrope/files/manrope-latin-400-normal.woff2'),
).href
const manrope500Url = pathToFileURL(
  require.resolve('@fontsource/manrope/files/manrope-latin-500-normal.woff2'),
).href
const manrope600Url = pathToFileURL(
  require.resolve('@fontsource/manrope/files/manrope-latin-600-normal.woff2'),
).href

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

test('captures the adapted CV document first page', async () => {
  const runtimePaths = await createRuntimePaths()
  const electronApp = await electron.launch({
    args: [runtimePaths.launcherPath],
    cwd: process.cwd(),
  })

  const page = await electronApp.firstWindow()

  await page.waitForFunction(() => {
    return document.body.dataset.cvReady === 'true'
  })
  await expect(page.locator('.cv-page')).toHaveCount(2)
  await expect(page.locator('body')).toContainText('PROFILE')
  await expect(page.locator('body')).toContainText('EXPERIENCE')
  await expect(page.locator('body')).toContainText('SELECTED WORK')
  await expect(page.locator('body')).toContainText('IMPACT HIGHLIGHTS')
  await expect(page.locator('body')).toContainText('CORE SKILLS')
  await expect(page.locator('body')).toContainText('TOOLS')
  await expect(page.locator('body')).toContainText('EDUCATION')
  await expect(page.locator('body')).toContainText('CERTIFICATIONS')
  await expect(page.locator('body')).toContainText('LANGUAGES')
  await expect(page.locator('body')).toContainText('FOCUS')
  await expect(page.locator('body')).toContainText('REFERENCES')
  await expect(page.locator('.cv-page').first()).toHaveScreenshot(
    'adapted-cv-document-page-1.png',
    {
      animations: 'disabled',
      caret: 'hide',
    },
  )
  await expect(page.locator('.cv-page').nth(1)).toHaveScreenshot('adapted-cv-document-page-2.png', {
    animations: 'disabled',
    caret: 'hide',
  })

  await electronApp.close()
})

async function createRuntimePaths(): Promise<{
  launcherPath: string
}> {
  const runtimeDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-adapted-cv-visual-'))

  temporaryDirectories.push(runtimeDirectoryPath)

  const htmlPath = path.join(runtimeDirectoryPath, 'adapted-cv-document.html')
  const launcherPath = path.join(runtimeDirectoryPath, 'electron-launcher.mjs')
  const document = createAdaptedCvDocument({
    adaptedCv: createAdaptedCvFixture(),
    employer: 'Example Labs',
    vacancyTitle: 'Senior platform engineer',
  })

  await writeFile(htmlPath, injectFontFaceCss(document.html), 'utf8')
  await writeFile(
    launcherPath,
    [
      "import { app, BrowserWindow } from 'electron'",
      '',
      `const htmlPath = ${JSON.stringify(htmlPath)}`,
      '',
      'app.whenReady()',
      '  .then(async () => {',
      '    const renderWindow = new BrowserWindow({',
      "      backgroundColor: '#ffffff',",
      '      height: 1400,',
      '      show: true,',
      '      webPreferences: {',
      '        contextIsolation: true,',
      '        nodeIntegration: false,',
      "        preload: '',",
      '        sandbox: false,',
      '      },',
      '      width: 1000,',
      '    })',
      '',
      '    await renderWindow.loadFile(htmlPath)',
      '  })',
      '  .catch((error) => {',
      '    console.error(error)',
      '    app.exit(1)',
      '  })',
      '',
      "app.on('window-all-closed', () => {",
      '  app.quit()',
      '})',
      '',
    ].join('\n'),
    'utf8',
  )

  return {
    launcherPath,
  }
}

function injectFontFaceCss(htmlDocument: string): string {
  const fontFaceCss = `
    @font-face {
      font-family: "Manrope";
      src: url("${manrope400Url}") format("woff2");
      font-style: normal;
      font-weight: 400;
    }

    @font-face {
      font-family: "Manrope";
      src: url("${manrope500Url}") format("woff2");
      font-style: normal;
      font-weight: 500;
    }

    @font-face {
      font-family: "Manrope";
      src: url("${manrope600Url}") format("woff2");
      font-style: normal;
      font-weight: 600;
    }
  `

  return htmlDocument.replace('<style>', `<style>${fontFaceCss}`)
}

function createAdaptedCvFixture(): AdaptedCvModel {
  return {
    candidateName: 'Alexandra Reed',
    header: {
      contact: {
        email: 'alexandra.reed@email.com',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'alexandrareed.design',
      },
      intro: {
        text: 'Design leader blending systems thinking with customer insight to ship calm, high-performing digital experiences.',
      },
    },
    headline: {
      text: 'Senior Product Designer',
    },
    sections: [
      {
        kind: 'profile',
        summary: {
          text: 'I build digital products that feel intuitive, useful and visually quiet. I collaborate closely with product and engineering to simplify complexity and deliver measurable outcomes.',
        },
      },
      {
        items: [
          {
            bullets: [
              {
                text: 'Led redesign of onboarding, increasing activation by 23% and reducing support volume by 31%.',
              },
              {
                text: 'Introduced a calmer interaction model for high-frequency workflow software used across operations and support teams.',
              },
              {
                text: 'Partnered with engineering to ship a role-based workspace shell that reduced time-to-value for new teams.',
              },
            ],
            dateRange: '2022 — Present',
            employer: 'Northfield',
            location: 'London',
            roleTitle: 'Lead Product Designer',
          },
          {
            bullets: [
              {
                text: 'Built a modular design system adopted by 6 teams, cutting design-to-dev handoff time by 38%.',
              },
              {
                text: 'Shipped data-heavy patient dashboards that improved weekly active usage across care coordinators by 19%.',
              },
              {
                text: 'Worked closely with compliance and delivery leads to simplify regulated user journeys without losing traceability.',
              },
            ],
            dateRange: '2019 — 2022',
            employer: 'Lumen Health',
            location: 'Stockholm',
            roleTitle: 'Senior Product Designer',
          },
          {
            bullets: [
              {
                text: 'Redesigned mobile dispatch workflows for field teams, reducing task completion time by 27% in field tests.',
              },
              {
                text: 'Built reusable service blueprints and prototype kits that improved cross-functional discovery speed.',
              },
            ],
            dateRange: '2017 — 2019',
            employer: 'Atlas Fleet',
            location: 'Berlin',
            roleTitle: 'Product Designer',
          },
          {
            bullets: [
              {
                text: 'Supported checkout, retention, and content journeys across multi-brand ecommerce surfaces.',
              },
              {
                text: 'Synthesised customer research into decision-ready narratives for product and commercial stakeholders.',
              },
            ],
            dateRange: '2015 — 2017',
            employer: 'Nord Retail',
            location: 'Copenhagen',
            roleTitle: 'UX Designer',
          },
        ],
        kind: 'experience',
      },
      {
        items: [
          {
            text: 'Nord Retail Checkout: simplified a 7-step purchase flow into 3 steps, lifting conversion by 14%.',
          },
          {
            text: 'Atlas Fleet App: redesigned mobile dispatch workflows, reducing task completion time by 27% in field tests.',
          },
          {
            text: 'Northfield Admin Console: reorganised nested navigation and role-aware dashboards for complex B2B workflows.',
          },
        ],
        kind: 'selected_work',
      },
      {
        items: [
          {
            text: 'Revenue impact: +$3.2M annualized from UX and conversion improvements across checkout and retention journeys.',
          },
          {
            text: 'Team impact: mentored 5 designers, introduced critique rituals and a reusable component library that improved quality consistency.',
          },
          {
            text: 'Operational impact: reduced workflow friction across support, delivery, and compliance teams in complex service environments.',
          },
        ],
        kind: 'impact_highlights',
      },
      {
        items: [
          {
            text: 'Product strategy',
          },
          {
            text: 'UX research',
          },
          {
            text: 'Interaction design',
          },
          {
            text: 'Design systems',
          },
          {
            text: 'Information architecture',
          },
          {
            text: 'Cross-functional leadership',
          },
        ],
        kind: 'core_skills',
      },
      {
        items: [
          {
            text: 'Figma',
          },
          {
            text: 'FigJam',
          },
          {
            text: 'Framer',
          },
          {
            text: 'Notion',
          },
          {
            text: 'Amplitude',
          },
          {
            text: 'Miro',
          },
        ],
        kind: 'tools',
      },
      {
        entry: {
          meta: 'Umea Institute of Design · 2017 — 2019',
          title: 'M.A. Interaction Design',
        },
        kind: 'education',
      },
      {
        items: [
          {
            text: 'NN/g UX Certification',
          },
          {
            text: 'Google Analytics 4',
          },
        ],
        kind: 'certifications',
      },
      {
        items: [
          {
            text: 'English (Native)',
          },
          {
            text: 'Swedish (Professional)',
          },
          {
            text: 'German (Conversational)',
          },
        ],
        kind: 'languages',
      },
      {
        items: [
          {
            text: 'Human-centered AI features',
          },
          {
            text: 'Healthcare and fintech products',
          },
          {
            text: 'Accessible design at scale',
          },
        ],
        kind: 'focus',
      },
      {
        kind: 'references',
      },
    ],
  }
}
