export type VacancyInputType = 'pasted_text' | 'url'
export type VacancyReviewState = 'editable' | 'reviewed'
export type VacancySource = 'generic' | 'greenhouse' | 'indeed' | 'linkedin'
export type VacancyStatus = 'incomplete' | 'ready'

export interface VacancyDraft {
  text: string
  url: string
}

export interface VacancyUrlInput {
  url: string
}

export interface PastedVacancyInput {
  text: string
  url?: string
}

export interface VacancySummary {
  blockingReason: string | null
  canGenerate: boolean
  employer: string | null
  fetchedAt: string
  id: string
  inputType: VacancyInputType
  location: string | null
  originalUrl: string | null
  requirements: string[]
  resolvedUrl: string | null
  responsibilities: string[]
  source: VacancySource
  status: VacancyStatus
  textPreview: string
  title: string | null
}

export interface VacancyWorkspaceState {
  draft: VacancyDraft
  reviewState: VacancyReviewState
  vacancy: VacancySummary | null
}

export type VacancyIngestResult =
  | {
      kind: 'ingested'
      vacancy: VacancySummary
      workspaceState: VacancyWorkspaceState
    }
  | {
      kind: 'incomplete'
      vacancy: VacancySummary
      workspaceState: VacancyWorkspaceState
    }
