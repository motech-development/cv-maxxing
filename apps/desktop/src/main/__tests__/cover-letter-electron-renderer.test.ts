import { beforeEach, expect, test, vi } from 'vitest'

const { BrowserWindowMock, createCoverLetterDocumentMock, getDocumentMock } = vi.hoisted(() => {
  class BrowserWindowDouble {
    destroy = vi.fn()

    loadURL = vi.fn()

    webContents = {
      executeJavaScript: vi.fn().mockResolvedValue(true),
      printToPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7 cover letter', 'utf8')),
    }
  }

  return {
    BrowserWindowMock: vi.fn(function BrowserWindowConstructor() {
      return new BrowserWindowDouble()
    }),
    createCoverLetterDocumentMock: vi.fn(),
    getDocumentMock: vi.fn(),
  }
})

vi.mock('electron', () => {
  return {
    BrowserWindow: BrowserWindowMock,
  }
})

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
  return {
    getDocument: getDocumentMock,
  }
})

vi.mock('../cover-letter-document.js', () => {
  return {
    buildCoverLetterPageWarning: vi.fn().mockReturnValue(null),
    createCoverLetterDocument: createCoverLetterDocumentMock,
  }
})

import {
  countPdfPages,
  createElectronCoverLetterRenderer,
} from '../cover-letter-electron-renderer.js'

beforeEach(() => {
  vi.clearAllMocks()

  createCoverLetterDocumentMock.mockReturnValue({
    html: '<html><head><style></style></head><body>Cover letter</body></html>',
  })
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

test('creates the hidden cover-letter render window without a preload script path', async () => {
  getDocumentMock.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
    }),
  })

  const renderer = createElectronCoverLetterRenderer()

  await expect(
    renderer.renderCoverLetterPdf({
      coverLetter: {
        body: [
          {
            text: 'Paragraph 1',
          },
        ],
        closing: {
          text: 'Kind regards,',
        },
        date: '16 April 2026',
        greeting: 'Dear hiring team,',
        opening: {
          text: 'I am applying for the Senior platform engineer role.',
        },
        signature: 'Ada Lovelace',
      },
      employer: 'Example Labs',
      vacancyTitle: 'Senior platform engineer',
    }),
  ).resolves.toMatchObject({
    pageCount: 1,
    pageWarning: null,
  })

  expect(BrowserWindowMock).toHaveBeenCalledTimes(1)

  const browserWindowOptions = (
    BrowserWindowMock as unknown as { mock: { calls: unknown[][] } }
  ).mock.calls.at(0)?.[0] as { webPreferences?: Record<string, unknown> } | undefined

  expect(browserWindowOptions?.webPreferences).toMatchObject({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  })
  expect(browserWindowOptions?.webPreferences).not.toHaveProperty('preload')
})
