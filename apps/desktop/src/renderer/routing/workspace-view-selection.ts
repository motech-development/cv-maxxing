import type { TailoredApplicationWorkspaceState } from '../../shared/tailored-application.js';
import type { JobsWorkspaceSelection } from '../../shared/workspace-selection.js';

export type WorkspaceSelectionOverride = JobsWorkspaceSelection | null;
export type WorkspaceViewKind = 'draft' | 'tailored_application';

export interface ResolvedWorkspaceViewSelection {
  kind: WorkspaceViewKind;
}

interface ResolveTailoredApplicationIdInput {
  preferredTailoredApplicationId: string | null;
  workspaceState: TailoredApplicationWorkspaceState;
}

interface ResolveWorkspaceViewSelectionInput {
  forcedSelection: WorkspaceSelectionOverride;
  hasMeaningfulDraft: boolean;
  hasPendingGeneration: boolean;
  resolvedTailoredApplicationId: string | null;
}

export function resolveTailoredApplicationId({
  preferredTailoredApplicationId,
  workspaceState,
}: ResolveTailoredApplicationIdInput): string | null {
  const preferredTailoredApplicationStillExists = workspaceState.applications.some(
    (application) => {
      return application.id === preferredTailoredApplicationId;
    },
  );

  if (preferredTailoredApplicationStillExists) {
    return preferredTailoredApplicationId;
  }

  return workspaceState.activeApplicationId;
}

export function resolveWorkspaceViewSelection({
  forcedSelection,
  hasMeaningfulDraft,
  hasPendingGeneration,
  resolvedTailoredApplicationId,
}: ResolveWorkspaceViewSelectionInput): ResolvedWorkspaceViewSelection {
  if (forcedSelection?.kind === 'tailored_application') {
    return {
      kind: 'tailored_application',
    };
  }

  if (forcedSelection?.kind === 'draft') {
    return forcedSelection;
  }

  if (hasPendingGeneration) {
    return {
      kind: 'draft',
    };
  }

  if (resolvedTailoredApplicationId !== null) {
    return {
      kind: 'tailored_application',
    };
  }

  if (hasMeaningfulDraft) {
    return {
      kind: 'draft',
    };
  }

  return {
    kind: 'draft',
  };
}
