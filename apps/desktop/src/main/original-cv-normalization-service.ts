import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { OriginalCvFileType, OriginalCvWritingStyle } from '../shared/original-cv.js'
import type { OriginalCvNormalizationWorker } from './original-cv-normalization-worker.js'

export interface NormalizedOriginalCv {
  experience: string[]
  fullName: string
  headline: string
  skills: string[]
  summary: string
}

export interface OriginalCvNormalizationInput {
  extractedText: string
  fileType: OriginalCvFileType
  originalFilename: string
  pageCount: number
}

export interface OriginalCvNormalizationResult {
  normalizedCv: NormalizedOriginalCv
  writingStyle: OriginalCvWritingStyle
}

export interface OriginalCvNormalizationService {
  normalizeOriginalCv: (
    input: OriginalCvNormalizationInput,
  ) => Promise<OriginalCvNormalizationResult>
}

const missingOriginalCvNormalizationWorker: OriginalCvNormalizationWorker = {
  runNormalization: () => {
    return Promise.reject(new Error('No original-CV normalization worker is configured.'))
  },
}

export function createOriginalCvNormalizationService({
  generateId = randomUUID,
  runWorkspaceRootPath,
  worker = missingOriginalCvNormalizationWorker,
}: {
  generateId?: () => string
  runWorkspaceRootPath: string
  worker?: OriginalCvNormalizationWorker
}): OriginalCvNormalizationService {
  return {
    normalizeOriginalCv: async (input): Promise<OriginalCvNormalizationResult> => {
      const runDirectoryPath = path.join(runWorkspaceRootPath, generateId())

      await writeRunWorkspaceInput({
        input,
        runDirectoryPath,
      })

      try {
        return await worker.runNormalization({
          runDirectoryPath,
          signal: new AbortController().signal,
        })
      } finally {
        await rm(runDirectoryPath, {
          force: true,
          recursive: true,
        })
      }
    },
  }
}

async function writeRunWorkspaceInput({
  input,
  runDirectoryPath,
}: {
  input: OriginalCvNormalizationInput
  runDirectoryPath: string
}): Promise<void> {
  const inputDirectoryPath = path.join(runDirectoryPath, 'input')
  const taskJson = JSON.stringify({
    constraints: {
      keepMissingFieldsEmpty: true,
      outputLanguage: 'British English',
      preserveSourceMeaning: true,
      remainVacancyAware: false,
    },
    originalCv: {
      extractedTextPath: 'input/original-cv.txt',
      fileType: input.fileType,
      originalFilename: input.originalFilename,
      pageCount: input.pageCount,
    },
    outputContract: {
      normalizedArtifactName: 'normalized.json',
      writingStyleArtifactName: 'writing-style-profile.json',
    },
  })

  await mkdir(inputDirectoryPath, {
    recursive: true,
  })
  await Promise.all([
    writeFile(path.join(inputDirectoryPath, 'original-cv.txt'), input.extractedText, 'utf8'),
    writeFile(path.join(inputDirectoryPath, 'task.json'), taskJson, 'utf8'),
  ])
}
