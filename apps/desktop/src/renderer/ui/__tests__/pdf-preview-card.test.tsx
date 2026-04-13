// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { TailoredApplicationPdfPreview } from '../../../shared/tailored-application.js'

const detachedBufferErrorMessage =
  "Failed to execute 'postMessage' on 'Worker': ArrayBuffer at index 0 is already detached."

const { getDocumentMock } = vi.hoisted(() => {
  return {
    getDocumentMock: vi.fn(),
  }
})

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
  return {
    getDocument: getDocumentMock,
    GlobalWorkerOptions: {
      workerSrc: '',
    },
  }
})

import { PdfPreviewCard } from '../pdf-preview-card.js'

beforeEach(() => {
  vi.clearAllMocks()

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => {
      return {} as CanvasRenderingContext2D
    }),
  })

  getDocumentMock.mockImplementation(({ data }: { data: Uint8Array }) => {
    if (data.byteLength === 0) {
      return {
        destroy: vi.fn().mockImplementation(() => Promise.resolve()),
        promise: Promise.resolve().then(() => {
          throw new Error(detachedBufferErrorMessage)
        }),
      }
    }

    structuredClone(data.buffer, {
      transfer: [data.buffer],
    })

    return {
      destroy: vi.fn().mockImplementation(() => Promise.resolve()),
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: ({ scale }: { scale: number }) => {
            return {
              height: 160 * scale,
              width: 120 * scale,
            }
          },
          render: vi.fn().mockReturnValue({
            cancel: vi.fn(),
            promise: Promise.resolve(),
          }),
        }),
      }),
    }
  })
})

test('navigates between PDF pages without surfacing a detached worker buffer error', async () => {
  const preview: TailoredApplicationPdfPreview = {
    pageCount: 2,
    pageWarning: 'This PDF runs long but should not show a warning banner.',
    pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]),
  }

  render(
    <PdfPreviewCard
      emptyStateCopy="No PDF preview"
      preview={preview}
      previewKey="adapted-cv-preview"
      title="Adapted CV"
    />,
  )

  await waitFor(() => {
    expect(getDocumentMock).toHaveBeenCalledTimes(1)
  })

  expect(screen.queryByText('This PDF runs long but should not show a warning banner.')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

  await waitFor(() => {
    expect(screen.getByText('Page 2 of 2')).toBeDefined()
    expect(getDocumentMock).toHaveBeenCalledTimes(2)
  })

  expect(screen.queryByText(detachedBufferErrorMessage)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))

  await waitFor(() => {
    expect(screen.getByText('Page 1 of 2')).toBeDefined()
    expect(getDocumentMock).toHaveBeenCalledTimes(3)
  })

  expect(screen.queryByText(detachedBufferErrorMessage)).toBeNull()
})
