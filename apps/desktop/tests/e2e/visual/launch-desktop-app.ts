import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Page } from '@playwright/test'
import { _electron as electron } from 'playwright'

import { createOriginalCvNormalizationFixtureOutput } from '../original-cv-normalization-fixture.js'
import { createVacancyNormalizationFixtureOutput } from './fixtures.js'

const temporaryDirectories: string[] = []
const defaultOriginalCvNormalizationOutput = createOriginalCvNormalizationFixtureOutput()
const defaultVacancyNormalizationOutput = createVacancyNormalizationFixtureOutput()

export interface VisualTestPaths {
  appDataRoot: string
  docxPath: string
  pdfPath: string
  rootDirectoryPath: string
  unreadablePdfPath: string
}

export async function cleanupVisualTestArtifacts(): Promise<void> {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      })
    }),
  )
}

export async function createVisualTestPaths(
  prefix = 'cv-maxxing-e2e-visual-',
): Promise<VisualTestPaths> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), prefix))

  temporaryDirectories.push(rootDirectoryPath)

  return {
    appDataRoot: path.join(rootDirectoryPath, 'app-data'),
    docxPath: path.join(rootDirectoryPath, 'ada-lovelace-revised.docx'),
    pdfPath: path.join(rootDirectoryPath, 'ada-lovelace.pdf'),
    rootDirectoryPath,
    unreadablePdfPath: path.join(rootDirectoryPath, 'unreadable.pdf'),
  }
}

export async function hideScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      html,
      body {
        overflow: hidden !important;
      }

      ::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
    `,
  })
}

export function importedTimestampMask(page: Page) {
  return [page.getByText(/^Imported /u)]
}

export async function launchDesktopApp(environment: NodeJS.ProcessEnv = {}) {
  const combinedEnvironment = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...environment,
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT:
        environment.CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT ??
        defaultOriginalCvNormalizationOutput,
      CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT:
        environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT ??
        defaultVacancyNormalizationOutput,
      CV_MAXXING_MAIN_WINDOW_SHOW: environment.CV_MAXXING_MAIN_WINDOW_SHOW ?? 'false',
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
