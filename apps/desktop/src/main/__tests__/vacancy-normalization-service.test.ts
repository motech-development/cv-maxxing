import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { VacancyNormalizationError } from '../vacancy-normalization-error.js'
import type { VacancyNormalizationWorker } from '../vacancy-normalization-worker.js'
import {
  createVacancyNormalizationService,
  type NormalizedVacancy,
  type VacancyNormalizationWorkerResult,
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
          kind: 'success',
          normalizedVacancy: {
            bodyText:
              ' Lead product design for desktop workflows. Partner with engineering and research. ',
            employer: 'Example Labs',
            location: 'London, United Kingdom',
            requirements: [
              'Experience shipping workflow software.',
              'Experience shipping workflow software.',
              '',
            ],
            responsibilities: ['Lead product design for desktop workflows.'],
            title: 'Senior Product Designer',
          },
        } satisfies VacancyNormalizationWorkerResult
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
        return await new Promise<VacancyNormalizationWorkerResult>((_, reject) => {
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
  ).rejects.toEqual(
    new VacancyNormalizationError({
      code: 'timeout',
      message: 'Vacancy normalization timed out.',
    }),
  )

  expect(worker.runNormalization).toHaveBeenCalledTimes(1)
  expect(didAbort).toBe(true)
  await expect(readdir(runWorkspaceRootPath)).resolves.toEqual([])
})

test('maps a no-job-content worker result to a typed vacancy-normalization failure', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-vacancy-normalization-service-no-job-content-'),
  )

  temporaryDirectories.push(runWorkspaceRootPath)

  const service = createVacancyNormalizationService({
    generateId: vi.fn(() => 'vacancy-normalization-run-no-job-content'),
    runWorkspaceRootPath,
    worker: {
      runNormalization: vi.fn(() => {
        return Promise.resolve({
          kind: 'no_job_content',
        } satisfies VacancyNormalizationWorkerResult)
      }),
    },
  })

  await expect(
    service.normalizeVacancy({
      html: '<main><h1>Apply now</h1></main>',
      originalUrl: 'https://jobs.example.com/roles/123',
      pageTitle: 'Apply now',
      resolvedUrl: 'https://jobs.example.com/roles/123',
      source: 'generic',
    }),
  ).rejects.toEqual(
    new VacancyNormalizationError({
      code: 'no_job_content',
      message: 'Vacancy normalization found no job content to persist.',
    }),
  )
})

test('preserves captured embedded board evidence when focusing rendered page content', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-vacancy-normalization-service-embedded-'),
  )

  temporaryDirectories.push(runWorkspaceRootPath)

  const worker = {
    runNormalization: vi.fn(
      async ({ runDirectoryPath }: { runDirectoryPath: string; signal: AbortSignal }) => {
        const [pageHtml, pageText] = await Promise.all([
          readFile(path.join(runDirectoryPath, 'input', 'page.html'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'page.txt'), 'utf8'),
        ])

        expect(pageHtml).toContain('Senior Product Designer')
        expect(pageHtml).toContain('Lead product design for embedded workflows.')
        expect(pageText).toContain('Senior Product Designer')
        expect(pageText).toContain('Lead product design for embedded workflows.')

        return {
          kind: 'success',
          normalizedVacancy: {
            bodyText:
              'Lead product design for embedded workflows. Partner with engineering and research.',
            employer: 'Example Labs',
            location: 'Remote (UK)',
            requirements: ['Experience shipping workflow software.'],
            responsibilities: ['Lead product design for embedded workflows.'],
            title: 'Senior Product Designer',
          },
        } satisfies VacancyNormalizationWorkerResult
      },
    ),
  }
  const service = createVacancyNormalizationService({
    generateId: vi.fn(() => 'vacancy-normalization-run-embedded'),
    runWorkspaceRootPath,
    worker,
  })

  await expect(
    service.normalizeVacancy({
      html: [
        '<main>',
        '<h1>Careers</h1>',
        '<iframe></iframe>',
        '</main>',
        '<section data-cv-maxxing-embedded-frame="0">',
        '<article><h2>Senior Product Designer</h2><p>Lead product design for embedded workflows.</p></article>',
        '</section>',
      ].join(''),
      originalUrl: 'https://jobs.example.com/roles/123',
      pageTitle: 'Example Labs Careers',
      resolvedUrl: 'https://jobs.example.com/roles/123',
      source: 'jobs.example.com',
    }),
  ).resolves.toEqual({
    bodyText: 'Lead product design for embedded workflows. Partner with engineering and research.',
    employer: 'Example Labs',
    location: 'Remote (UK)',
    requirements: ['Experience shipping workflow software.'],
    responsibilities: ['Lead product design for embedded workflows.'],
    title: 'Senior Product Designer',
  } satisfies NormalizedVacancy)
})

