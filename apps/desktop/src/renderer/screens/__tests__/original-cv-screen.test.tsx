// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import type { OriginalCvDetail } from '../../../shared/original-cv.js'

const pdfPreviewCardProperties = vi.hoisted(() => {
  return {
    lastProperties: null as Record<string, unknown> | null,
  }
})

vi.mock('../../ui/pdf-preview-card.js', () => {
  return {
    PdfPreviewCard: (properties: Record<string, unknown>) => {
      pdfPreviewCardProperties.lastProperties = properties

      return <div aria-label="Rendered PDF preview">PDF preview</div>
    },
  }
})

import { OriginalCvScreen } from '../original-cv-screen.js'

function createOriginalCvDetailFixture(
  overrides: Partial<OriginalCvDetail> = {},
): OriginalCvDetail {
  return {
    originalCv: {
      fileType: 'pdf',
      headline: 'Principal Product Designer',
      id: 'original-cv-123',
      importedAt: '2026-04-08T14:30:00.000Z',
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 2,
      snapshotCount: 1,
      summary: 'Design leader focused on complex workflow products.',
      writingStyle: {
        averageSentenceLength: 7,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
    preview: {
      pageCount: 2,
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    profile: {
      contact: {
        email: 'ada@lovelace.dev',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'ada-lovelace.dev',
      },
      experience: [
        {
          dateRange: '2022 - Present',
          employer: 'Analytical Engines Ltd',
          roleTitle: 'Principal Product Designer',
          summary: 'Led product design for AI-assisted desktop tooling.',
        },
      ],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Workflow design', 'UX research', 'Product strategy'],
      summary: 'Design leader focused on complex workflow products.',
    },
    ...overrides,
  }
}

test('renders the populated Your CV screen with a selectable sidebar item, PDF preview, and scrollable extracted profile', () => {
  const onSelectOriginalCv = vi.fn()

  render(
    <OriginalCvScreen
      activeOriginalCv={createOriginalCvDetailFixture().originalCv}
      activeOriginalCvDetail={createOriginalCvDetailFixture()}
      importError={null}
      isImportingOriginalCv={false}
      onFileDrop={vi.fn()}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={onSelectOriginalCv}
      originalCvFile={null}
      workspaceError={null}
    />,
  )

  expect(screen.getByRole('button', { name: 'Open active original CV' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Active original CV' })).toBeDefined()
  expect(screen.getByText('Extracted profile')).toBeDefined()
  expect(screen.getByText('ada@lovelace.dev')).toBeDefined()
  expect(screen.getByText('Workflow design')).toBeDefined()
  expect(screen.getByText(/Analytical Engines Ltd/u)).toBeDefined()
  expect(screen.getByLabelText('Rendered PDF preview')).toBeDefined()

  const profilePanel = screen.getByText('Extracted profile').closest('section')

  expect(profilePanel).not.toBeNull()
  expect(profilePanel?.className).toContain('overflow-y-auto')

  expect(pdfPreviewCardProperties.lastProperties).toMatchObject({
    emptyStateCopy: 'Your original CV preview will appear here.',
    preview: {
      pageCount: 2,
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    title: 'Original CV',
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open active original CV' }))

  expect(onSelectOriginalCv).toHaveBeenCalledTimes(1)
})
