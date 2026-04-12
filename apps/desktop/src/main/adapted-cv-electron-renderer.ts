import { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import type { AdaptedCvRenderer } from './tailored-application-session-service.js'
import { buildAdaptedCvPageWarning, createAdaptedCvDocument } from './adapted-cv-document.js'

const require = createRequire(import.meta.url)
const manrope400Url = pathToFileURL(
  require.resolve('@fontsource/manrope/files/manrope-latin-400-normal.woff2'),
).href
const manrope500Url = pathToFileURL(
  require.resolve('@fontsource/manrope/files/manrope-latin-500-normal.woff2'),
).href
const manrope600Url = pathToFileURL(
  require.resolve('@fontsource/manrope/files/manrope-latin-600-normal.woff2'),
).href

export function createElectronAdaptedCvRenderer(): AdaptedCvRenderer {
  return {
    renderAdaptedCvPdf: async (input) => {
      const document = createAdaptedCvDocument(input)
      const renderWindow = new BrowserWindow({
        backgroundColor: '#ffffff',
        height: 1200,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: '',
          sandbox: false,
        },
        width: 900,
      })

      try {
        const html = injectFontFaceCss(document.html)

        await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        const pageCount = await waitForAdaptedCvPagination(renderWindow)

        const pdfBytes = await renderWindow.webContents.printToPDF({
          landscape: false,
          margins: {
            bottom: 0,
            left: 0,
            right: 0,
            top: 0,
          },
          pageSize: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        })

        return {
          pageCount,
          pageWarning: buildAdaptedCvPageWarning(pageCount),
          pdfBytes: new Uint8Array(pdfBytes),
        }
      } finally {
        renderWindow.destroy()
      }
    },
  }
}

function injectFontFaceCss(html: string): string {
  const fontFaceCss = `
    @font-face {
      font-family: "Manrope";
      src: url("${manrope400Url}") format("woff2");
      font-style: normal;
      font-weight: 400;
    }

    @font-face {
      font-family: "Manrope";
      src: url("${manrope500Url}") format("woff2");
      font-style: normal;
      font-weight: 500;
    }

    @font-face {
      font-family: "Manrope";
      src: url("${manrope600Url}") format("woff2");
      font-style: normal;
      font-weight: 600;
    }
  `

  return html.replace('<style>', `<style>${fontFaceCss}`)
}

async function waitForAdaptedCvPagination(renderWindow: BrowserWindow): Promise<number> {
  const pageCountResult: unknown = await renderWindow.webContents.executeJavaScript(`
    (() => {
      const readyState = document.body?.dataset?.cvReady

      if (readyState === 'true') {
        return Promise.resolve(Number.parseInt(document.body.dataset.pageCount ?? '0', 10))
      }

      if (readyState === 'error') {
        return Promise.reject(
          new Error(document.body?.dataset?.cvError ?? 'Adapted CV pagination failed.')
        )
      }

      return new Promise((resolve, reject) => {
        const handleReady = () => {
          document.removeEventListener('adapted-cv-error', handleError)
          resolve(Number.parseInt(document.body?.dataset?.pageCount ?? '0', 10))
        }

        const handleError = () => {
          document.removeEventListener('adapted-cv-ready', handleReady)
          reject(new Error(document.body?.dataset?.cvError ?? 'Adapted CV pagination failed.'))
        }

        document.addEventListener('adapted-cv-ready', handleReady, { once: true })
        document.addEventListener('adapted-cv-error', handleError, { once: true })
      })
    })()
  `)

  if (
    typeof pageCountResult !== 'number' ||
    !Number.isInteger(pageCountResult) ||
    pageCountResult < 1
  ) {
    throw new Error(
      `Expected adapted CV pagination to produce at least one page, received ${String(pageCountResult)}.`,
    )
  }

  const pageCount = pageCountResult

  return pageCount
}
