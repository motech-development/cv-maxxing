// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { WorkspaceApplicationView } from '../workspace-active-screen.js'

test('keeps the document preview column shrinkable beside the vacancy panel', () => {
  const onCopyCoverLetterText = vi.fn()
  const onDeleteTailoredApplication = vi.fn()
  const onExportPdf = vi.fn()
  const onSelectPreviewDocument = vi.fn()

  render(
    <WorkspaceApplicationView
      applicationTitle="Tailored application"
      isConfirmingDeleteTailoredApplication={false}
      isCopyingCoverLetterText={false}
      isExportingPdf={false}
      onCopyCoverLetterText={onCopyCoverLetterText}
      onDeleteTailoredApplication={onDeleteTailoredApplication}
      onExportPdf={onExportPdf}
      onSelectPreviewDocument={onSelectPreviewDocument}
      preview={null}
      previewDocumentKind="adapted_cv"
      workspaceError={null}
    />,
  )

  expect(screen.getByText('Job vacancy')).toBeDefined()

  const panelCards = [...document.querySelectorAll('div')].filter((element) => {
    return (
      typeof element.className === 'string' &&
      element.className.includes('rounded-[var(--radius-card)]') &&
      element.className.includes('border-[var(--color-border)]')
    )
  })

  const previewPanel = panelCards.find((element) => {
    return (
      element.className.includes('min-h-0') &&
      element.className.includes('flex-1') &&
      element.className.includes('flex-col')
    )
  })
  const vacancyPanel = panelCards.find((element) => {
    return (
      element.className.includes('w-[300px]') &&
      element.className.includes('flex-col') &&
      element.className.includes('overflow-y-auto')
    )
  })

  expect(previewPanel).toBeDefined()
  expect(vacancyPanel).toBeDefined()

  if (previewPanel === undefined || vacancyPanel === undefined) {
    throw new Error('Expected the workspace preview and vacancy panels to be rendered.')
  }

  expect(previewPanel.className).toContain('min-w-0')
  expect(previewPanel.className).toContain('min-h-0')
  expect(previewPanel.className).toContain('overflow-hidden')
  expect(vacancyPanel.className).toContain('shrink-0')
})