test('rejects semantically invalid normalized vacancy output after deterministic post-validation', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-vacancy-normalization-service-semantic-'),
  )

  temporaryDirectories.push(runWorkspaceRootPath)

  const service = createVacancyNormalizationService({
    generateId: vi.fn(() => 'vacancy-normalization-run-semantic'),
    runWorkspaceRootPath,
    worker: {
      runNormalization: vi.fn(() => {
        return Promise.resolve({
          kind: 'success',
          normalizedVacancy: {
            bodyText: 'Join LinkedIn or sign in to continue.',
            employer: null,
            location: null,
            requirements: [],
            responsibilities: [],
            title: 'Sign in to view this job',
          },
        } satisfies VacancyNormalizationWorkerResult)
      }),
    },
  })

  await expect(
    service.normalizeVacancy({
      html: '<main><h1>Sign in to view this job</h1></main>',
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      pageTitle: 'Sign in to view this job | LinkedIn',
      resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
      source: 'linkedin',
    }),
  ).rejects.toEqual(
    new VacancyNormalizationError({
      code: 'semantic_rejection',
      message: 'Vacancy normalization produced semantically invalid vacancy content.',
    }),
  )
})

test('focuses authenticated LinkedIn normalization input on the main vacancy content and bounds oversized artifacts', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-vacancy-normalization-service-linkedin-focus-'),
  )

  temporaryDirectories.push(runWorkspaceRootPath)

  const worker = {
    runNormalization: vi.fn(
      async ({ runDirectoryPath }: { runDirectoryPath: string; signal: AbortSignal }) => {
        const [pageHtml, pageText] = await Promise.all([
          readFile(path.join(runDirectoryPath, 'input', 'page.html'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'page.txt'), 'utf8'),
        ])

        expect(pageHtml).toContain('<main>')
        expect(pageHtml).toContain('Senior Product Designer')
        expect(pageHtml).not.toContain('People you may know')
        expect(pageHtml).not.toContain('Recommended jobs')
        expect(pageHtml.length).toBeLessThan(60_001)
        expect(pageText).toContain('Lead product design for authenticated desktop workflows.')
        expect(pageText).not.toContain('People you may know')
        expect(pageText).not.toContain('Recommended jobs')
        expect(pageText.length).toBeLessThan(24_001)

        return {
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
        } satisfies VacancyNormalizationWorkerResult
      },
    ),
  }
  const service = createVacancyNormalizationService({
    generateId: vi.fn(() => 'vacancy-normalization-run-linkedin-focus'),
    runWorkspaceRootPath,
    worker,
  })
  const profileNoise = '<div>People you may know</div>'.repeat(4000)
  const relatedJobNoise =
    '<section><h2>Recommended jobs</h2><p>More jobs for you.</p></section>'.repeat(2000)

  await expect(
    service.normalizeVacancy({
      html: [
        '<html>',
        '<body>',
        `<aside>${profileNoise}</aside>`,
        '<main>',
        '<h1>Senior Product Designer</h1>',
        '<p>Example Labs</p>',
        '<p>London, United Kingdom</p>',
        '<section><h2>Responsibilities</h2><ul><li>Lead product design for authenticated desktop workflows.</li><li>Partner with engineering and research.</li></ul></section>',
        '<section><h2>Requirements</h2><ul><li>Experience shipping workflow software.</li><li>Excellent written communication.</li></ul></section>',
        relatedJobNoise,
        '</main>',
        '</body>',
        '</html>',
      ].join(''),
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      pageTitle: 'Senior Product Designer | LinkedIn',
      resolvedUrl: 'https://www.linkedin.com/jobs/view/123456',
      source: 'linkedin',
    }),
  ).resolves.toEqual({
    bodyText:
      'Lead product design for authenticated desktop workflows. Partner with engineering and research.',
    employer: 'Example Labs',
    location: 'London, United Kingdom',
    requirements: ['Experience shipping workflow software.'],
    responsibilities: ['Lead product design for authenticated desktop workflows.'],
    title: 'Senior Product Designer',
  } satisfies NormalizedVacancy)
})
