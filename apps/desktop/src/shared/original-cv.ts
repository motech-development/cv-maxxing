import type { AiWorkerPreflightResult } from './ai-worker-preflight.js'

export type OriginalCvFileType = 'docx' | 'pdf'
export type OriginalCvImportErrorCode =
  | 'unsupported_file_type'
  | 'unsupported_language'
  | 'invalid_normalization'
  | 'unreadable_extraction'
  | 'weak_normalization'
export type WritingStyleFirstPersonUsage = 'absent' | 'mixed' | 'present'
export type WritingStyleFormality = 'conversational' | 'direct' | 'formal'

export interface OriginalCvWritingStyle {
  averageSentenceLength: number
  clicheDetections: string[]
  firstPersonUsage: WritingStyleFirstPersonUsage
  formality: WritingStyleFormality
}

export interface OriginalCvSummary {
  fileType: OriginalCvFileType
  headline: string
  id: string
  importedAt: string
  originalFilename: string
  pageCount: number
  snapshotCount: number
  summary: string
  writingStyle: OriginalCvWritingStyle
}

export interface OriginalCvWorkspaceState {
  activeOriginalCv: OriginalCvSummary | null
  snapshotCount: number
}

export interface OriginalCvImportInput {
  content: Uint8Array
  filename: string
}

export interface OriginalCvImportFailure {
  code: OriginalCvImportErrorCode
  message: string
}

export type OriginalCvImportBlockedPreflight = Exclude<AiWorkerPreflightResult, { status: 'ready' }>

export type OriginalCvImportResult =
  | {
      kind: 'imported'
      originalCv: OriginalCvSummary
    }
  | {
      kind: 'ai_worker_not_ready'
      preflight: OriginalCvImportBlockedPreflight
    }
  | {
      error: OriginalCvImportFailure
      kind: 'rejected'
    }
