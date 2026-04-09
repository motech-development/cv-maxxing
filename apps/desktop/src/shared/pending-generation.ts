import type { VacancyDraft } from './vacancy.js'

export interface PendingGenerationCommand {
  commandId: string
  originalCvId: string
  originalCvLabel: string
  vacancyDraft: VacancyDraft
}

export interface StartPendingGenerationInput {
  originalCvId: string
  originalCvLabel: string
  vacancyDraft: VacancyDraft
}

export interface CompletePendingGenerationInput {
  commandId: string
}
