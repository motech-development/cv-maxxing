import type { OriginalCvSummary } from './original-cv.js'
import type { VacancySummary } from './vacancy.js'

export interface GroundedText {
  text: string
}

export interface AdaptedCvExperienceHighlight {
  bullets: GroundedText[]
  heading: string
}

export interface AdaptedCvSkill {
  text: string
}

export interface AdaptedCvModel {
  candidateName: string
  experienceHighlights: AdaptedCvExperienceHighlight[]
  headline: GroundedText
  skills: AdaptedCvSkill[]
  summary: GroundedText
}

export interface CoverLetterModel {
  body: GroundedText[]
  closing: GroundedText
  date: string
  greeting: string
  opening: GroundedText
  signature: string
}

export interface AdaptationSummaryModel {
  emphasized: GroundedText[]
  gaps: string[]
  omitted: GroundedText[]
  validationHints: string[]
}

export interface TailoredApplicationGenerationResult {
  adaptationSummary: AdaptationSummaryModel
  adaptedCv: AdaptedCvModel
  coverLetter: CoverLetterModel
  trace: {
    model: string | null
    provider: 'codex'
    sessionId: string | null
  }
}

export interface TailoredApplicationListItem {
  createdAt: string
  employer: string | null
  id: string
  pageCount: number
  pageWarning: string | null
  title: string
  vacancyTitle: string | null
}

export interface TailoredApplicationWorkspaceState {
  activeApplicationId: string | null
  applications: TailoredApplicationListItem[]
}

export interface TailoredApplicationPdfPreview {
  pageCount: number
  pageWarning: string | null
  pdfBytes: Uint8Array
}

export interface TailoredApplicationCoverLetterPreview extends TailoredApplicationPdfPreview {
  plainText: string
}

export interface TailoredApplicationPreview {
  adaptedCv: TailoredApplicationPdfPreview
  adaptationSummary: AdaptationSummaryModel
  coverLetter: TailoredApplicationCoverLetterPreview
  createdAt: string
  employer: string | null
  id: string
  originalCv: OriginalCvSummary
  title: string
  vacancy: VacancySummary
  vacancyTitle: string | null
}

export interface TailoredApplicationExportResult {
  filePath: string
  overwriteAvoided: boolean
  pageWarning: string | null
}
