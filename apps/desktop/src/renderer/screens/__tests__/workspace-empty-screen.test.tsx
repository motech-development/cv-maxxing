// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { WorkspaceDraftView } from '../workspace-empty-screen.js'

const baseProperties = {
  draftReviewState: 'editable' as const,
  isAdaptingCv: false,
  isCurrentDraftMeaningful: false,
  isOpeningVacancyBrowser: false,
  isReviewingVacancy: false,
  onAdaptCv: vi.fn(),
  onOpenVacancyBrowserSession: vi.fn(),
  onReviewPastedVacancy: vi.fn(),
  onReviewVacancyUrl: vi.fn(),
  onTextDraftChange: vi.fn(),
  onUrlDraftChange: vi.fn(),
  textDraft: '',
  urlDraft: '',
  vacancyPreview: null,
  vacancyReviewError: null,
  workspaceError: null,
}

test('keeps intake-card buttons separated from source fields with a flex spacer', () => {
  render(<WorkspaceDraftView {...baseProperties} />)

  const reviewTextButton = screen.getByRole('button', { name: 'Review pasted vacancy' })
  const reviewUrlButton = screen.getByRole('button', { name: 'Review vacancy from URL' })

  const pasteCard = reviewTextButton.parentElement
  const urlCard = reviewUrlButton.parentElement

  expect(pasteCard?.className).toContain('gap-3')
  expect(urlCard?.className).toContain('gap-3')

  const pasteSpacer = reviewTextButton.previousElementSibling
  const urlSpacer = reviewUrlButton.previousElementSibling

  expect(pasteSpacer?.className).toContain('flex-1')
  expect(urlSpacer?.className).toContain('flex-1')
  expect(pasteSpacer?.getAttribute('aria-hidden')).toBe('true')
  expect(urlSpacer?.getAttribute('aria-hidden')).toBe('true')
})
