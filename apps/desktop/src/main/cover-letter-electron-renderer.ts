import { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { buildCoverLetterPageWarning, createCoverLetterDocument } from './cover-letter-document.js'
import type { CoverLetterRenderer } from './tailored-application-session-service.js'

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

export function createElectronCoverLetterRenderer(): CoverLetterRenderer {
  return {
    renderCoverLetterPdf: async (input) => {
      const document = createCoverLetterDocument(input)
      const renderWindow = new BrowserWindow({
        backgroundColor: '#ffffff',
        height: 1200,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
        width: 900,
      })

      try {
        const html = injectFontFaceCss(document.html)

        await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        await renderWindow.webContents.executeJavaScript(
          'document.fonts?.ready ? document.fonts.ready.then(() => true) : Promise.resolve(true)',
        )

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

        const pageCount = await countPdfPages(pdfBytes)

        return {
          pageCount,
          pageWarning: buildCoverLetterPageWarning(pageCount),
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

export async function countPdfPages(pdfBytes: Uint8Array): Promise<number> {
  const pdfDocument = await getDocument(new Uint8Array(pdfBytes)).promise

  return pdfDocument.numPages
}
