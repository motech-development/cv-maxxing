import type { OriginalCvSummary } from './original-cv.js'
import type { VacancySummary } from './vacancy.js'

export interface GroundedText {
  text: string
}

export interface GeneratedAdaptedCvHeader {
  intro: GroundedText
}

export interface AdaptedCvHeaderContact {
  email: string | null
  location: string | null
  phone: string | null
  professionalLink: string | null
}

export interface AdaptedCvHeader extends GeneratedAdaptedCvHeader {
  contact: AdaptedCvHeaderContact
}

export interface AdaptedCvExperienceEntry {
  bullets: GroundedText[]
  dateRange: string
  employer: string
  location: string | null
  roleTitle: string
}

export interface AdaptedCvSkill {
  text: string
}

export interface AdaptedCvProfileSection {
  kind: 'profile'
  summary: GroundedText
}

export interface AdaptedCvExperienceSection {
  items: AdaptedCvExperienceEntry[]
  kind: 'experience'
}

export interface AdaptedCvCoreSkillsSection {
  items: AdaptedCvSkill[]
  kind: 'core_skills'
}

export interface AdaptedCvSelectedWorkSection {
  items: GroundedText[]
  kind: 'selected_work'
}

export interface AdaptedCvToolsSection {
  items: GroundedText[]
  kind: 'tools'
}

export interface AdaptedCvEducationEntry {
  meta: string
  title: string
}

export interface AdaptedCvEducationSection {
  entry: AdaptedCvEducationEntry | null
  kind: 'education'
}

export interface AdaptedCvCertificationsSection {
  items: GroundedText[]
  kind: 'certifications'
}

export interface AdaptedCvLanguagesSection {
  items: GroundedText[]
  kind: 'languages'
}

export interface AdaptedCvFocusSection {
  items: GroundedText[]
  kind: 'focus'
}

export interface AdaptedCvImpactHighlightsSection {
  items: GroundedText[]
  kind: 'impact_highlights'
}

export interface AdaptedCvReferencesSection {
  kind: 'references'
}

export type AdaptedCvSection =
  | AdaptedCvCertificationsSection
  | AdaptedCvCoreSkillsSection
  | AdaptedCvEducationSection
  | AdaptedCvExperienceSection
  | AdaptedCvFocusSection
  | AdaptedCvImpactHighlightsSection
  | AdaptedCvLanguagesSection
  | AdaptedCvProfileSection
  | AdaptedCvSelectedWorkSection
  | AdaptedCvToolsSection
  | AdaptedCvReferencesSection

export type GeneratedAdaptedCvSection = AdaptedCvSection

export interface GeneratedAdaptedCvModel {
  candidateName: string
  header: GeneratedAdaptedCvHeader
  headline: GroundedText
  sections: GeneratedAdaptedCvSection[]
}

export interface AdaptedCvModel extends Omit<GeneratedAdaptedCvModel, 'header'> {
  header: AdaptedCvHeader
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
  adaptedCv: GeneratedAdaptedCvModel
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
