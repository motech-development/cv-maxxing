// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import type { VacancySummary } from '../../../shared/vacancy.js'
import { VacancyPreviewCard } from '../vacancy-preview-card.js'

afterEach(() => {
  cleanup()
})

function createVacancyPreview(overrides: Partial<VacancySummary> = {}): VacancySummary {
  return {
    blockingReason:
      'CV Maxxing v1 supports British English only. Review an English job before tailoring your CV.',
    canGenerate: false,
    employer: 'Example Labs',
    fetchedAt: '2026-04-08T21:40:00.000Z',
    id: 'vacancy-008',
    inputType: 'pasted_text',
    location: 'Madrid, España',
    originalUrl: 'https://jobs.example.com/platform-engineer-es',
    requirements: [
      'Experiencia enviando software de flujo de trabajo.',
      'Comunicación escrita sólida.',
    ],
    resolvedUrl: 'https://jobs.example.com/platform-engineer-es',
    responsibilities: [
      'Diseñar productos para usuarios técnicos con equipos de ingeniería.',
      'Colaborar con investigación y operaciones.',
    ],
    source: 'jobs.example.com',
    status: 'incomplete',
    textPreview:
      'Diseñar productos para usuarios técnicos con equipos de ingeniería. Colaborar con investigación y operaciones.',
    title: 'Ingeniero de plataforma',
    ...overrides,
  }
}

test('keeps pasted job review errors focused on the pasted details even when a job link is present', () => {
  render(
    <VacancyPreviewCard
      isAdaptingCv={false}
      isDraftReviewed={false}
      isOpeningBrowserSession={false}
      onAdaptCv={vi.fn()}
      onOpenBrowserSession={vi.fn()}
      preview={createVacancyPreview()}
    />,
  )

  expect(screen.getByText('Needs more detail')).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Open the job page' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Tailor your CV' })).toHaveProperty('disabled', true)
})
