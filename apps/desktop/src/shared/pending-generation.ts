import type { TailoredApplicationWorkspaceState } from './tailored-application.js';
import type { VacancyDraft } from './vacancy.js';

export interface PendingGenerationCommand {
  commandId: string;
  originalCvId: string;
  originalCvLabel: string;
  vacancyId: string;
  vacancyDraft: VacancyDraft;
}

export interface StartPendingGenerationInput {
  originalCvId: string;
  originalCvLabel: string;
  vacancyDraft: VacancyDraft;
}

export interface CompletePendingGenerationInput {
  commandId: string;
}

export interface CompletePendingGenerationResult {
  workspaceState: TailoredApplicationWorkspaceState;
}

export interface ResumePendingGenerationResult {
  generationRunId: string;
  tailoredApplicationId: string;
}
