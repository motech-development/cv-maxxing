// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const { renderAsyncMock } = vi.hoisted(() => {
  return {
    renderAsyncMock: vi.fn(),
  }
})

vi.mock('docx-preview', () => {
  return {
    renderAsync: renderAsyncMock,
  }
})

import { OriginalCvPreviewCard } from '../original-cv-preview-card.js'

beforeEach(() => {
  vi.clearAllMocks()
  renderAsyncMock.mockImplementation(() => Promise.resolve())
})

test('renders DOCX previews locally inside the original CV preview pane', async () => {
  render(
    <OriginalCvPreviewCard
      emptyStateCopy="Your CV preview will appear here."
      preview={{
        docxBytes: new Uint8Array([80, 75, 3, 4]),
        kind: 'docx',
      }}
      previewKey="original-cv-docx-preview"
      title="Your CV"
    />,
  )

  await waitFor(() => {
    expect(renderAsyncMock).toHaveBeenCalledTimes(1)
  })

  const previewScrollport = screen.getByLabelText('Your CV DOCX preview')

  expect(previewScrollport.className).toContain('overflow-auto')
  expect(previewScrollport.className).toContain('h-full')
  expect(renderAsyncMock).toHaveBeenCalledWith(
    new Uint8Array([80, 75, 3, 4]),
    expect.any(HTMLDivElement),
    expect.any(HTMLDivElement),
    expect.objectContaining({
      className: 'cv-maxxing-docx',
      inWrapper: true,
      useBase64URL: true,
    }),
  )
  expect(screen.queryByText("We couldn't show this document right now.")).toBeNull()
})

test('falls back inside the preview pane when DOCX rendering fails', async () => {
  renderAsyncMock.mockRejectedValueOnce(new Error('DOCX preview failed.'))

  render(
    <OriginalCvPreviewCard
      emptyStateCopy="Your CV preview will appear here."
      preview={{
        docxBytes: new Uint8Array([80, 75, 3, 4]),
        kind: 'docx',
      }}
      previewKey="original-cv-docx-preview"
      title="Your CV"
    />,
  )

  await waitFor(() => {
    expect(screen.getByText('DOCX preview failed.')).toBeDefined()
  })

  expect(screen.getByText('DOCX preview failed.').closest('div')?.className).toContain(
    'overflow-hidden',
  )
})
