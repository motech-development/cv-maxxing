import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createOriginalCvNormalizationService } from '../original-cv-normalization-service.js'

const temporaryDirectories: string[] = []

interface NormalizationExample {
  normalizedCv: {
    experience: string[]
    headline: string
    summary: string
  }
  title: string
}

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

test('writes a dedicated normalization run workspace with derived-field examples and removes it after the worker returns', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-original-cv-normalization-service-'),
  )

  temporaryDirectories.push(runWorkspaceRootPath)

  const worker = {
    runNormalization: vi.fn(
      async ({ runDirectoryPath }: { runDirectoryPath: string; signal: AbortSignal }) => {
        const [examplesJson, taskJson, originalCvText] = await Promise.all([
          readFile(path.join(runDirectoryPath, 'input', 'examples.json'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'task.json'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'original-cv.txt'), 'utf8'),
        ])
        const parsedTask = JSON.parse(taskJson) as unknown
        const parsedExamples = JSON.parse(examplesJson) as unknown

        expect(parsedTask).toEqual({
          constraints: {
            deriveFaithfulFieldsWhenNeeded: true,
            keepMissingFieldsEmpty: true,
            outputLanguage: 'British English',
            preserveSourceMeaning: true,
            remainVacancyAware: false,
          },
          examplesPath: 'input/examples.json',
          originalCv: {
            extractedTextPath: 'input/original-cv.txt',
            fileType: 'pdf',
            originalFilename: 'ada-lovelace.pdf',
            pageCount: 2,
          },
          outputContract: {
            normalizedArtifactName: 'normalized.json',
            writingStyleArtifactName: 'writing-style-profile.json',
          },
        })
        expect(Array.isArray(parsedExamples)).toBe(true)

        const examples = parsedExamples as NormalizationExample[]
        const headingVariantExample = examples.find((example) => {
          return example.title === 'Heading variants and faithful summary recovery'
        })
        const fragmentedExperienceExample = examples.find((example) => {
          return (
            example.title === 'Fragmented experience regrouping and conservative skills recovery'
          )
        })

        expect(headingVariantExample?.normalizedCv.headline).toBe('Principal Product Designer')
        expect(headingVariantExample?.normalizedCv.summary).toBe(
          'Design leader focused on complex workflow products for technical users.',
        )
        expect(fragmentedExperienceExample?.normalizedCv.experience).toContain(
          'Senior Content Strategist | Difference Engines Ltd',
        )
        expect(originalCvText).toBe('Ada Lovelace\nPrincipal Product Designer')

        return {
          normalizedCv: {
            experience: ['Principal Product Designer | Analytical Engines Ltd'],
            fullName: 'Ada Lovelace',
            headline: 'Principal Product Designer',
            skills: ['Product strategy', 'UX research', 'Prototyping'],
            summary: 'Design leader focused on complex workflow products for technical users.',
          },
          writingStyle: {
            averageSentenceLength: 12,
            clicheDetections: [],
            firstPersonUsage: 'absent' as const,
            formality: 'formal' as const,
          },
        }
      },
    ),
  }
  const service = createOriginalCvNormalizationService({
    generateId: vi.fn(() => 'normalization-run-001'),
    runWorkspaceRootPath,
    worker,
  })

  await expect(
    service.normalizeOriginalCv({
      extractedText: 'Ada Lovelace\nPrincipal Product Designer',
      fileType: 'pdf',
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 2,
    }),
  ).resolves.toEqual({
    normalizedCv: {
      experience: ['Principal Product Designer | Analytical Engines Ltd'],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Product strategy', 'UX research', 'Prototyping'],
      summary: 'Design leader focused on complex workflow products for technical users.',
    },
    writingStyle: {
      averageSentenceLength: 12,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'formal',
    },
  })
  const firstCall = worker.runNormalization.mock.calls[0]?.[0]

  expect(firstCall?.runDirectoryPath).toBe(path.join(runWorkspaceRootPath, 'normalization-run-001'))
  expect(firstCall?.signal).toBeInstanceOf(AbortSignal)
  await expect(readdir(runWorkspaceRootPath)).resolves.toEqual([])
})
