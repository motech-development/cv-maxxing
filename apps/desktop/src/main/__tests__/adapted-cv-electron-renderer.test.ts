import { beforeEach, expect, test, vi } from 'vitest'

const { BrowserWindowMock, createAdaptedCvDocumentMock } = vi.hoisted(() => {
  class BrowserWindowDouble {
    destroy = vi.fn()

    loadURL = vi.fn()

    webContents = {
      executeJavaScript: vi.fn().mockResolvedValue({
        pageCount: 1,
        rightSections: [],
      }),
      printToPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7 adapted cv', 'utf8')),
    }
  }

  return {
    BrowserWindowMock: vi.fn(function BrowserWindowConstructor() {
      return new BrowserWindowDouble()
    }),
    createAdaptedCvDocumentMock: vi.fn(),
  }
})

vi.mock('electron', () => {
  return {
    BrowserWindow: BrowserWindowMock,
  }
})

vi.mock('../adapted-cv-document.js', () => {
  return {
    applyPlannedSidebarSectionsToAdaptedCv: function applyPlannedSidebarSectionsToAdaptedCv(
      adaptedCv: unknown,
    ) {
      return adaptedCv
    },
    buildAdaptedCvPageWarning: vi.fn().mockReturnValue(null),
    createAdaptedCvDocument: createAdaptedCvDocumentMock,
  }
})

import { createElectronAdaptedCvRenderer } from '../adapted-cv-electron-renderer.js'

beforeEach(() => {
  vi.clearAllMocks()

  createAdaptedCvDocumentMock.mockReturnValue({
    html: '<html><head><style></style></head><body data-cv-ready="true">Adapted CV</body></html>',
  })
})

test('creates the hidden adapted-CV render window without a preload script path', async () => {
  const renderer = createElectronAdaptedCvRenderer()

  await expect(
    renderer.renderAdaptedCvPdf({
      adaptedCv: {
        candidateName: 'Ada Lovelace',
        header: {
          contact: {
            email: 'ada@lovelace.dev',
            location: 'London, United Kingdom',
            phone: '+44 7700 900123',
            professionalLink: 'ada-lovelace.dev',
          },
          intro: {
            text: 'Design leader shaping truthful desktop workflow products for technical users.',
          },
        },
        headline: {
          text: 'Senior platform engineer',
        },
        sections: [
          {
            items: [],
            kind: 'experience',
          },
        ],
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
