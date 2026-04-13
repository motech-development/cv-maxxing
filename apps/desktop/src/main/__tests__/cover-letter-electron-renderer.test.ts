import { beforeEach, expect, test, vi } from 'vitest'

const { getDocumentMock } = vi.hoisted(() => {
  return {
    getDocumentMock: vi.fn(),
  }
})

vi.mock('electron', () => {
  return {
    BrowserWindow: vi.fn(),
  }
})

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
  return {
    getDocument: getDocumentMock,
  }
})

import { countPdfPages } from '../cover-letter-electron-renderer.js'

beforeEach(() => {
  vi.clearAllMocks()
})

test('counts pages from the generated PDF artifact', async () => {
  getDocumentMock.mockReturnValue({
    promise: Promise.resolve({
      numPages: 2,
    }),
  })

  await expect(countPdfPages(Uint8Array.from([1, 2, 3]))).resolves.toBe(2)
  expect(getDocumentMock).toHaveBeenCalledWith(Uint8Array.from([1, 2, 3]))
})
