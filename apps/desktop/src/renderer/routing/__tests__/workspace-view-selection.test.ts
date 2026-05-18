import { expect, test } from 'vitest'

import type { TailoredApplicationWorkspaceState } from '../../../shared/tailored-application.js'
import {
  resolveTailoredApplicationId,
  resolveWorkspaceViewSelection,
} from '../workspace-view-selection.js'

function createTailoredApplicationWorkspaceState(
  overrides: Partial<TailoredApplicationWorkspaceState> = {},
): TailoredApplicationWorkspaceState {
  return {
    activeApplicationId: 'application-active',
    applications: [
      {
        createdAt: '2026-04-08T14:30:00.000Z',
        employer: 'Example Labs',
        id: 'application-active',
        pageCount: 1,
        pageWarning: null,
        title: 'Example Labs - Product Designer',
        vacancyTitle: 'Product Designer',
      },
      {
        createdAt: '2026-04-08T15:30:00.000Z',
        employer: 'Another Studio',
        id: 'application-preferred',
        pageCount: 2,
        pageWarning: null,
        title: 'Another Studio - Staff Product Designer',
        vacancyTitle: 'Staff Product Designer',
      },
    ],
    ...overrides,
  }
}

test('keeps the preferred tailored application when it still exists', () => {
  const tailoredApplicationId = resolveTailoredApplicationId({
    preferredTailoredApplicationId: 'application-preferred',
    workspaceState: createTailoredApplicationWorkspaceState(),
  })

  expect(tailoredApplicationId).toBe('application-preferred')
})

test('falls back to the active tailored application when the preferred one is gone', () => {
  const tailoredApplicationId = resolveTailoredApplicationId({
    preferredTailoredApplicationId: 'application-missing',
    workspaceState: createTailoredApplicationWorkspaceState(),
  })

  expect(tailoredApplicationId).toBe('application-active')
})

test('shows the draft while generation is pending', () => {
  expect(
    resolveWorkspaceViewSelection({
      forcedSelection: null,
      hasMeaningfulDraft: false,
      hasPendingGeneration: true,
      resolvedTailoredApplicationId: 'application-active',
    }),
  ).toEqual({
    kind: 'draft',
  })
})

test('uses a forced draft selection before saved applications', () => {
  expect(
    resolveWorkspaceViewSelection({
      forcedSelection: {
        kind: 'draft',
      },
      hasMeaningfulDraft: false,
      hasPendingGeneration: false,
      resolvedTailoredApplicationId: 'application-active',
    }),
  ).toEqual({
    kind: 'draft',
  })
})

test('shows a saved application when no draft route takes precedence', () => {
  expect(
    resolveWorkspaceViewSelection({
      forcedSelection: null,
      hasMeaningfulDraft: false,
      hasPendingGeneration: false,
      resolvedTailoredApplicationId: 'application-active',
    }),
  ).toEqual({
    kind: 'tailored_application',
  })
})

test('defaults to the draft when there is no saved application', () => {
  expect(
    resolveWorkspaceViewSelection({
      forcedSelection: null,
      hasMeaningfulDraft: false,
      hasPendingGeneration: false,
      resolvedTailoredApplicationId: null,
    }),
  ).toEqual({
    kind: 'draft',
  })
})
