import { queryOptions } from '@tanstack/react-query'

import { createReadinessRouteViewModel } from '../readiness/readiness-route.js'

export const rendererQueryKeys = {
  originalCvDetail: ['original-cv', 'active-detail'] as const,
  originalCvWorkspace: ['original-cv', 'workspace'] as const,
  pendingGeneration: ['tailored-application', 'pending-generation'] as const,
  readiness: ['readiness-route'] as const,
  settings: ['settings'] as const,
  tailoredApplicationPreviewRoot: ['tailored-application', 'preview'] as const,
  workspaceSelection: ['tailored-application', 'workspace-selection'] as const,
  tailoredApplicationWorkspace: ['tailored-application', 'workspace'] as const,
  vacancyWorkspace: ['vacancy', 'workspace'] as const,
}

export function createTailoredApplicationPreviewQueryKey(tailoredApplicationId: string) {
  return [...rendererQueryKeys.tailoredApplicationPreviewRoot, tailoredApplicationId] as const
}

export function createActiveOriginalCvDetailQueryKey(originalCvId: string) {
  return [...rendererQueryKeys.originalCvDetail, originalCvId] as const
}

export function getActiveOriginalCvDetailQueryOptions(originalCvId: string) {
  return queryOptions({
    queryFn: async () => {
      return await globalThis.window.cvMaxxing.originalCv.getActiveOriginalCvDetail()
    },
    queryKey: createActiveOriginalCvDetailQueryKey(originalCvId),
  })
}

export function getReadinessViewModelQueryOptions() {
  return queryOptions({
    queryFn: async () => {
      return await createReadinessRouteViewModel({
        getAiWorkerPreflight: globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight,
        getStartupDestination: globalThis.window.cvMaxxing.aiWorker.getStartupDestination,
      })
    },
    queryKey: rendererQueryKeys.readiness,
  })
}

export function getSettingsSnapshotQueryOptions() {
  return queryOptions({
    queryFn: async () => {
      return await globalThis.window.cvMaxxing.settings.getSettingsSnapshot()
    },
    queryKey: rendererQueryKeys.settings,
  })
}

export function getOriginalCvWorkspaceStateQueryOptions() {
  return queryOptions({
    queryFn: async () => {
      return await globalThis.window.cvMaxxing.originalCv.getOriginalCvWorkspaceState()
    },
    queryKey: rendererQueryKeys.originalCvWorkspace,
  })
}

export function getVacancyWorkspaceStateQueryOptions() {
  return queryOptions({
    queryFn: async () => {
      return await globalThis.window.cvMaxxing.vacancy.getVacancyWorkspaceState()
    },
    queryKey: rendererQueryKeys.vacancyWorkspace,
  })
}

export function getTailoredApplicationWorkspaceStateQueryOptions() {
  return queryOptions({
    queryFn: async () => {
      return await globalThis.window.cvMaxxing.tailoredApplication.getWorkspaceState()
    },
    queryKey: rendererQueryKeys.tailoredApplicationWorkspace,
  })
}

export function getWorkspaceSelectionQueryOptions() {
  return queryOptions({
    queryFn: async () => {
      return await globalThis.window.cvMaxxing.tailoredApplication.getWorkspaceSelection()
    },
    queryKey: rendererQueryKeys.workspaceSelection,
  })
}

export function getPendingGenerationCommandQueryOptions() {
  return queryOptions({
    queryFn: async () => {
      return await globalThis.window.cvMaxxing.tailoredApplication.getPendingGenerationCommand()
    },
    queryKey: rendererQueryKeys.pendingGeneration,
  })
}

export function getTailoredApplicationPreviewQueryOptions(tailoredApplicationId: string) {
  return queryOptions({
    queryFn: async () => {
      return await globalThis.window.cvMaxxing.tailoredApplication.getTailoredApplicationPreview(
        tailoredApplicationId,
      )
    },
    queryKey: createTailoredApplicationPreviewQueryKey(tailoredApplicationId),
  })
}
