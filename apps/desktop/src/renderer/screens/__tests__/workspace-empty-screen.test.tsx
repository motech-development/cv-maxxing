// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import type { VacancySummary } from '../../../shared/vacancy.js'
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
}

function getReviewButtons() {
  const [reviewUrlButton, reviewTextButton] = screen.getAllByRole('button', {
    name: 'Check job details',
  })

  if (reviewUrlButton === undefined || reviewTextButton === undefined) {
    throw new Error('Expected job-link and pasted-description review buttons.')
  }

  return {
    reviewTextButton,
    reviewUrlButton,
  }
}

test('keeps intake-card buttons separated from source fields with a flex spacer', () => {
  render(<WorkspaceDraftView {...baseProperties} />)

  const { reviewTextButton, reviewUrlButton } = getReviewButtons()

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
  expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  expect(screen.getByLabelText('Job link')).toBeDefined()
  expect(screen.getByLabelText('Job description')).toBeDefined()
})

test('uses outcome-led low-content copy in the job details preview', () => {
  const vacancyPreview: VacancySummary = {
    canGenerate: false,
    employer: null,
    fetchedAt: '2026-04-08T14:30:00.000Z',
    id: 'vacancy-123',
    inputType: 'pasted_text',
    location: null,
    originalUrl: null,
    requirements: [],
    resolvedUrl: null,
    responsibilities: [],
    source: 'generic',
    status: 'incomplete',
    textPreview: '',
    title: 'Senior platform engineer',
    blockingReason: null,
  }

  render(
    <WorkspaceDraftView
      {...baseProperties}
      isCurrentDraftMeaningful
      vacancyPreview={vacancyPreview}
    />,
  )

  expect(screen.getByText('The job details will appear here.')).toBeDefined()
  expect(screen.getByText("What you'll be doing will appear here.")).toBeDefined()
  expect(screen.getByText("What they're looking for will appear here.")).toBeDefined()
})
