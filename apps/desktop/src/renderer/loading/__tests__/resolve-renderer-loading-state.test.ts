import { expect, test } from 'vitest'

import {
  resolveRendererLoadingState,
  type ResolveRendererLoadingStateInput,
} from '../resolve-renderer-loading-state.js'

function createLoadingInput(
  overrides: Partial<ResolveRendererLoadingStateInput> = {},
): ResolveRendererLoadingStateInput {
  return {
    isCheckingAiWorkerReadiness: false,
    isFetchingTailoredApplicationPreview: false,
    isGeneratingTailoredApplication: false,
    isImportingOriginalCv: false,
    isResettingLocalAppData: false,
    isReviewingVacancy: false,
    ...overrides,
  }
}

test('returns idle when no tracked loading sources are active', () => {
  expect(resolveRendererLoadingState(createLoadingInput())).toEqual({
    kind: 'idle',
    label: null,
    scope: 'idle',
  })
})

test('prefers app-blocking loading over workspace-blocking and ambient activity', () => {
  expect(
    resolveRendererLoadingState(
      createLoadingInput({
        isCheckingAiWorkerReadiness: true,
        isFetchingTailoredApplicationPreview: true,
        isGeneratingTailoredApplication: true,
      }),
    ),
  ).toEqual({
    kind: 'ai_worker_readiness',
    label: 'Preparing app',
    scope: 'app_blocking',
  })
})

test('prefers workspace-blocking loading over ambient activity', () => {
  expect(
    resolveRendererLoadingState(
      createLoadingInput({
        isFetchingTailoredApplicationPreview: true,
        isReviewingVacancy: true,
      }),
    ),
  ).toEqual({
    kind: 'vacancy_review',
    label: 'Loading workspace',
    scope: 'workspace_blocking',
  })
})

test('surfaces ambient activity for tailored-application preview fetches', () => {
  expect(
    resolveRendererLoadingState(
      createLoadingInput({
        isFetchingTailoredApplicationPreview: true,
      }),
    ),
  ).toEqual({
    kind: 'tailored_application_preview',
    label: 'Background activity',
    scope: 'ambient',
  })
})
