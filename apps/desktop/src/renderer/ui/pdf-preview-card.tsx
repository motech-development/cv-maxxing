import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'

import type { TailoredApplicationPdfPreview } from '../../shared/tailored-application.js'
import { Button } from './button.js'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface PdfPreviewCardProperties {
  emptyStateCopy: string
  preview: TailoredApplicationPdfPreview | null
  previewKey: string
  title: string
}

const MINIMUM_ZOOM = 0.8
const MAXIMUM_ZOOM = 1.8
const ZOOM_STEP = 0.2

export function PdfPreviewCard({
  emptyStateCopy,
  preview,
  previewKey,
  title,
}: PdfPreviewCardProperties) {
  if (preview === null) {
    return (
      <div className="flex h-full min-h-[520px] items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-sm text-[var(--color-copy-muted)]">
        {emptyStateCopy}
      </div>
    )
  }

  return <LoadedPdfPreviewCard key={previewKey} preview={preview} title={title} />
}

function LoadedPdfPreviewCard({
  preview,
  title,
}: {
  preview: TailoredApplicationPdfPreview
  title: string
}) {
  const canvasReference = useRef<HTMLCanvasElement | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (canvasReference.current === null) {
      return
    }

    const activePreview = preview
    let isCancelled = false
    let activeLoadingTask: ReturnType<typeof getDocument> | null = null
    let activeRenderTask: { cancel: () => void; promise: Promise<void> } | null = null

    async function renderPdfPage(): Promise<void> {
      activeLoadingTask = getDocument({
        data: activePreview.pdfBytes,
      })

      try {
        const pdfDocument = await activeLoadingTask.promise
        activeLoadingTask = null
        const page = await pdfDocument.getPage(currentPage)
        const viewport = page.getViewport({
          scale: zoom,
        })
        const canvas = canvasReference.current

        if (canvas === null || isCancelled) {
          return
        }

        const canvasContext = canvas.getContext('2d')

        if (canvasContext === null) {
          setRenderError('PDF preview unavailable in this environment.')

          return
        }

        canvas.height = Math.ceil(viewport.height)
        canvas.width = Math.ceil(viewport.width)
        setRenderError(null)

        activeRenderTask = page.render({
          canvas,
          canvasContext,
          viewport,
        })

        await activeRenderTask.promise
      } catch (error) {
        if (!isCancelled) {
          setRenderError(
            error instanceof Error ? error.message : 'Unable to render the PDF preview.',
          )
        }
      }
    }

    renderPdfPage().catch(() => {
      setRenderError('Unable to render the PDF preview.')
    })

    return () => {
      isCancelled = true
      activeLoadingTask?.destroy().catch(() => null)
      activeRenderTask?.cancel()
    }
  }, [currentPage, preview, zoom])

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-4 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            disabled={currentPage === 1}
            onClick={() => {
              setCurrentPage((previousPage) => {
                return Math.max(1, previousPage - 1)
              })
            }}
            tone="secondary"
          >
            Previous page
          </Button>
          <Button
            disabled={currentPage >= preview.pageCount}
            onClick={() => {
              setCurrentPage((previousPage) => {
                return Math.min(preview.pageCount, previousPage + 1)
              })
            }}
            tone="secondary"
          >
            Next page
          </Button>
        </div>
        <p className="m-0 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
          Page {currentPage} of {preview.pageCount}
        </p>
        <div className="flex items-center gap-2">
          <Button
            disabled={zoom <= MINIMUM_ZOOM}
            onClick={() => {
              setZoom((previousZoom) => {
                return Math.max(MINIMUM_ZOOM, previousZoom - ZOOM_STEP)
              })
            }}
            tone="secondary"
          >
            Zoom out
          </Button>
          <Button
            disabled={zoom >= MAXIMUM_ZOOM}
            onClick={() => {
              setZoom((previousZoom) => {
                return Math.min(MAXIMUM_ZOOM, previousZoom + ZOOM_STEP)
              })
            }}
            tone="secondary"
          >
            Zoom in
          </Button>
        </div>
      </div>

      {preview.pageWarning ? (
        <div className="rounded-[8px] bg-[var(--color-surface-warning)] px-3 py-2 text-sm text-[var(--color-copy-strong)]">
          {preview.pageWarning}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-[6px] bg-[var(--color-shell-canvas)] p-4">
        {renderError ? (
          <p className="m-0 text-sm text-[var(--color-copy-muted)]">{renderError}</p>
        ) : null}
        <canvas
          aria-label={`${title} PDF preview`}
          className={`${renderError ? 'hidden' : 'block'} rounded-[4px] bg-white shadow-[0_18px_48px_rgba(8,20,31,0.08)]`}
          ref={canvasReference}
        />
      </div>
    </div>
  )
}
