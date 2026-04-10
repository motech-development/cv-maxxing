import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import type {
  OriginalCvFileType,
  OriginalCvImportErrorCode,
  OriginalCvSummary,
  OriginalCvWritingStyle,
  OriginalCvWorkspaceState,
} from '../shared/original-cv.js'
import {
  ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE,
  assessEnglishLanguageSupport,
} from '../shared/language-support.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'
import { OriginalCvNormalizationError } from './original-cv-normalization-error.js'
import type {
  NormalizedOriginalCv,
  OriginalCvNormalizationService,
} from './original-cv-normalization-service.js'

const ORIGINAL_CV_SCOPE = 'original-cvs'
const INVALID_NORMALIZATION_MESSAGE =
  'This original CV could not be organised reliably. Try a clearer PDF or DOCX.'
const UNREADABLE_EXTRACTION_MESSAGE =
  'This original CV could not be read reliably. Use a text-based PDF or DOCX.'

interface ExtractedDocumentText {
  pageCount: number
  text: string
}

interface StoredOriginalCvRecord extends OriginalCvSummary {
  checksum: string
  extractedText: string
  fullName: string
  isActive: boolean
}

interface OriginalCvServiceDependencies {
  extractTextFromDocx: (content: Buffer) => Promise<ExtractedDocumentText>
  extractTextFromPdf: (content: Buffer) => Promise<ExtractedDocumentText>
  generateId?: () => string
  getCurrentTimestamp?: () => string
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>
  normalizationService: OriginalCvNormalizationService
}

export interface ImportOriginalCvInput {
  content: Buffer
  filename: string
}

export interface OriginalCvService {
  getWorkspaceState: () => Promise<OriginalCvWorkspaceState>
  importOriginalCv: (input: ImportOriginalCvInput) => Promise<OriginalCvSummary>
}

interface OriginalCvMetadataValue extends Record<string, JsonValue> {
  checksum: string
  extractedText: string
  fileType: OriginalCvFileType
  fullName: string
  headline: string
  id: string
  importedAt: string
  isActive: boolean
  originalFilename: string
  pageCount: number
  summary: string
  writingStyle: {
    averageSentenceLength: number
    clicheDetections: string[]
    firstPersonUsage: OriginalCvWritingStyle['firstPersonUsage']
    formality: OriginalCvWritingStyle['formality']
  }
}

export class OriginalCvImportError extends Error {
  readonly code: OriginalCvImportErrorCode

  override name = 'OriginalCvImportError'

  constructor({ code, message }: { code: OriginalCvImportErrorCode; message: string }) {
    super(message)
    this.code = code
  }
}

