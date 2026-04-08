import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import type {
  OriginalCvFileType,
  OriginalCvImportErrorCode,
  OriginalCvSummary,
  OriginalCvWorkspaceState,
} from '../shared/original-cv.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'

const ORIGINAL_CV_SCOPE = 'original-cvs'

type WritingStyleFormality = 'conversational' | 'direct' | 'formal'
type WritingStyleFirstPersonUsage = 'absent' | 'mixed' | 'present'

interface OriginalCvWritingStyle {
  averageSentenceLength: number
  clicheDetections: string[]
  firstPersonUsage: WritingStyleFirstPersonUsage
  formality: WritingStyleFormality
}

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
}

export interface ImportOriginalCvInput {
  content: Buffer
  filename: string
}

export interface OriginalCvService {
  getWorkspaceState: () => Promise<OriginalCvWorkspaceState>
  importOriginalCv: (input: ImportOriginalCvInput) => Promise<OriginalCvSummary>
}

interface NormalizedOriginalCv {
  experience: string[]
  fullName: string
  headline: string
  skills: string[]
  summary: string
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
    firstPersonUsage: WritingStyleFirstPersonUsage
    formality: WritingStyleFormality
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
      const normalizedCv = normalizeOriginalCv(extractedDocument.text)
      validateExtractedOriginalCv({
        extractedText: extractedDocument.text,
        normalizedCv,
      })
      const writingStyle = createWritingStyleProfile(extractedDocument.text)
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

function normalizeOriginalCv(extractedText: string): NormalizedOriginalCv {
  const lines = extractedText
    .split(/\r?\n/u)
    .map((line) => {
      return line.trim()
    })
    .filter((line) => {
      return line !== ''
    })

  const summaryIndex = lines.findIndex((line) => {
    return line.toLowerCase() === 'summary'
  })
  const experienceIndex = lines.findIndex((line) => {
    return line.toLowerCase() === 'experience'
  })
  const skillsIndex = lines.findIndex((line) => {
    return line.toLowerCase() === 'skills'
  })
  const experienceSectionEndIndex = findNextSectionIndex({
    currentSectionIndex: experienceIndex,
    sectionIndexes: [skillsIndex],
  })

  return {
    experience:
      experienceIndex === -1 ? [] : lines.slice(experienceIndex + 1, experienceSectionEndIndex),
    fullName: lines[0] ?? '',
    headline: lines[1] ?? '',
    skills:
      skillsIndex === -1
        ? []
        : lines.slice(skillsIndex + 1).flatMap((line) => {
            return line
              .split(',')
              .map((entry) => {
                return entry.trim()
              })
              .filter((entry) => {
                return entry !== ''
              })
          }),
    summary: summaryIndex === -1 ? '' : (lines[summaryIndex + 1] ?? ''),
  }
}

function findNextSectionIndex({
  currentSectionIndex,
  sectionIndexes,
}: {
  currentSectionIndex: number
  sectionIndexes: number[]
}): number | undefined {
  const nextSectionIndex = sectionIndexes
    .filter((sectionIndex) => {
      return sectionIndex > currentSectionIndex
    })
    .toSorted((leftIndex, rightIndex) => {
      return leftIndex - rightIndex
    })[0]

  return nextSectionIndex
}

function createWritingStyleProfile(extractedText: string): OriginalCvWritingStyle {
  const proseLines = extractedText
    .split(/\r?\n/u)
    .map((line) => {
      return line.trim()
    })
    .filter((line) => {
      return /\s/u.test(line) && !/^(summary|experience|skills)$/iu.test(line)
    })
  const sentenceLengths = proseLines
    .flatMap((line) => {
      return line
        .split(/[.!?]+/u)
        .map((sentence) => {
          return sentence.trim()
        })
        .filter((sentence) => {
          return sentence !== ''
        })
    })
    .map((sentence) => {
      return sentence.split(/\s+/u).filter((word) => {
        return word !== ''
      }).length
    })
  const pronounUsageBySentence = proseLines
    .flatMap((line) => {
      return line
        .split(/[.!?]+/u)
        .map((sentence) => {
          return sentence.trim()
        })
        .filter((sentence) => {
          return sentence !== ''
        })
    })
    .map((sentence) => {
      return /\b(i|me|my|mine|we|our|ours)\b/iu.test(sentence)
    })
  const averageSentenceLength =
    sentenceLengths.length === 0
      ? 0
      : Math.round(
          sentenceLengths.reduce((total, sentenceLength) => {
            return total + sentenceLength
          }, 0) / sentenceLengths.length,
        )
  const lowerCaseText = extractedText.toLowerCase()
  const sentencesWithPronouns = pronounUsageBySentence.filter(Boolean).length
  let firstPersonUsage: WritingStyleFirstPersonUsage = 'absent'

  if (sentencesWithPronouns === pronounUsageBySentence.length && sentencesWithPronouns > 0) {
    firstPersonUsage = 'present'
  } else if (sentencesWithPronouns > 0) {
    firstPersonUsage = 'mixed'
  }

  return {
    averageSentenceLength,
    clicheDetections: ['results-driven', 'team player', 'hard-working'].filter((phrase) => {
      return lowerCaseText.includes(phrase)
    }),
    firstPersonUsage,
    formality: averageSentenceLength >= 10 ? 'formal' : 'direct',
  }
}

function validateExtractedOriginalCv({
  extractedText,
  normalizedCv,
}: {
  extractedText: string
  normalizedCv: NormalizedOriginalCv
}): void {
  const trimmedText = extractedText.trim()
  const letters = trimmedText.match(/[a-z]/giu)?.length ?? 0
  const alphaRatio = trimmedText.length === 0 ? 0 : letters / trimmedText.length
  const hasReadableIdentity =
    countWords(normalizedCv.fullName) >= 2 || countWords(normalizedCv.headline) >= 2
  const hasSubstantiveExperience = normalizedCv.experience.some((entry) => {
    return countWords(entry) >= 4
  })
  const hasSubstantiveSkills = normalizedCv.skills.length >= 3
  const hasSummary = countWords(normalizedCv.summary) >= 6

  if (
    trimmedText.length < 80 ||
    alphaRatio < 0.45 ||
    !hasReadableIdentity ||
    (!hasSubstantiveExperience && !hasSubstantiveSkills) ||
    !hasSummary
  ) {
    throw new OriginalCvImportError({
      code: 'weak_extraction',
      message: 'This original CV could not be read reliably. Use a text-based PDF or DOCX.',
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
