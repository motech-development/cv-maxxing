import type { ReadinessRouteViewModel } from '../../readiness/readiness-route.js'
import type { OriginalCvWorkspaceState } from '../../shared/original-cv.js'

export type RendererScreenKind =
  | 'ai_worker_checking'
  | 'ai_worker_sign_in_required'
  | 'ai_worker_unavailable'
  | 'first_launch'
  | 'workspace_active'
  | 'workspace_empty'

export interface ResolveRendererScreenInput {
  originalCvWorkspaceState: OriginalCvWorkspaceState
  readinessViewModel: ReadinessRouteViewModel
}

export function resolveRendererScreen({
  originalCvWorkspaceState,
  readinessViewModel,
}: ResolveRendererScreenInput): RendererScreenKind {
  if (readinessViewModel.status === 'checking') {
    return 'ai_worker_checking'
  }

  if (readinessViewModel.status === 'sign_in_required') {
    return 'ai_worker_sign_in_required'
  }

  if (readinessViewModel.status === 'unavailable') {
    return 'ai_worker_unavailable'
  }

  if (readinessViewModel.startupDestination === 'workspace_active') {
    return 'workspace_active'
  }

  if (originalCvWorkspaceState.activeOriginalCv === null) {
    return 'first_launch'
  }

  return 'workspace_empty'
}