export function createOriginalCvService({
  extractTextFromDocx,
  extractTextFromPdf,
  generateId = randomUUID,
  getCurrentTimestamp = () => {
    return new Date().toISOString()
  },
  localAppData,
  normalizationService,
}: OriginalCvServiceDependencies): OriginalCvService {
  return {
    getWorkspaceState: async (): Promise<OriginalCvWorkspaceState> => {
      const storedRecords = await listStoredRecords(localAppData)
      const activeRecord = storedRecords.find((record) => {
        return record.isActive
      })

      return {
        activeOriginalCv: activeRecord
          ? toOriginalCvSummary(activeRecord, storedRecords.length)
          : null,
        snapshotCount: storedRecords.length,
      }
    },
    importOriginalCv: async ({
      content,
      filename,
    }: ImportOriginalCvInput): Promise<OriginalCvSummary> => {
      const fileType = getOriginalCvFileType(filename)
      const extractedDocument =
        fileType === 'pdf' ? await extractTextFromPdf(content) : await extractTextFromDocx(content)

      if (!isReadableExtraction(extractedDocument.text)) {
        throw new OriginalCvImportError({
          code: 'unreadable_extraction',
          message: UNREADABLE_EXTRACTION_MESSAGE,
        })
      }

      if (assessEnglishLanguageSupport(extractedDocument.text).status === 'blocked') {
        throw new OriginalCvImportError({
          code: 'unsupported_language',
          message: ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE,
        })
      }

      let normalizedCv: NormalizedOriginalCv
      let writingStyle: OriginalCvWritingStyle

      try {
        const normalizationResult = await normalizationService.normalizeOriginalCv({
          extractedText: extractedDocument.text,
          fileType,
          originalFilename: filename,
          pageCount: extractedDocument.pageCount,
        })

        normalizedCv = normalizationResult.normalizedCv
        writingStyle = normalizationResult.writingStyle
      } catch (error) {
        if (error instanceof OriginalCvNormalizationError) {
          throw new OriginalCvImportError({
            code: 'invalid_normalization',
            message: INVALID_NORMALIZATION_MESSAGE,
          })
        }

        throw error
      }

      validateNormalizedOriginalCv({
        normalizedCv,
      })
      const importedAt = getCurrentTimestamp()
      const id = generateId()
      const checksum = createHash('sha256').update(content).digest('hex')
      const existingRecords = await listStoredRecords(localAppData)
      const nextSnapshotCount = existingRecords.length + 1

      await deactivateExistingOriginalCvs({
        localAppData,
        records: existingRecords,
      })
      await persistOriginalCvArtifacts({
        content,
        extractedText: extractedDocument.text,
        fileType,
        id,
        localAppData,
        normalizedCv,
        writingStyle,
      })

      const storedRecord: StoredOriginalCvRecord = {
        checksum,
        extractedText: extractedDocument.text,
        fileType,
        fullName: normalizedCv.fullName,
        headline: normalizedCv.headline,
        id,
        importedAt,
        isActive: true,
        originalFilename: filename,
        pageCount: extractedDocument.pageCount,
        snapshotCount: nextSnapshotCount,
        summary: normalizedCv.summary,
        writingStyle,
      }

      await localAppData.metadata.put({
        id,
        scope: ORIGINAL_CV_SCOPE,
        value: toOriginalCvMetadataValue(storedRecord),
      })

      return toOriginalCvSummary(storedRecord, nextSnapshotCount)
    },
  }
}

async function deactivateExistingOriginalCvs({
  localAppData,
  records,
}: {
  localAppData: Pick<LocalAppDataStore, 'metadata'>
  records: StoredOriginalCvRecord[]
}): Promise<void> {
  await Promise.all(
    records
      .filter((record) => {
        return record.isActive
      })
      .map(async (record) => {
        await localAppData.metadata.put({
          id: record.id,
          scope: ORIGINAL_CV_SCOPE,
          value: toOriginalCvMetadataValue({
            ...record,
            isActive: false,
          }),
        })
      }),
  )
}

async function persistOriginalCvArtifacts({
  content,
  extractedText,
  fileType,
  id,
  localAppData,
  normalizedCv,
  writingStyle,
}: {
  content: Buffer
  extractedText: string
  fileType: OriginalCvFileType
  id: string
  localAppData: Pick<LocalAppDataStore, 'artifacts'>
  normalizedCv: NormalizedOriginalCv
  writingStyle: OriginalCvWritingStyle
}): Promise<void> {
  await localAppData.artifacts.write({
    content,
    id,
    name: `source.${fileType}`,
    scope: ORIGINAL_CV_SCOPE,
  })
  await localAppData.artifacts.write({
    content: Buffer.from(extractedText, 'utf8'),
    id,
    name: 'extracted.txt',
    scope: ORIGINAL_CV_SCOPE,
  })
  await localAppData.artifacts.write({
    content: Buffer.from(JSON.stringify(normalizedCv), 'utf8'),
    id,
    name: 'normalized.json',
    scope: ORIGINAL_CV_SCOPE,
  })
  await localAppData.artifacts.write({
    content: Buffer.from(JSON.stringify(writingStyle), 'utf8'),
    id,
    name: 'writing-style-profile.json',
    scope: ORIGINAL_CV_SCOPE,
  })
}

