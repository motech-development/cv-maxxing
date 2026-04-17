export interface ResolveRendererLoadingStateInput {
  hasActiveOriginalCv: boolean
  isCheckingAiWorkerReadiness: boolean
  isFetchingTailoredApplicationPreview: boolean
  isGeneratingTailoredApplication: boolean
  isImportingOriginalCv: boolean
  isResettingLocalAppData: boolean
  isReviewingVacancy: boolean
}

export type RendererLoadingKind =
  | 'ai_worker_readiness'
  | 'idle'
  | 'original_cv_import'
  | 'reset_local_app_data'
  | 'tailored_application_generation'
  | 'tailored_application_preview'
  | 'vacancy_review'

export type RendererLoadingScope = 'ambient' | 'app_blocking' | 'idle' | 'workspace_blocking'

interface ActiveRendererLoadingState {
  kind: Exclude<RendererLoadingKind, 'idle'>
  label: string
  scope: Exclude<RendererLoadingScope, 'idle'>
}

export type RendererLoadingState =
  | {
      kind: 'idle'
      label: null
      scope: 'idle'
    }
  | ActiveRendererLoadingState

const rendererLoadingPriorityOrder: readonly Exclude<RendererLoadingScope, 'idle'>[] = [
  'app_blocking',
  'workspace_blocking',
  'ambient',
]

const idleRendererLoadingState: RendererLoadingState = {
  kind: 'idle',
  label: null,
  scope: 'idle',
}

export function resolveRendererLoadingState(
  input: ResolveRendererLoadingStateInput,
): RendererLoadingState {
  const activeLoadingStates: ActiveRendererLoadingState[] = []

  if (input.isCheckingAiWorkerReadiness) {
    activeLoadingStates.push({
      kind: 'ai_worker_readiness',
      label: 'Preparing app',
      scope: 'app_blocking',
    })
  }

  if (input.isResettingLocalAppData) {
    activeLoadingStates.push({
      kind: 'reset_local_app_data',
      label: 'Preparing app',
      scope: 'app_blocking',
    })
  }

  if (input.isImportingOriginalCv) {
    activeLoadingStates.push({
      kind: 'original_cv_import',
      label: input.hasActiveOriginalCv ? 'Updating your CV...' : 'Adding your CV...',
      scope: 'workspace_blocking',
    })
  }

  if (input.isReviewingVacancy) {
    activeLoadingStates.push({
      kind: 'vacancy_review',
      label: 'Checking job details...',
      scope: 'workspace_blocking',
    })
  }

  if (input.isGeneratingTailoredApplication) {
    activeLoadingStates.push({
      kind: 'tailored_application_generation',
      label: 'Tailoring your CV...',
      scope: 'workspace_blocking',
    })
  }

  if (input.isFetchingTailoredApplicationPreview) {
    activeLoadingStates.push({
      kind: 'tailored_application_preview',
      label: 'Background activity',
      scope: 'ambient',
    })
  }

  for (const scope of rendererLoadingPriorityOrder) {
    const resolvedLoadingState = activeLoadingStates.find((candidate) => {
      return candidate.scope === scope
    })

    if (resolvedLoadingState !== undefined) {
      return resolvedLoadingState
    }
  }

  return idleRendererLoadingState
}
