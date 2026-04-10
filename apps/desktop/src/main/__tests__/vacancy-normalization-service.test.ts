import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import type { VacancyNormalizationWorker } from '../vacancy-normalization-worker.js'
import {
  createVacancyNormalizationService,
  type NormalizedVacancy,
} from '../vacancy-normalization-service.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      })
    }),
  )
})

test('writes a dedicated vacancy-normalization run workspace and removes it after the worker returns', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-vacancy-normalization-service-'),
  )

  temporaryDirectories.push(runWorkspaceRootPath)

  const worker = {
    runNormalization: vi.fn(
      async ({ runDirectoryPath }: { runDirectoryPath: string; signal: AbortSignal }) => {
        const [examplesJson, pageHtml, pageText, taskJson] = await Promise.all([
          readFile(path.join(runDirectoryPath, 'input', 'examples.json'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'page.html'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'page.txt'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'task.json'), 'utf8'),
        ])
        const parsedTask = JSON.parse(taskJson) as unknown
        const parsedExamples = JSON.parse(examplesJson) as unknown

        expect(parsedTask).toEqual({
          constraints: {
            ignoreChromeAndBoilerplate: true,
            keepMissingFieldsEmpty: true,
            outputLanguage: 'British English',
            preservePageOrder: true,
            preserveSourceMeaning: true,
          },
          examplesPath: 'input/examples.json',
          outputContract: {
            normalizedArtifactName: 'normalized.json',
          },
          vacancyPage: {
            extractedTextPath: 'input/page.txt',
            originalUrl: 'https://boards.greenhouse.io/example/jobs/123',
            pageTitle: 'Senior Product Designer at Example Labs - Greenhouse',
            resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123?gh_jid=123',
            sanitizedHtmlPath: 'input/page.html',
            source: 'greenhouse',
          },
        })
        expect(Array.isArray(parsedExamples)).toBe(true)
        expect(pageHtml).toContain('<main>')
        expect(pageText).toContain('Senior Product Designer')

        return {
          bodyText:
            'Lead product design for desktop workflows. Partner with engineering and research.',
          employer: 'Example Labs',
          location: 'London, United Kingdom',
          requirements: ['Experience shipping workflow software.'],
          responsibilities: ['Lead product design for desktop workflows.'],
          title: 'Senior Product Designer',
        }
      },
    ),
  }
  const service = createVacancyNormalizationService({
    generateId: vi.fn(() => 'vacancy-normalization-run-001'),
    runWorkspaceRootPath,
    worker,
  })

  await expect(
    service.normalizeVacancy({
      html: [
        '<html>',
        '<body>',
        '<main>',
        '<h1>Senior Product Designer</h1>',
        '<p>Example Labs</p>',
        '<p>London, United Kingdom</p>',
        '</main>',
        '</body>',
        '</html>',
      ].join(''),
      originalUrl: 'https://boards.greenhouse.io/example/jobs/123',
      pageTitle: 'Senior Product Designer at Example Labs - Greenhouse',
      resolvedUrl: 'https://boards.greenhouse.io/example/jobs/123?gh_jid=123',
      source: 'greenhouse',
    }),
  ).resolves.toEqual({
    bodyText: 'Lead product design for desktop workflows. Partner with engineering and research.',
    employer: 'Example Labs',
    location: 'London, United Kingdom',
    requirements: ['Experience shipping workflow software.'],
    responsibilities: ['Lead product design for desktop workflows.'],
    title: 'Senior Product Designer',
  } satisfies NormalizedVacancy)

  const firstCall = worker.runNormalization.mock.calls[0]?.[0]

  expect(firstCall?.runDirectoryPath).toBe(
    path.join(runWorkspaceRootPath, 'vacancy-normalization-run-001'),
  )
  expect(firstCall?.signal).toBeInstanceOf(AbortSignal)
  await expect(readdir(runWorkspaceRootPath)).resolves.toEqual([])
})

test('aborts a stalled vacancy-normalization run after the timeout and removes the transient workspace', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-vacancy-normalization-service-timeout-'),
  )

  temporaryDirectories.push(runWorkspaceRootPath)

  let didAbort = false

  const worker: VacancyNormalizationWorker = {
    runNormalization: vi.fn(
      async ({ signal }: { runDirectoryPath: string; signal: AbortSignal }) => {
        return await new Promise<NormalizedVacancy>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              didAbort = true
              reject(new Error('Vacancy normalization cancelled.'))
            },
            {
              once: true,
            },
          )
        })
      },
    ),
  }
  const service = createVacancyNormalizationService({
    generateId: vi.fn(() => 'vacancy-normalization-run-timeout'),
    runWorkspaceRootPath,
    timeoutMs: 5,
    worker,
  })

  await expect(
    service.normalizeVacancy({
      html: '<main><h1>Senior Product Designer</h1></main>',
      originalUrl: 'https://jobs.example.com/roles/123',
      pageTitle: 'Senior Product Designer',
      resolvedUrl: 'https://jobs.example.com/roles/123',
      source: 'generic',
    }),
  ).rejects.toThrow('Vacancy normalization timed out.')

  expect(worker.runNormalization).toHaveBeenCalledTimes(1)
  expect(didAbort).toBe(true)
  await expect(readdir(runWorkspaceRootPath)).resolves.toEqual([])
})