async function listStoredRecords(
  localAppData: Pick<LocalAppDataStore, 'metadata'>,
): Promise<StoredOriginalCvRecord[]> {
  const records = await localAppData.metadata.list<OriginalCvMetadataValue>(ORIGINAL_CV_SCOPE)

  return records
    .map((record) => {
      return fromOriginalCvMetadataValue(record.value)
    })
    .toSorted((leftRecord, rightRecord) => {
      return leftRecord.importedAt.localeCompare(rightRecord.importedAt)
    })
}

function fromOriginalCvMetadataValue(value: OriginalCvMetadataValue): StoredOriginalCvRecord {
  return {
    checksum: value.checksum,
    extractedText: value.extractedText,
    fileType: value.fileType,
    fullName: value.fullName,
    headline: value.headline,
    id: value.id,
    importedAt: value.importedAt,
    isActive: value.isActive,
    originalFilename: value.originalFilename,
    pageCount: value.pageCount,
    snapshotCount: 0,
    summary: value.summary,
    writingStyle: value.writingStyle,
  }
}

function toOriginalCvMetadataValue(record: StoredOriginalCvRecord): OriginalCvMetadataValue {
  return {
    checksum: record.checksum,
    extractedText: record.extractedText,
    fileType: record.fileType,
    fullName: record.fullName,
    headline: record.headline,
    id: record.id,
    importedAt: record.importedAt,
    isActive: record.isActive,
    originalFilename: record.originalFilename,
    pageCount: record.pageCount,
    summary: record.summary,
    writingStyle: {
      averageSentenceLength: record.writingStyle.averageSentenceLength,
      clicheDetections: record.writingStyle.clicheDetections,
      firstPersonUsage: record.writingStyle.firstPersonUsage,
      formality: record.writingStyle.formality,
    },
  }
}

function toOriginalCvSummary(
  record: StoredOriginalCvRecord,
  snapshotCount: number,
): OriginalCvSummary {
  return {
    fileType: record.fileType,
    headline: record.headline,
    id: record.id,
    importedAt: record.importedAt,
    originalFilename: record.originalFilename,
    pageCount: record.pageCount,
    snapshotCount,
    summary: record.summary,
    writingStyle: record.writingStyle,
  }
}

function getOriginalCvFileType(filename: string): OriginalCvFileType {
  const extension = path.extname(filename).toLowerCase()

  if (extension === '.pdf') {
    return 'pdf'
  }

  if (extension === '.docx') {
    return 'docx'
  }

  throw new OriginalCvImportError({
    code: 'unsupported_file_type',
    message: 'Original CV import supports PDF and DOCX files only.',
  })
}

function isReadableExtraction(extractedText: string): boolean {
  const trimmedText = extractedText.trim()
  const letters = trimmedText.match(/[a-z]/giu)?.length ?? 0
  const alphaRatio = trimmedText.length === 0 ? 0 : letters / trimmedText.length

  return trimmedText.length >= 80 && alphaRatio >= 0.45
}

function validateNormalizedOriginalCv({
  normalizedCv,
}: {
  normalizedCv: NormalizedOriginalCv
}): void {
  const hasReadableIdentity =
    countWords(normalizedCv.fullName) >= 2 || countWords(normalizedCv.headline) >= 2
  const hasSubstantiveExperience = normalizedCv.experience.some((entry) => {
    return countWords(entry) >= 4
  })
  const hasSubstantiveSkills = normalizedCv.skills.length >= 3
  const hasSummary = countWords(normalizedCv.summary) >= 6

  if (!hasReadableIdentity || (!hasSubstantiveExperience && !hasSubstantiveSkills) || !hasSummary) {
    throw new OriginalCvImportError({
      code: 'weak_normalization',
      message: INVALID_NORMALIZATION_MESSAGE,
    })
  }
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/u)
    .filter((word) => {
      return word !== ''
    }).length
}
