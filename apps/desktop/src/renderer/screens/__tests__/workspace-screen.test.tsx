// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { createRuntimeAlert } from '../../runtime-alerts.js'
import { WorkspaceScreen } from '../workspace-screen.js'

const baseProperties = {
  applicationTitle: null,
  applications: [
    {
      createdAt: '2026-04-09T09:30:00.000Z',
      employer: 'Nebula Labs',
      id: 'tailored-application-456',
      pageCount: 2,
      pageWarning: null,
      title: 'Platform Product Manager · Nebula Labs',
      vacancyTitle: 'Platform Product Manager',
    },
  ],
  applicationRuntimeAlert: null,
  draftReviewState: 'editable' as const,
  draftRuntimeAlert: null,
  isAdaptingCv: false,
  isCopyingCoverLetterText: false,
  isCurrentDraftMeaningful: true,
  isExportingPdf: false,
  isOpeningVacancyBrowser: false,
  isReviewingVacancy: false,
  onAdaptCv: vi.fn(),
  onCopyCoverLetterText: vi.fn(),
  onCreateVacancy: vi.fn(),
  onDeleteTailoredApplication: vi.fn(),
  onExportPdf: vi.fn(),
  onOpenVacancyBrowserSession: vi.fn(),
  onReviewPastedVacancy: vi.fn(),
  onReviewVacancyUrl: vi.fn(),
  onSelectApplication: vi.fn(),
  onSelectDraft: vi.fn(),
  onSelectPreviewDocument: vi.fn(),
  onTextDraftChange: vi.fn(),
  onUrlDraftChange: vi.fn(),
  preview: null,
  previewDocumentKind: 'adapted_cv' as const,
  selectedTailoredApplicationId: null,
  textDraft: 'Draft role text',
  urlDraft: 'https://jobs.example.com/roles/123',
  vacancyPreview: null,
}

test('keeps the vacancy sidebar structure stable while switching between draft and saved application views', () => {
  const { rerender } = render(<WorkspaceScreen {...baseProperties} selectedWorkspaceItem="draft" />)

  expect(screen.getByRole('button', { name: 'Open add a job' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open platform product manager' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Add a job' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Add a job' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Jobs' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Your CV' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Update your CV' })).toBeNull()

  rerender(
    <WorkspaceScreen
      {...baseProperties}
      preview={{
        adaptedCv: {
          pageCount: 2,
          pageWarning: null,
          pdfBytes: new Uint8Array([37, 80, 68, 70]),
        },
        adaptationSummary: {
          emphasized: [],
          gaps: [],
          omitted: [],
          validationHints: [],
        },
        coverLetter: {
          pageCount: 1,
          pageWarning: null,
          pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
          plainText: 'Dear Hiring Manager',
        },
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Nebula Labs',
        id: 'tailored-application-456',
        originalCv: {
          fileType: 'pdf',
          headline: 'Principal Product Designer',
          id: 'original-cv-123',
          importedAt: '2026-04-08T14:30:00.000Z',
          originalFilename: 'ada-lovelace.pdf',
          pageCount: 1,
          snapshotCount: 1,
          summary: 'Design leader focused on complex workflow products.',
          writingStyle: {
            averageSentenceLength: 7,
            clicheDetections: [],
            firstPersonUsage: 'absent',
            formality: 'direct',
          },
        },
        title: 'Platform Product Manager · Nebula Labs',
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Nebula Labs',
          fetchedAt: '2026-04-09T08:30:00.000Z',
          id: 'vacancy-456',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/platform-product-manager',
          requirements: [],
          resolvedUrl: 'https://jobs.example.com/platform-product-manager',
          responsibilities: ['Lead platform product direction.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead platform product direction.',
          title: 'Platform Product Manager',
        },
        vacancyTitle: 'Platform Product Manager',
      }}
      selectedTailoredApplicationId="tailored-application-456"
      selectedWorkspaceItem="tailored_application"
    />,
  )

  expect(screen.getByRole('button', { name: 'Open add a job' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open platform product manager' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Platform Product Manager' })).toBeDefined()
})

test('renders the shared page-top alert when a saved job is selected', () => {
  render(
    <WorkspaceScreen
      {...baseProperties}
      applicationRuntimeAlert={createRuntimeAlert({
        owner: {
          scope: 'job_vacancies',
          view: 'saved_application',
        },
        priority: 300,
        source: 'saved_application_export',
        title: "We couldn't save the PDF.",
        variant: 'error',
      })}
      preview={{
        adaptedCv: {
          pageCount: 2,
          pageWarning: null,
          pdfBytes: new Uint8Array([37, 80, 68, 70]),
        },
        adaptationSummary: {
          emphasized: [],
          gaps: [],
          omitted: [],
          validationHints: [],
        },
        coverLetter: {
          pageCount: 1,
          pageWarning: null,
          pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 67, 76]),
          plainText: 'Dear Hiring Manager',
        },
        createdAt: '2026-04-09T09:30:00.000Z',
        employer: 'Nebula Labs',
        id: 'tailored-application-456',
        originalCv: {
          fileType: 'pdf',
          headline: 'Principal Product Designer',
          id: 'original-cv-123',
          importedAt: '2026-04-08T14:30:00.000Z',
          originalFilename: 'ada-lovelace.pdf',
          pageCount: 1,
          snapshotCount: 1,
          summary: 'Design leader focused on complex workflow products.',
          writingStyle: {
            averageSentenceLength: 7,
            clicheDetections: [],
            firstPersonUsage: 'absent',
            formality: 'direct',
          },
        },
        title: 'Platform Product Manager · Nebula Labs',
        vacancy: {
          blockingReason: null,
          canGenerate: true,
          employer: 'Nebula Labs',
          fetchedAt: '2026-04-09T08:30:00.000Z',
          id: 'vacancy-456',
          inputType: 'url',
          location: 'London, United Kingdom',
          originalUrl: 'https://jobs.example.com/platform-product-manager',
          requirements: [],
          resolvedUrl: 'https://jobs.example.com/platform-product-manager',
          responsibilities: ['Lead platform product direction.'],
          source: 'generic',
          status: 'ready',
          textPreview: 'Lead platform product direction.',
          title: 'Platform Product Manager',
        },
        vacancyTitle: 'Platform Product Manager',
      }}
      selectedTailoredApplicationId="tailored-application-456"
      selectedWorkspaceItem="tailored_application"
    />,
  )

  expect(screen.getByRole('alert')).toBeDefined()
  expect(screen.getByText("We couldn't save the PDF.")).toBeDefined()
})
